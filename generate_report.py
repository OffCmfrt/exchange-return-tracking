#!/usr/bin/env python3
"""
Detailed report of all requests (returns + exchanges) in the last N days.

For every request it captures:
  - Pickup (reverse leg): carrier, AWB, scheduled date, picked up, in transit,
    delivered back to warehouse, inspected
  - Forward (exchange) leg: forward carrier, AWB, status
  - Completion time (from request creation to completion)

Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the local .env file.
Uses only the Python standard library (urllib) + curl fallback.

Outputs:
  reports/requests-last-<N>-days.md
  reports/requests-last-<N>-days.csv

Usage: python3 generate_report.py [days]
"""
import os
import sys
import csv
import json
import ssl
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
IST = timezone(timedelta(hours=5, minutes=30))


# ── .env loader ──
def load_env(path):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, val = line.split('=', 1)
            val = val.strip()
            if len(val) >= 2 and val[0] == '"' and val[-1] == '"':
                val = val[1:-1]
            env[key.strip()] = val.replace('\\n', '')
    return env


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV = load_env(os.path.join(BASE_DIR, '.env'))
SUPABASE_URL = ENV.get('SUPABASE_URL') or os.environ.get('SUPABASE_URL')
SERVICE_KEY = (ENV.get('SUPABASE_SERVICE_ROLE_KEY') or ENV.get('SUPABASE_ANON_KEY')
               or os.environ.get('SUPABASE_SERVICE_ROLE_KEY'))

if not SUPABASE_URL or not SERVICE_KEY:
    print('❌ Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env')
    sys.exit(1)


# ── Supabase fetch ──
def fetch_requests(since_iso):
    rows = []
    page_size = 1000
    offset = 0
    ctx = ssl.create_default_context()
    while True:
        params = urllib.parse.urlencode({
            'select': '*',
            'created_at': f'gte.{since_iso}',
            'order': 'created_at.desc',
        })
        url = f'{SUPABASE_URL}/rest/v1/requests?{params}'
        req = urllib.request.Request(url)
        req.add_header('apikey', SERVICE_KEY)
        req.add_header('Authorization', f'Bearer {SERVICE_KEY}')
        req.add_header('Range-Unit', 'items')
        req.add_header('Range', f'{offset}-{offset + page_size - 1}')
        try:
            with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
                data = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            print('❌ Supabase HTTP error:', e.code, e.read().decode()[:500])
            sys.exit(1)
        rows.extend(data)
        if len(data) < page_size:
            break
        offset += page_size
    return rows


# ── Formatting helpers ──
def parse_dt(s):
    if not s:
        return None
    d = None
    try:
        s2 = s.replace('Z', '+00:00')
        d = datetime.fromisoformat(s2)
    except Exception:
        try:
            d = datetime.strptime(s[:19], '%Y-%m-%dT%H:%M:%S')
        except Exception:
            return None
    # Normalize to timezone-aware (assume UTC if naive)
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d


def fmt(s):
    d = parse_dt(s)
    if not d:
        return '—'
    return d.astimezone(IST).strftime('%d %b %Y, %I:%M %p')


def fmt_date(s):
    d = parse_dt(s)
    if not d:
        return '—'
    return d.astimezone(IST).strftime('%d %b %Y')


def duration_ms(a, b):
    da, db = parse_dt(a), parse_dt(b)
    if not da or not db:
        return None
    return (db - da).total_seconds() * 1000


