'use strict';

// Outbound exchange metadata; never substitute a reverse pickup reference.
const crypto = require('node:crypto');
const clean = value => value == null || ['undefined', 'null'].includes(String(value)) ? '' : String(value).trim();
const array = value => {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
};
const digest = values => crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');

function outgoingItems(value) {
    return array(value).map(item => {
        const sameVariant = clean(item.replacementVariantId) && clean(item.replacementVariantId) === clean(item.variantId || item.variant_id);
        const variant = clean(item.replacementVariant || (sameVariant ? item.variant : ''));
        return {
            title: clean(item.replacementProductTitle || item.name || item.title) || 'Replacement product',
            variant, size: clean(item.replacementSize) || variant,
            sku: clean(item.replacementSku || item.replacementSKU || (sameVariant ? item.sku : '')),
            variant_id: clean(item.replacementVariantId),
            quantity: Math.max(1, Math.min(1000, parseInt(item.quantity, 10) || 1))
        };
    });
}

function dispatchEvent(request, carrier, shipmentId, awb, items) {
    return {
        action: 'forward_dispatched', timestamp: new Date().toISOString(),
        forwardCarrier: carrier, forwardShipmentId: clean(shipmentId), forwardAwbNumber: clean(awb),
        outgoingItems: outgoingItems(items), requestId: request.requestId
    };
}

function normalizeRequest(row) {
    const requestId = clean(row.request_id);
    const carrier = clean(row.forward_carrier).toLowerCase();
    const shipmentId = clean(row.forward_shipment_id);
    const awb = clean(row.forward_awb_number);
    const history = array(row.request_history);
    const events = history.filter(e => e && e.action === 'forward_dispatched');
    const event = [...events].reverse().find(e => clean(e.forwardCarrier) === carrier &&
        ((shipmentId && clean(e.forwardShipmentId) === shipmentId) || (!shipmentId && awb && clean(e.forwardAwbNumber) === awb)));
    const legacy = history.filter(e => e && e.action === 'resolution_selected' && e.resolution === 'exchange');
    const legacySafe = !events.length && legacy.length === 1 && !/Duplicate forward order|re-dispatched/i.test(row.admin_notes || '');
    const date = event?.timestamp || (legacySafe ? legacy[0].timestamp : null);
    const dispatchedAt = date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null;
    const booked = Boolean(shipmentId || awb);
    return {
        request_id: requestId, order_number: clean(row.order_number),
        customer_name: clean(row.customer_name), customer_phone: clean(row.customer_phone),
        destination: {
            address: clean(row.new_address || row.shipping_address), city: clean(row.new_city || row.shipping_city),
            state: clean(row.new_state || row.shipping_state), pincode: clean(row.new_pincode || row.shipping_pincode)
        },
        original_items: array(row.items).map(i => ({ title: clean(i.name || i.title), variant: clean(i.variant), sku: clean(i.sku), quantity: Number(i.quantity) || 1 })),
        items: event && Array.isArray(event.outgoingItems) ? event.outgoingItems : outgoingItems(row.items),
        carrier, carrier_shipment_id: shipmentId, awb,
        status: clean(row.forward_status) || 'scheduled', request_status: clean(row.status),
        dispatched_at: dispatchedAt, date_source: event ? 'booking_event' : dispatchedAt ? 'resolution_history' : 'unknown',
        source_updated_at: row.updated_at || null, booked,
        booking_key: booked ? digest([requestId, carrier, shipmentId ? `id:${shipmentId}` : `awb:${awb}`]) : null,
        identity: digest([requestId, carrier, shipmentId, awb])
    };
}

