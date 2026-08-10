/**
 * Shopper Hub (WhatsApp bot) database access.
 *
 * Some orders placed through the WhatsApp Shoppers Hub were shipped under
 * Shiprocket's "Custom" channel instead of the Shopify channel, so Shopify
 * never received a fulfillment for them. The returns portal would then treat
 * those orders as "not delivered" and block return/exchange requests.
 *
 * The WhatsApp bot's Supabase (store_shoppers + orders tables) is the source
 * of truth for how those orders actually shipped, so we read it here as a
 * fallback when a Shopify order looks unfulfilled.
 *
 * Env: SHOPPERHUB_DB_URL — the whatsappbot project's Supabase Postgres
 * connection string (its SUPABASE_DB_URL).
 */

let pool = null;
let poolFailed = false;

function getPool() {
    if (pool || poolFailed) return pool;

    const connectionString = process.env.SHOPPERHUB_DB_URL;
    if (!connectionString) {
        poolFailed = true;
        console.warn('⚠️  SHOPPERHUB_DB_URL not set — Shopper Hub order fallback disabled.');
        return null;
    }

    try {
        const { Pool } = require('pg');
        pool = new Pool({
            connectionString,
            max: 2,
            idleTimeoutMillis: 30 * 1000,
            connectionTimeoutMillis: 10 * 1000,
            ssl: { rejectUnauthorized: false }
        });
        // Don't crash the server if the pool hits a transient error
        pool.on('error', (err) => {
            console.warn('Shopper Hub DB pool error (non-fatal):', err.message);
        });
        return pool;
    } catch (err) {
        poolFailed = true;
        console.warn('⚠️  Shopper Hub DB unavailable (pg missing?):', err.message);
        return null;
    }
}

const BLOCKED_SHOPPER_STATUSES = ['cancelled', 'canceled', 'rejected'];
const BLOCKED_ORDER_STATUSES = ['rto', 'cancelled', 'canceled', 'returned'];

/**
 * Look up a Shoppers Hub order by its order number (with or without '#').
 * Returns shipping proof (AWB, carrier, delivery date) or null when the
 * order isn't a valid shipped shopper order.
 */
async function findShopperOrder(orderNumber) {
    const activePool = getPool();
    if (!activePool) return null;

    const bare = String(orderNumber || '').trim().replace(/^#/, '');
    if (!bare) return null;

    // store_shoppers.order_id may be stored with or without the '#' prefix
    const variants = [...new Set([`#${bare}`, bare])];

    try {
        const { rows } = await activePool.query(`
            SELECT s.order_id,
                   s.name        AS shopper_name,
                   s.phone,
                   s.email,
                   s.status      AS shopper_status,
                   s.order_total,
                   o.awb,
                   o.status      AS order_status,
                   o.courier_name,
                   o.delivered_at
            FROM store_shoppers s
            LEFT JOIN orders o ON o.order_id = s.order_id
            WHERE s.order_id = ANY($1::text[])
            ORDER BY s.updated_at DESC NULLS LAST
            LIMIT 1
        `, [variants]);

        const row = rows[0];
        if (!row) return null;

        const shopperStatus = String(row.shopper_status || '').toLowerCase();
        if (BLOCKED_SHOPPER_STATUSES.includes(shopperStatus)) return null;

        const orderStatus = String(row.order_status || '').toLowerCase();
        if (BLOCKED_ORDER_STATUSES.includes(orderStatus)) return null;

        // Without an AWB there's no proof the order shipped
        if (!row.awb) return null;

        return {
            orderId: row.order_id,
            awb: row.awb,
            courier: row.courier_name || null,
            orderStatus: row.order_status || null,
            deliveredAt: row.delivered_at || null,
            shopperName: row.shopper_name || null,
            phone: row.phone || null,
            email: row.email || null,
            orderTotal: row.order_total || null
        };
    } catch (err) {
        console.warn('Shopper Hub order lookup failed (non-fatal):', err.message);
        return null;
    }
}

module.exports = { findShopperOrder };
