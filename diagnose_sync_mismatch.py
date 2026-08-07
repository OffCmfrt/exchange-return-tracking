#!/usr/bin/env python3
"""
DIAGNOSTIC (READ-ONLY): why dashboard statuses don't match Delhivery/Shiprocket.
Replicates server.js sync logic (detectCarrier + mapCarrierStatus + isForwardProgress)
against LIVE carrier APIs. No DB writes. Usage: python3 diagnose_sync_mismatch.py
"""
import json, os, re, sys, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor

def load_env(path='.env'):
    env = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV = load_env()

def http(url, headers=None, method='GET', body=None, timeout=30):
    req = urllib.request.Request(url, method=method, headers=headers or {})
    data = json.dumps(body).encode() if body is not None else None
    if data: req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, data=data, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try: payload = e.read().decode()[:300]
        except Exception: payload = ''
        return e.code, {'__error__': payload}
    except Exception as e:
        return 0, {'__error__': str(e)}

# ---------- server.js logic ports ----------
STATUS_RANK = {'waiting_payment':0,'pending':0,'pickup_pending':1,'scheduled':2,
               'pickup_booked':2,'picked_up':3,'in_transit':4,'out_for_delivery':5,'delivered':6}

def is_forward_progress(cur, nxt):
    return STATUS_RANK.get(nxt, -1) > STATUS_RANK.get(cur, -1)

def detect_carrier(awb, shipment_id, carrier_field, fallback_reason):
    c = (carrier_field or '').strip().lower()
    awb_s = str(awb or '').strip()
    ship_s = str(shipment_id or '').strip()
    if c in ('delhivery', 'shiprocket'): return c
    if ship_s.upper().startswith('SR'): return 'shiprocket'
    if fallback_reason: return 'delhivery'
    if awb_s:
        if re.match(r'^\d{12,}$', awb_s): return 'delhivery'
        if re.search(r'[a-zA-Z]', awb_s): return 'shiprocket'
    return 'shiprocket'

def map_carrier_status(carrier_status, carrier='shiprocket', status_type=None):
    if not carrier_status and not status_type: return None
    s = str(carrier_status or '').upper().strip()
    st = str(status_type or '').upper().strip()
    dlv = carrier == 'delhivery'
    def has(*tokens): return any(t in s for t in tokens)

    if has('UNDELIVERED','NOT DELIVERED','DELIVERY FAILED','FAILED DELIVERY','DELIVERY ATTEMPTED','ATTEMPTED DELIVERY'):
        return {'status':'exception','shouldUpdate':False,'needsNote':True}
    if st == 'RT' or has('RTO','RETURN TO ORIGIN','RETURN INITIATED','RETURN ACCEPTED') or (dlv and 'DTO' in s and 'DELIVERED' not in s and st != 'DL'):
        return {'status':'exception','shouldUpdate':False,'needsNote':True}
    if has('LOST','DAMAGED','DESTROYED','CANCELLED','CANCELED','PICKUP ERROR','PICKUP FAILED'):
        return {'status':'exception','shouldUpdate':False,'needsNote':True}
    if st == 'DL' or has('DELIVERED','DTO DELIVERED','RETURN RECEIVED','RECEIVED AT WAREHOUSE','RECEIVED AT ORIGIN') or s == 'CLOSED':
        return {'status':'delivered','shouldUpdate':True}
    if has('OUT FOR DELIVERY','OUT FOR DEL','OFD') or (dlv and has('DISPATCHED')):
        return {'status':'out_for_delivery','shouldUpdate':True}
    if has('IN TRANSIT','IN-TRANSIT','INTRANSIT','SHIPPED','PENDING DELIVERY','REACHED DESTINATION','REACHED AT DESTINATION','ARRIVED AT','IN NETWORK') or ((not dlv) and has('DISPATCHED')):
        return {'status':'in_transit','shouldUpdate':True}
    if (st == 'PU' and not has('NOT PICKED')) or (has('PICKED UP','PICKUP DONE','PICKUP COMPLETE','SHIPMENT PICKED') and not has('NOT PICKED','PICKUP GENERATED','PICKUP SCHEDULED','PICKUP CREATED','AWAITING')):
        return {'status':'picked_up','shouldUpdate':True}
    if has('OUT FOR PICKUP','PICKUP SCHEDULED','PICKUP RESCHEDULED','PICKUP QUEUED','PICKUP ASSIGNED','PICKUP BOOKED','SCHEDULED') or (dlv and (has('MANIFESTED','NOT PICKED') or s == 'OPEN')):
        return {'status':'pickup_booked','shouldUpdate':True}
    if has('PICKUP GENERATED','AWB ASSIGNED','LABEL GENERATED','PICKUP CREATED','REGISTERED','MANIFEST GENERATED','MANIFEST UPLOADED','DATA RECEIVED','DATA UPLOAD','INFORMATION RECEIVED','ORDER CREATED'):
        return {'status':'pickup_pending','shouldUpdate':True}
    if dlv and st == 'UD':
        return {'status':'in_transit','shouldUpdate':True}
    if has('DELAYED','EXCEPTION','ON HOLD','HELD','ADDRESS ISSUE','CONSIGNEE','NOT AVAILABLE','REFUSED','MISROUTED','REDIRECTED','REJECTED'):
        return {'status':'exception','shouldUpdate':False,'needsNote':True}
    return {'status':None,'shouldUpdate':False}

