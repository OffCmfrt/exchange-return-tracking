#!/usr/bin/env python3
"""
Build a multi-sheet Excel (.xlsx) workbook of all requests in the last N days.

Sheets:
  - Summary       : headline metrics + status/carrier/reason breakdowns
  - All Requests  : every request with full pickup + forward + completion columns
  - Exchanges     : exchanges only (forward/replacement focus)
  - Returns       : returns only

No third-party libraries required — writes the .xlsx (zip of XML) by hand.
Reuses data helpers from generate_report.py.

Usage: python3 generate_excel.py [days]
"""
import os
import sys
import zipfile
from datetime import datetime, timedelta, timezone

import generate_report as R  # reuse fetch + helpers + .env loading

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 30
BASE_DIR = os.path.dirname(os.path.abspath(__file__))


# ── XLSX low-level helpers ──
def col_letter(idx):
    """0-based column index -> Excel letter (A, B, ... AA)."""
    s = ''
    idx += 1
    while idx:
        idx, rem = divmod(idx - 1, 26)
        s = chr(65 + rem) + s
    return s


def xml_escape(v):
    return (str(v).replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


def cell_xml(col, row, value, style=None):
    ref = f'{col_letter(col)}{row}'
    st = f' s="{style}"' if style is not None else ''
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"{st}><v>{value}</v></c>'
    if value is None or value == '':
        return f'<c r="{ref}"{st}/>'
    return f'<c r="{ref}"{st} t="inlineStr"><is><t xml:space="preserve">{xml_escape(value)}</t></is></c>'


def sheet_xml(rows, header_style=1, freeze_header=True, autofilter_cols=None):
    """rows: list of lists. First row treated as header (bold style)."""
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>']
    out.append('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
    if freeze_header:
        out.append('<sheetViews><sheetView workbookViewId="0">'
                   '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
                   '</sheetView></sheetViews>')
    # rough column widths
    if rows:
        ncols = max(len(r) for r in rows)
        out.append('<cols>')
        for c in range(ncols):
            out.append(f'<col min="{c+1}" max="{c+1}" width="20" customWidth="1"/>')
        out.append('</cols>')
    out.append('<sheetData>')
    for ri, row in enumerate(rows, 1):
        out.append(f'<row r="{ri}">')
        for ci, val in enumerate(row):
            style = header_style if ri == 1 else None
            out.append(cell_xml(ci, ri, val, style))
        out.append('</row>')
    out.append('</sheetData>')
    if autofilter_cols and rows:
        out.append(f'<autoFilter ref="A1:{col_letter(autofilter_cols-1)}{len(rows)}"/>')
    out.append('</worksheet>')
    return ''.join(out)


def build_xlsx(path, sheets):
    """sheets: list of (name, rows)."""
    content_types = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
                     '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
                     '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
                     '<Default Extension="xml" ContentType="application/xml"/>',
                     '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
                     '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>']
    for i in range(len(sheets)):
        content_types.append(f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" '
                             f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>')
    content_types.append('</Types>')

    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                 '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                 '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                 '</Relationships>')

    wb = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>']
    for i, (name, _) in enumerate(sheets):
        safe = xml_escape(name)[:31]
        wb.append(f'<sheet name="{safe}" sheetId="{i+1}" r:id="rId{i+1}"/>')
    wb.append('</sheets></workbook>')

    wb_rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
               '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">']
    for i in range(len(sheets)):
        wb_rels.append(f'<Relationship Id="rId{i+1}" '
                       f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                       f'Target="worksheets/sheet{i+1}.xml"/>')
    wb_rels.append(f'<Relationship Id="rId{len(sheets)+1}" '
                   f'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
                   f'Target="styles.xml"/>')
    wb_rels.append('</Relationships>')

    # styles: index 0 = normal, index 1 = bold (header) with fill
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
              '<fonts count="2">'
              '<font><sz val="11"/><name val="Calibri"/></font>'
              '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>'
              '</fonts>'
              '<fills count="3">'
              '<fill><patternFill patternType="none"/></fill>'
              '<fill><patternFill patternType="gray125"/></fill>'
              '<fill><patternFill patternType="solid"><fgColor rgb="FF2F5496"/><bgColor indexed="64"/></patternFill></fill>'
              '</fills>'
              '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
              '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
              '<cellXfs count="2">'
              '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
              '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
              '</cellXfs>'
              '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
              '</styleSheet>')

    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ''.join(content_types))
        z.writestr('_rels/.rels', root_rels)
        z.writestr('xl/workbook.xml', ''.join(wb))
        z.writestr('xl/_rels/workbook.xml.rels', ''.join(wb_rels))
        z.writestr('xl/styles.xml', styles)
        for i, (_, rows) in enumerate(sheets):
            ncols = max((len(r) for r in rows), default=1)
            z.writestr(f'xl/worksheets/sheet{i+1}.xml',
                       sheet_xml(rows, autofilter_cols=ncols))