const https = require('node:https');
const dns = require('node:dns').promises;
const net = require('node:net');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const validId = value => typeof value === 'string' && /^[\w#-]{1,120}$/.test(value);
const FIELDS = 'request_id,order_number,type,resolution,status,customer_name,customer_phone,shipping_address,shipping_city,shipping_state,shipping_pincode,new_address,new_city,new_state,new_pincode,items,forward_carrier,forward_shipment_id,forward_awb_number,forward_status,request_history,admin_notes,updated_at';

function authenticate(req, res, next) {
    const expected = process.env.WHATSAPP_INTERNAL_TOKEN;
    if (!expected) return res.status(503).json({ success: false, error: 'Dispatch integration is not configured' });
    const provided = req.headers['x-internal-token'];
    if (typeof provided !== 'string' || !crypto.timingSafeEqual(Buffer.from(digest([provided])), Buffer.from(digest([expected])))) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}

function publicAddress(address) {
    const ip = address.toLowerCase();
    if (net.isIP(ip) === 4) {
        const [a, b, c] = ip.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) ||
            (a === 198 && [18, 19, 51].includes(b)) || (a === 192 && b === 0) || (a === 203 && b === 0 && c === 113));
    }
    // IPv6 connections use globally routable unicast addresses only.
    return net.isIP(ip) === 6 && /^[23]/.test(ip) && !ip.startsWith('2001:') && !ip.startsWith('2002:');
}
function trustedHost(host) {
    return ['delhivery.com', 'ekartlogistics.in', 'shiprocket.in', 'amazonaws.com'].some(d => host === d || host.endsWith(`.${d}`));
}

// Pin validated DNS addresses; repeat validation for each redirect. Never forward credentials across origins.
async function carrierRequest(rawUrl, { method = 'GET', headers = {}, body, signal, redirects = 0 } = {}) {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !trustedHost(url.hostname)) throw fail('Untrusted carrier label destination', 502);
    signal?.throwIfAborted();
    const addresses = await dns.lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) throw fail('Unsafe carrier label destination', 502);
    signal?.throwIfAborted();
    const pinned = addresses[0];
    return new Promise((resolve, reject) => {
        const request = https.request(url, {
            method, headers, signal, agent: false,
            lookup: (_host, options, callback) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)
        }, response => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                response.resume();
                if (redirects >= 3 || !response.headers.location) return reject(fail('Carrier label redirect limit reached', 502));
                const next = new URL(response.headers.location, url);
                return carrierRequest(next.href, { headers: next.origin === url.origin ? headers : {}, signal, redirects: redirects + 1 }).then(resolve, reject);
            }
            if (response.statusCode < 200 || response.statusCode >= 300) {
                response.resume();
                return reject(fail(`Carrier label request failed (${response.statusCode})`, 502));
            }
            const chunks = [];
            let bytes = 0;
            response.on('data', chunk => {
                bytes += chunk.length;
                if (bytes > 10 * 1024 * 1024) {
                    const error = fail('Carrier PDF exceeds 10 MB', 413);
                    reject(error);
                    response.destroy();
                    request.destroy(error);
                } else chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () => resolve(Buffer.concat(chunks)));
        });
        request.setTimeout(25000, () => request.destroy(fail('Carrier label request timed out', 504)));
        request.on('error', reject);
        if (body) request.write(body);
        request.end();
    });
}

const isPdf = buffer => Buffer.isBuffer(buffer) && buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'));
function printable(dispatch) {
    return !['cancelled', 'canceled', 'failed', 'rto', 'rto_delivered'].includes(dispatch.status.toLowerCase()) &&
        !['cancelled', 'canceled', 'rejected', 'failed'].includes(dispatch.request_status.toLowerCase());
}
async function retrieveLabel(dispatch, { getEkartToken, getShiprocketToken }, signal) {
    if (!dispatch.awb) throw fail('Forward shipment is awaiting AWB', 409);
    if (!printable(dispatch)) throw fail('Forward shipment is not printable', 409);
    const call = (url, options = {}) => carrierRequest(url, { ...options, signal });
    let buffer;
    if (dispatch.carrier === 'delhivery') {
        if (!process.env.DELHIVERY_API_KEY) throw fail('Delhivery label credentials are not configured', 503);
        const base = 'https://track.delhivery.com';
        buffer = await call(`${base}/api/p/packing_slip?wbns=${encodeURIComponent(dispatch.awb)}&pdf=true&pdf_size=4R`, { headers: { Authorization: `Token ${process.env.DELHIVERY_API_KEY}` } });
        if (!isPdf(buffer)) {
            let data;
            try { data = JSON.parse(buffer.toString()); } catch (_) { throw fail('Delhivery returned an invalid label response', 502); }
            const pkg = (Array.isArray(data.packages) ? data.packages : []).find(p => clean(p.wbn || p.waybill) === dispatch.awb);
            const link = pkg?.pdf_download_link || pkg?.pdf_link || data.pdf_download_link || data.pdf_link;
            if (!link) throw fail('Delhivery label is not ready', 502);
            const url = new URL(link, base);
            if (url.protocol === 'http:') url.protocol = 'https:';
            buffer = await call(url.href);
        }
    } else if (dispatch.carrier === 'ekart') {
        const token = await getEkartToken(signal);
        const base = (process.env.EKART_BASE_URL || 'https://app.elite.ekartlogistics.in').replace(/\/+$/, '');
        buffer = await call(`${base}/api/v1/package/label?json_only=false`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [dispatch.awb] })
        });
    } else if (dispatch.carrier === 'shiprocket') {
        if (!/^\d+$/.test(dispatch.carrier_shipment_id)) throw fail('Valid forward Shiprocket shipment ID is missing', 409);
        const token = await getShiprocketToken(signal);
        buffer = await call('https://apiv2.shiprocket.in/v1/external/courier/generate/label', {
            method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ shipment_id: [Number(dispatch.carrier_shipment_id)] })
        });
        let data;
        try { data = JSON.parse(buffer.toString()); } catch (_) { throw fail('Shiprocket returned an invalid label response', 502); }
        if (!data.label_url) throw fail('Shiprocket label is not ready', 502);
        buffer = await call(data.label_url);
    } else throw fail('Forward carrier is missing or unsupported', 409);
    if (!isPdf(buffer)) throw fail('Carrier did not return a PDF label', 502);
    return buffer;
}