# ---------- carrier clients ----------
SR_TOKEN = None
def sr_token():
    global SR_TOKEN
    if SR_TOKEN: return SR_TOKEN
    code, data = http('https://apiv2.shiprocket.in/v1/external/auth/login', method='POST',
                      body={'email': ENV.get('SHIPROCKET_EMAIL'), 'password': ENV.get('SHIPROCKET_PASSWORD')})
    if code != 200 or not data or not data.get('token'):
        raise RuntimeError(f'Shiprocket auth failed: {code} {data}')
    SR_TOKEN = data['token']
    return SR_TOKEN

def track_shiprocket(awb, shipment_id):
    tok = sr_token()
    hdr = {'Authorization': f'Bearer {tok}'}
    out = {'error': None, 'status': None, 'source': 'awb', 'track_status': None, 'shipment_status': None, 'sr_error': None}
    def extract(data):
        td = (data or {}).get('tracking_data') or {}
        stk = td.get('shipment_track') or []
        status = (stk[0].get('current_status') if stk and isinstance(stk[0], dict) else None) or td.get('current_status')
        return td, status
    if awb:
        code, data = http(f'https://apiv2.shiprocket.in/v1/external/courier/track/awb/{awb}', headers=hdr)
        if code == 200:
            td, status = extract(data)
            out.update(track_status=td.get('track_status'), shipment_status=td.get('shipment_status'), sr_error=td.get('error'))
            if status:
                out['status'] = status; return out
        else:
            out['error'] = f'AWB HTTP {code}: {json.dumps(data)[:200]}'
    if shipment_id:
        sid = re.sub(r'^SR', '', str(shipment_id), flags=re.I)
        code, data = http(f'https://apiv2.shiprocket.in/v1/external/courier/track/shipment/{sid}', headers=hdr)
        if code == 200:
            td, status = extract(data)
            if status:
                out.update(status=status, source='shipmentId', error=None,
                           track_status=td.get('track_status'), shipment_status=td.get('shipment_status'), sr_error=td.get('error'))
                return out
            if out['sr_error'] is None: out['sr_error'] = td.get('error')
        elif not out['error']:
            out['error'] = f'ShipmentID HTTP {code}: {json.dumps(data)[:200]}'
    return out

def track_delhivery(awb):
    code, data = http(f'https://track.delhivery.com/api/v1/packages/json/?waybill={awb}',
                      headers={'Authorization': f"Token {ENV.get('DELHIVERY_API_KEY')}"})
    if code != 200:
        return {'error': f'HTTP {code}: {json.dumps(data)[:200]}'}
    sd = (data or {}).get('ShipmentData') or []
    if not sd:
        return {'error': f'No ShipmentData: {json.dumps(data)[:200]}'}
    s = sd[0].get('Shipment') or {}
    st = s.get('Status') or {}
    return {'error': None, 'status': st.get('Status'), 'status_type': str(st.get('StatusType') or '').upper() or None,
            'status_date': st.get('StatusDateTime')}