# ── Build report rows (mirrors generate_report.py) ──
def main():
    since = datetime.now(timezone.utc) - timedelta(days=DAYS)
    since_iso = since.isoformat()
    print(f'📊 Fetching requests since {R.fmt(since_iso)} IST (last {DAYS} days)...')
    requests = R.fetch_requests(since_iso)
    print(f'✅ Found {len(requests)} requests')

    now_iso = datetime.now(timezone.utc).isoformat()
    data = []
    for r in requests:
        completed_at, basis = R.resolve_completion(r)
        ms_complete = R.duration_ms(r.get('created_at'), completed_at)
        ms_approve = R.duration_ms(r.get('created_at'), r.get('approved_at'))
        ms_transit = R.duration_ms(r.get('picked_up_at'), r.get('delivered_at'))
        data.append({
            'request_id': r.get('request_id'),
            'order': r.get('order_number'),
            'customer': r.get('customer_name') or '',
            'phone': r.get('customer_phone') or '',
            'type': r.get('type'),
            'status': r.get('status'),
            'reason': r.get('reason') or '',
            'items': R.items_summary(r.get('items')),
            'created_at': R.fmt(r.get('created_at')),
            'approved_at': R.fmt(r.get('approved_at')),
            'hours_to_approve': round(ms_approve / 3600000, 1) if ms_approve is not None and ms_approve >= 0 else '',
            'pickup_carrier': r.get('carrier') or '',
            'pickup_awb': r.get('carrier_awb') or r.get('awb_number') or '',
            'pickup_scheduled': R.fmt_date(r.get('pickup_date')),
            'picked_up_at': R.fmt(r.get('picked_up_at')),
            'in_transit_at': R.fmt(r.get('in_transit_at')),
            'delivered_at': R.fmt(r.get('delivered_at')),
            'inspected_at': R.fmt(r.get('inspected_at')),
            'transit_time': R.human(ms_transit) if ms_transit is not None else '',
            'forward_carrier': r.get('forward_carrier') or '',
            'forward_awb': r.get('forward_awb_number') or '',
            'forward_status': r.get('forward_status') or '',
            'completed_at': R.fmt(completed_at),
            'completion_basis': basis or '',
            'completion_days': R.days_num(ms_complete) if R.days_num(ms_complete) is not None else '',
            'completion_human': R.human(ms_complete),
            '_ms_complete': ms_complete,
            '_type': r.get('type'),
        })

    # ── Sheet: All Requests ──
    full_header = ['Request ID', 'Order', 'Customer', 'Phone', 'Type', 'Status', 'Reason', 'Items',
                   'Created At', 'Approved At', 'Hrs To Approve',
                   'Pickup Carrier', 'Pickup AWB', 'Pickup Scheduled', 'Picked Up At', 'In Transit At',
                   'Delivered To WH', 'Inspected At', 'Pickup→WH Transit',
                   'Forward Carrier', 'Forward AWB', 'Forward Status',
                   'Completed At', 'Completion Basis', 'Completion (days)', 'Completion (h/d)']

    def to_row(d):
        return [d['request_id'], d['order'], d['customer'], d['phone'], d['type'], d['status'], d['reason'], d['items'],
                d['created_at'], d['approved_at'], d['hours_to_approve'],
                d['pickup_carrier'], d['pickup_awb'], d['pickup_scheduled'], d['picked_up_at'], d['in_transit_at'],
                d['delivered_at'], d['inspected_at'], d['transit_time'],
                d['forward_carrier'], d['forward_awb'], d['forward_status'],
                d['completed_at'], d['completion_basis'], d['completion_days'], d['completion_human']]

    all_rows = [full_header] + [to_row(d) for d in data]

    # ── Sheet: Exchanges (forward focus) ──
    ex_header = ['Request ID', 'Order', 'Customer', 'Phone', 'Status', 'Reason', 'Items', 'Created At',
                 'Pickup Carrier', 'Pickup AWB', 'Picked Up At', 'Delivered To WH',
                 'Forward Carrier', 'Forward AWB', 'Forward Status',
                 'Completed At', 'Completion (days)', 'Completion (h/d)']
    ex_rows = [ex_header]
    for d in data:
        if d['_type'] != 'exchange':
            continue
        ex_rows.append([d['request_id'], d['order'], d['customer'], d['phone'], d['status'], d['reason'], d['items'],
                        d['created_at'], d['pickup_carrier'], d['pickup_awb'], d['picked_up_at'], d['delivered_at'],
                        d['forward_carrier'], d['forward_awb'], d['forward_status'],
                        d['completed_at'], d['completion_days'], d['completion_human']])

    # ── Sheet: Returns ──
    ret_header = ['Request ID', 'Order', 'Customer', 'Phone', 'Status', 'Reason', 'Items', 'Created At',
                  'Pickup Carrier', 'Pickup AWB', 'Pickup Scheduled', 'Picked Up At', 'In Transit At',
                  'Delivered To WH', 'Inspected At', 'Completed At', 'Completion (days)', 'Completion (h/d)']
    ret_rows = [ret_header]
    for d in data:
        if d['_type'] != 'return':
            continue
        ret_rows.append([d['request_id'], d['order'], d['customer'], d['phone'], d['status'], d['reason'], d['items'],
                         d['created_at'], d['pickup_carrier'], d['pickup_awb'], d['pickup_scheduled'], d['picked_up_at'],
                         d['in_transit_at'], d['delivered_at'], d['inspected_at'],
                         d['completed_at'], d['completion_days'], d['completion_human']])

    # ── Sheet: Summary ──
    exchanges = [d for d in data if d['_type'] == 'exchange']
    returns = [d for d in data if d['_type'] == 'return']
    completed = [d for d in data if d['_ms_complete'] is not None]
    comp_all = [d['_ms_complete'] for d in completed]
    comp_ex = [d['_ms_complete'] for d in exchanges if d['_ms_complete'] is not None]
    comp_ret = [d['_ms_complete'] for d in returns if d['_ms_complete'] is not None]

    def cnt(key, subset=data):
        c = {}
        for d in subset:
            c[d[key]] = c.get(d[key], 0) + 1
        return sorted(c.items(), key=lambda x: -x[1])

    total = len(data)
    summary = [
        ['Requests Report — Last ' + str(DAYS) + ' Days'],
        ['Generated', R.fmt(now_iso) + ' IST'],
        ['Period', f'{R.fmt_date(since_iso)} → {R.fmt_date(now_iso)}'],
        [],
        ['Metric', 'Value'],
        ['Total requests', total],
        ['Returns', len(returns)],
        ['Exchanges', len(exchanges)],
        ['Completed', len(completed)],
        ['Still open / in progress', total - len(completed)],
        ['Avg completion time (all)', R.human(R.avg(comp_all))],
        ['Median completion time (all)', R.human(R.median(comp_all))],
        ['Avg completion time (returns)', R.human(R.avg(comp_ret))],
        ['Avg completion time (exchanges)', R.human(R.avg(comp_ex))],
        [],
        ['Status', 'Count'],
    ]
    for s, c in cnt('status'):
        summary.append([s, c])
    summary.append([])
    summary.append(['Pickup Carrier', 'Count'])
    for s, c in cnt('pickup_carrier'):
        summary.append([s or '(none)', c])
    summary.append([])
    summary.append(['Reason', 'Count'])
    for s, c in cnt('reason'):
        summary.append([s or '(none)', c])
    summary.append([])
    summary.append(['Forward Status (exchanges)', 'Count'])
    for s, c in cnt('forward_status', exchanges):
        summary.append([s or '(none)', c])

    out_dir = os.path.join(BASE_DIR, 'reports')
    os.makedirs(out_dir, exist_ok=True)
    xlsx_path = os.path.join(out_dir, f'requests-last-{DAYS}-days.xlsx')
    build_xlsx(xlsx_path, [
        ('Summary', summary),
        ('All Requests', all_rows),
        ('Exchanges', ex_rows),
        ('Returns', ret_rows),
    ])

    print(f'\n📊 Excel workbook: {xlsx_path}')
    print(f'   Sheets: Summary | All Requests ({len(all_rows)-1}) | '
          f'Exchanges ({len(ex_rows)-1}) | Returns ({len(ret_rows)-1})')


if __name__ == '__main__':
    main()