function mount(app, { supabase, getEkartToken, getShiprocketToken }) {
    const base = '/api/internal/exchange-dispatches';
    const handle = fn => async (req, res) => {
        try { await fn(req, res); }
        catch (error) {
            if (!res.headersSent && !res.destroyed) res.status(error.status || 502).json({ success: false, error: error.status ? error.message : 'Returns dispatch service is unavailable' });
        }
    };
    app.get(base, authenticate, handle(async (req, res) => {
        const cursor = req.query.cursor || '';
        if (cursor && !validId(cursor)) throw fail('Invalid dispatch cursor');
        let query = supabase.from('requests').select(FIELDS).or('type.eq.exchange,resolution.eq.exchange').order('request_id', { ascending: true }).limit(101);
        if (cursor) query = query.gt('request_id', cursor);
        const { data, error } = await query;
        if (error) throw error;
        const rows = data || [];
        res.json({ success: true, dispatches: rows.slice(0, 100).map(normalizeRequest), next_cursor: rows.length > 100 ? rows[99].request_id : null });
    }));
    app.post(`${base}/lookup`, authenticate, handle(async (req, res) => {
        const ids = req.body?.requestIds;
        if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every(validId)) throw fail('Provide 1–100 valid request IDs');
        const { data, error } = await supabase.from('requests').select(FIELDS).in('request_id', [...new Set(ids)]);
        if (error) throw error;
        res.json({ success: true, dispatches: (data || []).filter(r => r.type === 'exchange' || r.resolution === 'exchange').map(normalizeRequest) });
    }));
    app.get(`${base}/:requestId/label`, authenticate, handle(async (req, res) => {
        if (!validId(req.params.requestId) || !/^[a-f0-9]{64}$/.test(req.query.identity || '')) throw fail('Invalid dispatch reference');
        const { data, error } = await supabase.from('requests').select(FIELDS).eq('request_id', req.params.requestId).maybeSingle();
        if (error) throw error;
        if (!data || (data.type !== 'exchange' && data.resolution !== 'exchange')) throw fail('Exchange dispatch not found', 404);
        const dispatch = normalizeRequest(data);
        if (!dispatch.booked || dispatch.identity !== req.query.identity) throw fail('Forward booking changed; refresh dispatches before downloading', 409);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(fail('Carrier label request timed out', 504)), 30000);
        const stop = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', stop);
        try {
            const bytes = await retrieveLabel(dispatch, { getEkartToken, getShiprocketToken }, controller.signal);
            controller.signal.throwIfAborted();
            res.set({ 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' }).send(bytes);
        } catch (error) {
            throw controller.signal.aborted ? controller.signal.reason : error;
        } finally { clearTimeout(timer); res.off('close', stop); }
    }));
}

module.exports = { mount, normalizeRequest, outgoingItems, dispatchEvent, authenticate, publicAddress, trustedHost, carrierRequest, retrieveLabel, printable };