# ---------- main ----------
def main():
    sb_url, sb_key = ENV['SUPABASE_URL'], ENV['SUPABASE_SERVICE_ROLE_KEY']
    hdr = {'apikey': sb_key, 'Authorization': f'Bearer {sb_key}'}
    q = ('or=(status.eq.pending,status.eq.pickup_pending,status.eq.pickup_booked,status.eq.scheduled,status.eq.picked_up,status.eq.in_transit)'
         '&awb_number=not.is.null'
         '&select=request_id,status,carrier,awb_number,shipment_id,carrier_fallback_reason,last_sync_attempt,last_sync_error,created_at'
         '&order=created_at.desc&limit=1000')
    code, rows = http(f'{sb_url}/rest/v1/requests?{q}', headers=hdr)
    if code != 200:
        print('DB error:', code, rows); sys.exit(1)
    print(f'=== SYNC MISMATCH DIAGNOSTIC (read-only) ===\nActive requests with AWB (same filter as background sync): {len(rows)}\n')

    buckets = {k: [] for k in ('would_update','fetch_failed','no_data','unmapped','blocked','exception','up_to_date')}

    def check(r):
        carrier = detect_carrier(r['awb_number'], r.get('shipment_id'), r.get('carrier'), r.get('carrier_fallback_reason'))
        line = f"{r['request_id']} [{r['status']}] {carrier} AWB={r['awb_number']}"
        try:
            if carrier == 'delhivery':
                t = track_delhivery(r['awb_number'])
                if t.get('error'):
                    buckets['fetch_failed'].append(f"{line} -> {t['error']}"); return
                raw, stype = t['status'], t.get('status_type')
                extra = f" (StatusType={stype}, at {t.get('status_date')})"
            else:
                t = track_shiprocket(r['awb_number'], r.get('shipment_id'))
                raw, stype, extra = t.get('status'), None, f" (via {t.get('source')})"
                # Cross-carrier rescue (mirrors fixed server.js): Delhivery-format
                # AWB mislabeled as Shiprocket -> try Delhivery account.
                if not raw and re.match(r'^\d{12,}$', str(r['awb_number']).strip()):
                    t2 = track_delhivery(r['awb_number'])
                    if not t2.get('error') and (t2.get('status') or t2.get('status_type')):
                        carrier = 'delhivery'
                        raw, stype = t2['status'], t2.get('status_type')
                        extra = f" (RESCUED via Delhivery, StatusType={stype})"
                if not raw:
                    if t.get('error'):
                        buckets['fetch_failed'].append(f"{line} -> {t['error']}"); return
                    buckets['no_data'].append(f"{line} -> track_status={t.get('track_status')}, sr_error=\"{t.get('sr_error') or ''}\" (NO current_status)"); return
            if not raw and not stype:
                buckets['no_data'].append(f'{line} -> empty status'); return
            m = map_carrier_status(raw, carrier, stype)
            detail = f'{line} | carrier says: "{raw}"{extra} -> maps to: {m["status"] if m else None}'
            if not m or (not m.get('shouldUpdate') and not m.get('needsNote') and not m.get('status')):
                buckets['unmapped'].append(detail + '  ** UNMAPPED - sync silently ignores')
            elif m.get('needsNote') and not m.get('shouldUpdate'):
                buckets['exception'].append(detail + '  (exception: note only, status frozen)')
            elif m.get('shouldUpdate') and m.get('status'):
                if m['status'] == r['status']:
                    buckets['up_to_date'].append(detail)
                elif is_forward_progress(r['status'], m['status']):
                    buckets['would_update'].append(detail + f"  >> sync SHOULD update {r['status']} -> {m['status']}")
                else:
                    buckets['blocked'].append(detail + f"  XX blocked by isForwardProgress ({r['status']} >= {m['status']})")
        except Exception as e:
            buckets['fetch_failed'].append(f'{line} -> EXCEPTION: {e}')

    with ThreadPoolExecutor(max_workers=6) as ex:
        list(ex.map(check, rows))

    def section(title, key):
        arr = buckets[key]
        print(f'\n----- {title} ({len(arr)}) -----')
        for l in arr: print('  ' + l)

    section('WOULD UPDATE - carrier ahead, sync logic should fix these', 'would_update')
    section('FETCH FAILED - API/auth/expired-AWB', 'fetch_failed')
    section('NO TRACKING DATA - Shiprocket returned nothing usable', 'no_data')
    section('UNMAPPED STATUS - not recognized by mapCarrierStatus', 'unmapped')
    section('BLOCKED - not forward progress', 'blocked')
    section('EXCEPTION (note-only by design)', 'exception')
    print(f"\n----- Already in sync: {len(buckets['up_to_date'])} -----")
    for l in buckets['up_to_date']: print('  ' + l)

if __name__ == '__main__':
    main()