def human(ms):
    if ms is None or ms < 0:
        return '—'
    total_hours = ms / 3600000
    days = int(total_hours // 24)
    hours = round(total_hours % 24)
    if days == 0:
        return f'{hours}h'
    return f'{days}d {hours}h'


def days_num(ms):
    if ms is None or ms < 0:
        return None
    return round(ms / 86400000, 1)


def items_summary(items):
    if not items:
        return '—'
    arr = items
    if isinstance(items, str):
        try:
            arr = json.loads(items)
        except Exception:
            return '—'
    if not isinstance(arr, list):
        return '—'
    parts = []
    for i in arr:
        if not isinstance(i, dict):
            parts.append(str(i))
            continue
        title = i.get('title') or i.get('name') or i.get('product_title') or 'Item'
        variant = i.get('variant_title') or i.get('variant') or i.get('size') or ''
        qty = i.get('quantity') or i.get('qty') or 1
        parts.append(f"{title}{' (' + str(variant) + ')' if variant else ''} x{qty}")
    return '; '.join(parts) if parts else '—'


TERMINAL = ['completed', 'refunded', 'rejected', 'cancelled', 'exchanged']


def resolve_completion(r):
    status = r.get('status')
    if status == 'rejected':
        return r.get('rejected_at') or r.get('updated_at'), 'rejected'
    if r.get('type') == 'exchange':
        if r.get('forward_status') == 'delivered':
            return r.get('updated_at'), 'forward delivered (≈ last update)'
        return None, None
    if status in TERMINAL:
        return r.get('inspected_at') or r.get('delivered_at') or r.get('updated_at'), status
    if r.get('inspected_at'):
        return r.get('inspected_at'), 'inspected'
    if r.get('delivered_at'):
        return r.get('delivered_at'), 'return delivered to warehouse'
    return None, None


def avg(a):
    return sum(a) / len(a) if a else None


def median(a):
    if not a:
        return None
    s = sorted(a)
    m = len(s) // 2
    return s[m] if len(s) % 2 else (s[m - 1] + s[m]) / 2


# ── Main ──
def main():
    since = datetime.now(timezone.utc) - timedelta(days=DAYS)
    since_iso = since.isoformat()
    print(f'📊 Fetching requests since {fmt(since_iso)} IST (last {DAYS} days)...')
    requests = fetch_requests(since_iso)
    print(f'✅ Found {len(requests)} requests')

    now_iso = datetime.now(timezone.utc).isoformat()
    rows = []
    for r in requests:
        completed_at, basis = resolve_completion(r)
        rows.append({
            'raw': r,
            'request_id': r.get('request_id'),
            'order': r.get('order_number'),
            'customer': r.get('customer_name') or '—',
            'phone': r.get('customer_phone') or '—',
            'type': r.get('type'),
            'status': r.get('status'),
            'reason': r.get('reason') or '—',
            'items': items_summary(r.get('items')),
            'created_at': r.get('created_at'),
            'approved_at': r.get('approved_at'),
            'pickup_carrier': r.get('carrier') or '—',
            'pickup_awb': r.get('carrier_awb') or r.get('awb_number') or '—',
            'pickup_date': r.get('pickup_date'),
            'picked_up_at': r.get('picked_up_at'),
            'in_transit_at': r.get('in_transit_at'),
            'delivered_at': r.get('delivered_at'),
            'inspected_at': r.get('inspected_at'),
            'forward_carrier': r.get('forward_carrier') or '—',
            'forward_awb': r.get('forward_awb_number') or '—',
            'forward_status': r.get('forward_status') or '—',
            'completed_at': completed_at,
            'completion_basis': basis,
            'ms_approve': duration_ms(r.get('created_at'), r.get('approved_at')),
            'ms_pickup': duration_ms(r.get('created_at'), r.get('picked_up_at')),
            'ms_transit': duration_ms(r.get('picked_up_at'), r.get('delivered_at')),
            'ms_complete': duration_ms(r.get('created_at'), completed_at),
        })

    total = len(rows)
    exchanges = [r for r in rows if r['type'] == 'exchange']
    returns = [r for r in rows if r['type'] == 'return']
    completed = [r for r in rows if r['ms_complete'] is not None]
    open_reqs = [r for r in rows if r['ms_complete'] is None]

    completion_times = [r['ms_complete'] for r in completed]
    ex_comp = [r['ms_complete'] for r in exchanges if r['ms_complete'] is not None]
    ret_comp = [r['ms_complete'] for r in returns if r['ms_complete'] is not None]
    approval_times = [r['ms_approve'] for r in rows if r['ms_approve'] is not None and r['ms_approve'] >= 0]
    pickup_times = [r['ms_pickup'] for r in rows if r['ms_pickup'] is not None and r['ms_pickup'] >= 0]

    def counts(key, subset=rows):
        c = {}
        for r in subset:
            c[r[key]] = c.get(r[key], 0) + 1
        return sorted(c.items(), key=lambda x: -x[1])

    status_counts = counts('status')
    carrier_counts = counts('pickup_carrier')
    fwd_counts = counts('forward_status', exchanges)
    reason_counts = counts('reason')

    pickup_booked = sum(1 for r in rows if r['pickup_date'] or r['pickup_awb'] != '—')
    picked_up = sum(1 for r in rows if r['picked_up_at'])
    delivered_back = sum(1 for r in rows if r['delivered_at'])

    # ── Markdown ──
    m = []
    m.append(f'# 📋 Requests Report — Last {DAYS} Days\n')
    m.append(f'**Generated:** {fmt(now_iso)} (IST)  ')
    m.append(f'**Period:** {fmt_date(since_iso)} → {fmt_date(now_iso)}  ')
    m.append(f'**Total Requests:** {total} ({len(returns)} returns, {len(exchanges)} exchanges)\n')
    m.append('---\n')

    m.append('## 1. Summary\n')
    m.append('| Metric | Value |\n|---|---|')
    m.append(f'| Total requests | {total} |')
    m.append(f'| Returns | {len(returns)} |')
    m.append(f'| Exchanges | {len(exchanges)} |')
    m.append(f'| Completed | {len(completed)} |')
    m.append(f'| Still open / in progress | {len(open_reqs)} |')
    m.append(f'| Avg time to approval | {human(avg(approval_times))} |')
    m.append(f'| Avg time to pickup (from request) | {human(avg(pickup_times))} |')
    m.append(f'| Avg completion time (all) | {human(avg(completion_times))} |')
    m.append(f'| Median completion time (all) | {human(median(completion_times))} |')
    m.append(f'| Avg completion time (returns) | {human(avg(ret_comp))} |')
    m.append(f'| Avg completion time (exchanges) | {human(avg(ex_comp))} |\n')

    m.append('### Status Breakdown\n')
    m.append('| Status | Count |\n|---|---|')
    for s, c in status_counts:
        m.append(f'| {s} | {c} |')

    m.append('\n### Pickup Funnel (reverse leg)\n')
    m.append('| Stage | Count | % of total |\n|---|---|---|')
    pct = lambda n: (round(n / total * 100) if total else 0)
    m.append(f'| Pickup booked (AWB/date assigned) | {pickup_booked} | {pct(pickup_booked)}% |')
    m.append(f'| Picked up | {picked_up} | {pct(picked_up)}% |')
    m.append(f'| Delivered back to warehouse | {delivered_back} | {pct(delivered_back)}% |')

    m.append('\n### Pickup Carrier Split\n')
    m.append('| Carrier | Count |\n|---|---|')
    for s, c in carrier_counts:
        m.append(f'| {s} | {c} |')

    if exchanges:
        m.append('\n### Forward Shipment Status (exchanges only)\n')
        m.append('| Forward Status | Count |\n|---|---|')
        for s, c in fwd_counts:
            m.append(f'| {s} | {c} |')

    m.append('\n### Reasons\n')
    m.append('| Reason | Count |\n|---|---|')
    for s, c in reason_counts:
        m.append(f'| {s} | {c} |')

    m.append('\n---\n')
    m.append('## 2. All Requests — Overview Table\n')
    m.append('| # | Request | Order | Type | Status | Created | Pickup AWB | Picked Up | Fwd AWB | Fwd Status | Completion |')
    m.append('|---|---|---|---|---|---|---|---|---|---|---|')
    for i, r in enumerate(rows, 1):
        m.append(f"| {i} | {r['request_id']} | {r['order']} | {r['type']} | {r['status']} | "
                 f"{fmt_date(r['created_at'])} | {r['pickup_awb']} | {fmt_date(r['picked_up_at'])} | "
                 f"{r['forward_awb']} | {r['forward_status']} | {human(r['ms_complete'])} |")

    m.append('\n---\n')
    m.append('## 3. Detailed Per-Request Breakdown\n')
    for i, r in enumerate(rows, 1):
        m.append(f"### {i}. {r['request_id']} — {str(r['type']).upper()} ({r['status']})\n")
        m.append(f"- **Order:** {r['order']} | **Customer:** {r['customer']} | **Phone:** {r['phone']}")
        m.append(f"- **Items:** {r['items']}")
        m.append(f"- **Reason:** {r['reason']}")
        line = f"- **Requested:** {fmt(r['created_at'])}"
        if r['approved_at']:
            line += f" | **Approved:** {fmt(r['approved_at'])} ({human(r['ms_approve'])} after request)"
        m.append(line)
        m.append('\n**🚚 Pickup (Reverse Leg)**\n')
        m.append('| Field | Value |\n|---|---|')
        m.append(f"| Carrier | {r['pickup_carrier']} |")
        m.append(f"| AWB | {r['pickup_awb']} |")
        m.append(f"| Pickup scheduled | {fmt_date(r['pickup_date'])} |")
        m.append(f"| Picked up at | {fmt(r['picked_up_at'])} |")
        m.append(f"| In transit at | {fmt(r['in_transit_at'])} |")
        m.append(f"| Delivered to warehouse | {fmt(r['delivered_at'])} |")
        m.append(f"| Inspected at | {fmt(r['inspected_at'])} |")
        if r['ms_transit'] is not None:
            m.append(f"| Pickup → warehouse transit time | {human(r['ms_transit'])} |")
        if r['type'] == 'exchange':
            m.append('\n**📦 Forward (Replacement) Shipment**\n')
            m.append('| Field | Value |\n|---|---|')
            m.append(f"| Forward carrier | {r['forward_carrier']} |")
            m.append(f"| Forward AWB | {r['forward_awb']} |")
            m.append(f"| Forward status | {r['forward_status']} |")
        m.append('\n**⏱ Completion**\n')
        if r['ms_complete'] is not None:
            m.append(f"- Completed: **{fmt(r['completed_at'])}** (basis: {r['completion_basis']})")
            m.append(f"- **Total time to completion: {human(r['ms_complete'])}** ({days_num(r['ms_complete'])} days)")
        else:
            age = duration_ms(r['created_at'], now_iso)
            m.append(f"- ⏳ **Not yet complete** — open for {human(age)} so far")
        m.append('\n---\n')

    m.append('## Notes\n')
    m.append('- All times shown in IST.')
    m.append('- **Completion definition** — Returns: item delivered back to warehouse (or inspected/refunded). Exchanges: forward (replacement) shipment delivered.')
    m.append('- ⚠️ For exchanges the DB has no dedicated "forward delivered at" timestamp; the request\'s last-update time is used as an approximation when forward status = delivered.')

    # ── Write files ──
    out_dir = os.path.join(BASE_DIR, 'reports')
    os.makedirs(out_dir, exist_ok=True)
    md_path = os.path.join(out_dir, f'requests-last-{DAYS}-days.md')
    csv_path = os.path.join(out_dir, f'requests-last-{DAYS}-days.csv')

    with open(md_path, 'w') as f:
        f.write('\n'.join(m) + '\n')

    with open(csv_path, 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['Request ID', 'Order', 'Customer', 'Phone', 'Type', 'Status', 'Reason', 'Items',
                    'Created At', 'Approved At', 'Hours To Approve',
                    'Pickup Carrier', 'Pickup AWB', 'Pickup Scheduled Date', 'Picked Up At', 'In Transit At',
                    'Delivered To Warehouse At', 'Inspected At',
                    'Forward Carrier', 'Forward AWB', 'Forward Status',
                    'Completed At', 'Completion Basis', 'Completion Time (days)'])
        for r in rows:
            w.writerow([
                r['request_id'], r['order'], r['customer'], r['phone'], r['type'], r['status'], r['reason'], r['items'],
                r['created_at'] or '', r['approved_at'] or '',
                round(r['ms_approve'] / 3600000, 1) if r['ms_approve'] is not None else '',
                r['pickup_carrier'], r['pickup_awb'], r['pickup_date'] or '', r['picked_up_at'] or '',
                r['in_transit_at'] or '', r['delivered_at'] or '', r['inspected_at'] or '',
                r['forward_carrier'], r['forward_awb'], r['forward_status'],
                r['completed_at'] or '', r['completion_basis'] or '',
                days_num(r['ms_complete']) if days_num(r['ms_complete']) is not None else '',
            ])

    print(f'\n📄 Markdown report: {md_path}')
    print(f'📊 CSV report:      {csv_path}')
    print(f'\nSummary: {total} requests | {len(completed)} completed | '
          f'avg completion {human(avg(completion_times))}')


if __name__ == '__main__':
    main()
