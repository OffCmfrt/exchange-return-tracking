// ============================================================================
// Website Support & Tickets System — Order Cache Sync Service
// Syncs customer orders from Shopify to support_order_cache.
// ============================================================================

const cron = require('node-cron');
const { normalizePhone, last10Digits } = require('./SupportService');

function createSupportSync({ supabase, shopifyAPI }) {
  let isSyncing = false;

  /**
   * Determine the stage of an order
   */
  async function computeStage(order, existingRequests = []) {
    if (order.cancelled_at) {
      return 'cancelled';
    }

    // Check if an active return/exchange request exists
    const orderName = order.name || '';
    const activeReq = existingRequests.find(r => r.order_number === orderName && r.status !== 'rejected');
    if (activeReq) {
      return activeReq.type === 'exchange' ? 'exchange' : 'return';
    }

    const fulfillments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
    if (fulfillments.length === 0) {
      return 'unshipped';
    }

    // Check fulfillment statuses
    const anyDelivered = fulfillments.some(f => f.shipment_status === 'delivered');
    if (anyDelivered) {
      return 'delivered';
    }

    const anyRTO = fulfillments.some(f =>
      ['rto', 'return_to_origin', 'failure'].includes(String(f.shipment_status).toLowerCase())
    );
    if (anyRTO) {
      return 'rto';
    }

    const anyShipped = fulfillments.some(f => f.tracking_number || f.tracking_company);
    if (anyShipped) {
      return 'shipped';
    }

    return 'unshipped';
  }

  /**
   * Sync orders for a list of phones (or all whitelisted phones)
   */
  async function syncOrdersToCache({ phones = null } = {}) {
    if (isSyncing) {
      return { synced: 0, failed: 0, duration_ms: 0, message: 'Sync already in progress' };
    }

    isSyncing = true;
    const startTime = Date.now();
    let synced = 0;
    let failed = 0;

    try {
      let targetPhones = phones;
      if (!targetPhones || targetPhones.length === 0) {
        const { data: whitelistRows } = await supabase.from('support_whitelist').select('phone');
        targetPhones = (whitelistRows || []).map(r => r.phone);
      }

      if (!targetPhones || targetPhones.length === 0) {
        return { synced: 0, failed: 0, duration_ms: Date.now() - startTime };
      }

      // Pre-fetch active requests from return/exchange requests table to match stages
      let activeRequests = [];
      try {
        const { data: reqs } = await supabase.from('requests').select('order_number, type, status');
        if (reqs) activeRequests = reqs;
      } catch {}

      for (const rawPhone of targetPhones) {
        try {
          if (!shopifyAPI) {
            console.warn('[SupportSync] shopifyAPI helper is not available. Skipping sync.');
            break;
          }

          const l10 = last10Digits(rawPhone);
          const normalized = normalizePhone(rawPhone);

          // Find customer by phone in Shopify
          let shopifyCustomer = null;
          try {
            const searchRes = await shopifyAPI(`customers/search.json?query=phone:${encodeURIComponent(l10)}`);
            if (searchRes && searchRes.customers && searchRes.customers.length > 0) {
              shopifyCustomer = searchRes.customers[0];
            }
          } catch (e) {
            console.warn(`[SupportSync] Shopify customer search failed for ${l10}:`, e.message);
          }

          if (!shopifyCustomer) {
            continue;
          }

          // Fetch orders for this customer
          const ordersRes = await shopifyAPI(`orders.json?status=any&customer_id=${shopifyCustomer.id}&limit=50`);
          const orders = ordersRes?.orders || [];

          for (const order of orders) {
            try {
              const stage = await computeStage(order, activeRequests);

              // Detect payment method (COD vs Prepaid)
              const gateway = (order.gateway || '').toLowerCase();
              const paymentGateways = Array.isArray(order.payment_gateway_names)
                ? order.payment_gateway_names.map(g => String(g).toLowerCase())
                : [];
              const isCOD =
                gateway.includes('cod') ||
                gateway.includes('cash') ||
                gateway.includes('manual') ||
                paymentGateways.some(g => g.includes('cod') || g.includes('cash') || g.includes('manual'));
              const payment = isCOD ? 'COD' : 'Prepaid';

              // Extract courier & AWB
              let courier = null;
              let awb = null;
              let deliveredAt = null;

              if (order.fulfillments && order.fulfillments.length > 0) {
                const f = order.fulfillments[0];
                courier = f.tracking_company || null;
                awb = f.tracking_number || null;
                if (f.shipment_status === 'delivered') {
                  deliveredAt = f.updated_at || new Date().toISOString();
                }
              }

              // Address
              const shipAddr = order.shipping_address;
              const formattedAddress = shipAddr
                ? `${shipAddr.address1 || ''} ${shipAddr.address2 || ''}, ${shipAddr.city || ''}, ${shipAddr.province || ''} ${shipAddr.zip || ''}`.trim()
                : null;

              const cacheRow = {
                order_id: String(order.id),
                customer_phone: normalized,
                customer_name: `${shopifyCustomer.first_name || ''} ${shopifyCustomer.last_name || ''}`.trim() || 'Customer',
                customer_email: shopifyCustomer.email || order.email || null,
                order_json: order,
                stage,
                payment,
                courier,
                awb,
                address: formattedAddress,
                total: parseFloat(order.total_price || '0'),
                placed_at: order.created_at,
                delivered_at: deliveredAt,
                synced_at: new Date().toISOString()
              };

              const { error: upsertErr } = await supabase
                .from('support_order_cache')
                .upsert(cacheRow, { onConflict: 'order_id' });

              if (upsertErr) {
                failed++;
              } else {
                synced++;
              }
            } catch (singleErr) {
              failed++;
              console.warn(`[SupportSync] Error processing order ${order.id}:`, singleErr.message);
            }
          }
        } catch (phoneErr) {
          failed++;
          console.warn(`[SupportSync] Error syncing phone ${rawPhone}:`, phoneErr.message);
        }
      }
    } finally {
      isSyncing = false;
    }

    return {
      synced,
      failed,
      duration_ms: Date.now() - startTime
    };
  }

  /**
   * Start scheduled background synchronization if enabled via environment flag.
   * Default: disabled to prevent automated changes until explicitly activated.
   */
  function start() {
    if (process.env.SUPPORT_SYNC_ENABLED !== 'true') {
      console.log('ℹ️  SupportSync: Automated background sync is disabled (set SUPPORT_SYNC_ENABLED=true to enable)');
      return;
    }

    console.log('🔄 SupportSync: Scheduling background sync every 15 minutes');
    cron.schedule('*/15 * * * *', async () => {
      try {
        const res = await syncOrdersToCache();
        console.log(`[SupportSync] Scheduled sync completed: ${res.synced} synced, ${res.failed} failed (${res.duration_ms}ms)`);
      } catch (err) {
        console.error('[SupportSync] Scheduled sync failed:', err.message);
      }
    });

    // Initial sync on startup
    syncOrdersToCache()
      .then(res => console.log(`[SupportSync] Startup sync completed: ${res.synced} synced, ${res.failed} failed (${res.duration_ms}ms)`))
      .catch(err => console.error('[SupportSync] Startup sync error:', err.message));
  }

  return {
    computeStage,
    syncOrdersToCache,
    start
  };
}

module.exports = {
  createSupportSync
};
