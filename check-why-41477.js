// Diagnose why order #41477 was allowed to apply for exchange.
// Replays the exact eligibility logic from POST /api/lookup-order with live data.
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const ORDER = '41477';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function shopifyAPI(endpoint) {
    const token = process.env.SHOPIFY_ACCESS_TOKEN;
    const shop = process.env.SHOPIFY_STORE;
    if (!token || !shop) throw new Error('Missing SHOPIFY_ACCESS_TOKEN / SHOPIFY_STORE');
    const res = await fetch(`https://${shop}/admin/api/2024-01/${endpoint}`, {
        headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }
    });
    if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`);
    return res.json();
}

let shiprocketToken = null;
async function shiprocketAPI(path) {
    if (!shiprocketToken) {
        const login = await fetch('https://apiv2.shiprocket.in/v1/external/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD })
        });
        const lj = await login.json();
        shiprocketToken = lj.token;
        if (!shiprocketToken) throw new Error('Shiprocket login failed: ' + JSON.stringify(lj));
    }
    const res = await fetch(`https://apiv2.shiprocket.in/v1/external${path}`, {
        headers: { 'Authorization': `Bearer ${shiprocketToken}` }
    });
    return res.json();
}

async function getSetting(key, def) {
    const { data } = await supabase.from('store_settings').select('value').eq('key', key).maybeSingle();
    return data ? data.value : def;
}

