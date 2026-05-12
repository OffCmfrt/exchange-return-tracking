/**
 * One-time backfill script: populates influencer_orders table with historical Shopify orders.
 *
 * Run AFTER executing supabase_migration_influencer_orders.sql.
 *
 * Usage:
 *   node backfill-influencer-orders.js          # default: last 180 days
 *   node backfill-influencer-orders.js 365      # last 365 days
 *
 * After this finishes, the background sync (4x daily) will keep things up to date incrementally.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const DAYS = parseInt(process.argv[2] || '180', 10);

async function main() {
    const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    console.log(`[Backfill] Starting historical backfill for last ${DAYS} days...`);

    // Load all active influencers -> map referral_code -> influencer
    const { data: influencers, error: infErr } = await supabase
        .from('influencers')
        .select('*')
        .eq('is_active', true);

    if (infErr) {
        console.error('[Backfill] Failed to load influencers:', infErr.message);
        process.exit(1);
    }

    const codeMap = new Map();
    for (const inf of influencers) {
        if (inf.referral_code) codeMap.set(inf.referral_code.toUpperCase(), inf);
    }
    console.log(`[Backfill] Loaded ${influencers.length} active influencers`);

    // Fetch orders from Shopify
    const since = new Date();
    since.setDate(since.getDate() - DAYS);

    let nextUrl = `orders.json?status=any&limit=250&fields=id,name,total_price,discount_codes,created_at,updated_at,currency,financial_status,fulfillment_status,cancelled_at,customer&created_at_min=${encodeURIComponent(since.toISOString())}`;
    let pageCount = 0;
    let totalFetched = 0;
    let upsertedCount = 0;
    const affectedInfluencerIds = new Set();

    while (nextUrl && pageCount < 200) {
        pageCount++;
        const fullUrl = nextUrl.startsWith('http')
            ? nextUrl
            : `https://${process.env.SHOPIFY_STORE}/admin/api/2024-01/${nextUrl}`;

        const response = await fetch(fullUrl, {
            headers: {
                'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            console.error(`[Backfill] Shopify API error ${response.status}`);
            break;
        }

        const data = await response.json();
        const batch = data.orders || [];
        totalFetched += batch.length;

        const rows = [];
        for (const order of batch) {
            if (!order.discount_codes || order.discount_codes.length === 0) continue;

            let matchedInf = null;
            let matchedCode = null;
            for (const dc of order.discount_codes) {
                const inf = codeMap.get((dc.code || '').toUpperCase());
                if (inf) {
                    matchedInf = inf;
                    matchedCode = dc.code;
                    break;
                }
            }
            if (!matchedInf) continue;

            const customerName = order.customer
                ? `${order.customer.first_name || ''} ${order.customer.last_name || ''}`.trim() || 'Guest'
                : 'Guest';

            rows.push({
                shopify_order_id: order.id,
                influencer_id: matchedInf.id,
                referral_code: matchedCode,
                order_name: order.name,
                total_price: parseFloat(order.total_price || 0),
                currency: order.currency || 'INR',
                financial_status: order.financial_status,
                fulfillment_status: order.fulfillment_status,
                customer_name: customerName,
                cancelled_at: order.cancelled_at,
                order_created_at: order.created_at,
                order_updated_at: order.updated_at,
                synced_at: new Date().toISOString()
            });
            affectedInfluencerIds.add(matchedInf.id);
        }

        if (rows.length > 0) {
            const { error: upErr } = await supabase
                .from('influencer_orders')
                .upsert(rows, { onConflict: 'shopify_order_id' });
            if (upErr) {
                console.error('[Backfill] Upsert error:', upErr.message);
            } else {
                upsertedCount += rows.length;
            }
        }

        console.log(`[Backfill] Page ${pageCount}: ${batch.length} orders (matched: ${rows.length}, total upserted: ${upsertedCount})`);

        const linkHeader = response.headers.get('link');
        nextUrl = null;
        if (linkHeader) {
            const m = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
            if (m) nextUrl = m[1];
        }
    }

    console.log(`\n[Backfill] Fetched ${totalFetched} orders, upserted ${upsertedCount} attributed rows`);
    console.log(`[Backfill] Recomputing aggregates for ${affectedInfluencerIds.size} influencers...`);

    // Recompute aggregates + recent cache for every affected influencer
    for (const infId of affectedInfluencerIds) {
        const inf = influencers.find(i => i.id === infId);
        if (!inf) continue;

        const { data: rows, error: aggErr } = await supabase
            .from('influencer_orders')
            .select('total_price, order_created_at, order_name, currency, customer_name, shopify_order_id')
            .eq('influencer_id', infId)
            .is('cancelled_at', null)
            .in('financial_status', ['paid', 'partially_paid', 'pending', 'authorized'])
            .order('order_created_at', { ascending: false });

        if (aggErr) {
            console.error(`[Backfill] Aggregate error for ${inf.name}:`, aggErr.message);
            continue;
        }

        const usageCount = (rows || []).length;
        const totalRevenue = (rows || []).reduce((s, r) => s + parseFloat(r.total_price || 0), 0);
        const commissionRate = parseFloat(inf.commission_rate || 10);
        const estimatedEarnings = totalRevenue * (commissionRate / 100);

        const recentCache = (rows || []).slice(0, 20).map(r => ({
            id: r.shopify_order_id,
            orderName: r.order_name,
            total: parseFloat(r.total_price).toFixed(2),
            currency: r.currency || 'INR',
            date: r.order_created_at,
            customerName: r.customer_name || 'Guest'
        }));

        await supabase
            .from('influencers')
            .update({
                usage_count: usageCount,
                total_revenue: totalRevenue,
                total_orders: usageCount,
                estimated_earnings: estimatedEarnings,
                stats_last_updated: new Date().toISOString(),
                stats_date_range: 'all_time',
                last_synced_at: new Date().toISOString(),
                recent_conversions_cache: recentCache,
                recent_conversions_updated_at: new Date().toISOString()
            })
            .eq('id', infId);

        console.log(`[Backfill] ✅ ${inf.name} (${inf.referral_code}): ${usageCount} orders, ₹${totalRevenue.toFixed(2)}`);
    }

    // Write watermark so next background sync picks up from here
    await supabase
        .from('sync_metadata')
        .upsert({
            key: 'last_shopify_order_sync',
            value: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }, { onConflict: 'key' });

    console.log('\n[Backfill] ✅ Done. Future syncs will be incremental.');
    process.exit(0);
}

main().catch(err => {
    console.error('[Backfill] Fatal error:', err);
    process.exit(1);
});