(async () => {
    console.log(`===== Diagnosing eligibility for order #${ORDER} =====\n`);

    // ── 1. Existing request(s) for this order ────────────────────────────────
    const [r1, r2] = await Promise.all([
        supabase.from('requests').select('*').eq('order_number', ORDER),
        supabase.from('requests').select('*').eq('order_number', '#' + ORDER)
    ]);
    const reqs = [...(r1.data || []), ...(r2.data || [])];
    console.log(`[1] Requests in DB for order ${ORDER}: ${reqs.length}`);
    reqs.forEach(r => console.log(`    ${r.request_id} | type=${r.type} | status=${r.status} | created=${r.created_at} | reason=${r.reason} | payment=${r.payment_id || 'none'}`));

    // ── 2. Current settings that gate eligibility ────────────────────────────
    const settings = {
        allow_exchanges: await getSetting('allow_exchanges', true),
        return_window_days: await getSetting('return_window_days', 2),
        return_window_mode: await getSetting('return_window_mode', 'delivery'),
        cutoff_date_enabled: await getSetting('cutoff_date_enabled', false),
        cutoff_date: await getSetting('cutoff_date', null),
        allow_shopper_hub_orders: await getSetting('allow_shopper_hub_orders', true)
    };
    console.log('\n[2] Settings:', JSON.stringify(settings, null, 2));

    // ── 3. Shopify order state ───────────────────────────────────────────────
    let data;
    try {
        data = await shopifyAPI(`orders.json?name=${encodeURIComponent('#' + ORDER)}&status=any&limit=5`);
        if (!data.orders || !data.orders.length) {
            data = await shopifyAPI(`orders.json?name=${encodeURIComponent(ORDER)}&status=any&limit=5`);
        }
    } catch (e) {
        console.error('Shopify fetch failed:', e.message);
        process.exit(1);
    }
    const order = data.orders && data.orders[0];
    if (!order) { console.log('\n[3] Order NOT found in Shopify'); process.exit(0); }

    console.log('\n[3] Shopify order:');
    console.log(`    name=${order.name} | created_at=${order.created_at} | fulfillment_status=${order.fulfillment_status} | financial=${order.financial_status} | channel=${order.source_name || '?'}`);
    console.log(`    customer_email=${order.customer?.email || order.email} | phone=${order.customer?.phone || order.shipping_address?.phone}`);
    (order.fulfillments || []).forEach((f, i) => {
        console.log(`    fulfillment[${i}]: awb=${f.tracking_number || 'none'} | created=${f.created_at} | status=${f.status}`);
    });

    let isFulfilled = order.fulfillment_status === 'fulfilled';

    // ── 4. Shiprocket tracking → delivered_date (what lookup-order sees) ─────
    let deliveredDate = null;
    const awb = order.fulfillments && order.fulfillments[0] && order.fulfillments[0].tracking_number;
    if (awb) {
        try {
            const tracking = await shiprocketAPI(`/courier/track/awb/${awb}`);
            const td = tracking && tracking.tracking_data;
            if (td) {
                deliveredDate = td.delivered_date || null;
                console.log(`\n[4] Shiprocket tracking for AWB ${awb}:`);
                console.log(`    current_status=${td.current_status} | delivered_date=${td.delivered_date || 'NULL'} | etd=${td.etd || '-'} | edd=${td.edd || '-'}`);
                const scans = (td.scans || []).slice(-3);
                scans.forEach(s => console.log(`    last scan: ${s.scan_date} | ${s.scan_type} | ${s.status}`));
            } else {
                console.log(`\n[4] No tracking data returned for AWB ${awb}`);
            }
        } catch (e) {
            console.log(`\n[4] Shiprocket tracking failed: ${e.message}`);
        }
    } else {
        console.log('\n[4] No fulfillment AWB on Shopify order');
    }

    // ── 5. Shopper Hub fallback ──────────────────────────────────────────────
    let shopperHubOrder = false;
    if ((!isFulfilled || !deliveredDate) && settings.allow_shopper_hub_orders) {
        try {
            const { findShopperOrder } = require('./config/shopper-hub-db');
            const shopperInfo = await findShopperOrder(order.name);
            if (shopperInfo) {
                isFulfilled = true;
                shopperHubOrder = true;
                if (!deliveredDate && shopperInfo.deliveredAt) deliveredDate = shopperInfo.deliveredAt;
                console.log(`\n[5] ⚠️  Shopper Hub MATCH: awb=${shopperInfo.awb} orderStatus=${shopperInfo.orderStatus} deliveredAt=${shopperInfo.deliveredAt || 'none'}`);
                console.log('    → lookup-order would force isFulfilled=true here');
            } else {
                console.log('\n[5] No Shopper Hub record for this order');
            }
        } catch (e) {
            console.log('\n[5] Shopper Hub check skipped/failed:', e.message);
        }
    } else {
        console.log('\n[5] Shopper Hub fallback not applicable (already fulfilled+delivered or toggle off)');
    }

    // ── 6. Replay the eligibility decision exactly as /api/lookup-order ──────
    console.log('\n[6] Eligibility replay:');

    if (settings.cutoff_date_enabled && settings.cutoff_date && order.created_at) {
        const cutoff = new Date(settings.cutoff_date); cutoff.setHours(23, 59, 59, 999);
        if (new Date(order.created_at) < cutoff) {
            console.log(`    → BLOCKED by cutoff (${settings.cutoff_date})`);
        } else {
            console.log(`    → cutoff check passed (order after ${settings.cutoff_date})`);
        }
    } else {
        console.log('    → cutoff check SKIPPED (disabled or unset)');
    }

    const RETURN_WINDOW_DAYS = settings.return_window_days;
    const RETURN_WINDOW_MODE = settings.return_window_mode;
    let daysSinceReference = null, isWithinWindow = false, referenceDate = null;

    if (RETURN_WINDOW_MODE === 'order') {
        referenceDate = order.created_at;
        daysSinceReference = (Date.now() - new Date(referenceDate).getTime()) / 86400000;
        isWithinWindow = daysSinceReference <= RETURN_WINDOW_DAYS;
        console.log(`    mode=order: ${daysSinceReference.toFixed(1)} days since order vs window ${RETURN_WINDOW_DAYS} → within=${isWithinWindow}`);
    } else {
        if (deliveredDate) {
            referenceDate = deliveredDate;
            daysSinceReference = (Date.now() - new Date(deliveredDate).getTime()) / 86400000;
            isWithinWindow = daysSinceReference <= RETURN_WINDOW_DAYS;
            console.log(`    mode=delivery: ${daysSinceReference.toFixed(1)} days since delivered (${deliveredDate}) vs window ${RETURN_WINDOW_DAYS} → within=${isWithinWindow}`);
        } else if (isFulfilled) {
            isWithinWindow = true;
            console.log(`    ⚠️  mode=delivery but NO delivered_date and order is fulfilled → window check BYPASSED (isWithinWindow=true)`);
        } else {
            console.log('    mode=delivery: not fulfilled → would be blocked');
        }
    }

    const eligible = isFulfilled && isWithinWindow;
    console.log(`\n[RESULT] isFulfilled=${isFulfilled} | isWithinWindow=${isWithinWindow} | shopperHubOrder=${shopperHubOrder}`);
    console.log(`[RESULT] /api/lookup-order would return isEligible = ${eligible}`);
    console.log('\nNote: /api/submit-exchange performs NO eligibility re-check — it only blocks duplicates.');
    console.log('Admin endpoint /api/admin/create-request also bypasses all eligibility checks.');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
