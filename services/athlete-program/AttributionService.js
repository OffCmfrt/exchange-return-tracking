// ============================================================================
// AttributionService — Order-to-athlete matching + commission freezing
// ----------------------------------------------------------------------------
// Rule (spec §06): Commission is frozen at order time.
// attributed_order.commission_rate is stored on the row.
// Recalculating historical commission after promotion is forbidden.
// ============================================================================

const supabase = require('../../config/supabase');
const LedgerService = require('./LedgerService');

const AttributionService = {

  /**
   * Ingest a Shopify order and attribute it to an athlete.
   * Idempotent on shopify_order_id (unique constraint).
   *
   * @param {object} payload — { shopify_order_id, code_used, attribution_method, net_value,
   *   placed_at, customer_name, financial_status, fulfillment_status, currency }
   * @returns {Promise<{order: object|null, attributed: boolean, xpAwarded: boolean}>}
   */
  async ingestOrder(payload) {
    const {
      shopify_order_id, code_used, attribution_method = 'CODE',
      net_value, placed_at, customer_name, financial_status,
      fulfillment_status, currency = 'INR', is_self_purchase = false
    } = payload;

    if (!shopify_order_id) throw new Error('shopify_order_id is required');

    // Check idempotency — if order already exists, return it
    const { data: existing } = await supabase
      .from('attributed_orders')
      .select('*')
      .eq('shopify_order_id', shopify_order_id)
      .maybeSingle();

    if (existing) return { order: existing, attributed: false, xpAwarded: false };

    // Find the athlete by discount code
    let influencerId = null;
    let commissionRate = 0;

    if (code_used) {
      const { data: discount } = await supabase
        .from('discount_codes')
        .select('influencer_id, percent')
        .ilike('code', code_used)
        .eq('is_active', true)
        .maybeSingle();

      if (discount) {
        influencerId = discount.influencer_id;
        commissionRate = parseFloat(discount.percent) || 0;
      }
    }

    // If no athlete found by code, try UTM or link attribution
    // (Future: implement UTM/link attribution lookup)

    if (!influencerId) {
      // Order not attributable — store without influencer for analytics
      console.log(`[Attribution] Order ${shopify_order_id} not attributable to any athlete`);
      return { order: null, attributed: false, xpAwarded: false };
    }

    // Fetch athlete's current level commission rate
    // We use the level's commission_pct from perks, or the discount rate as fallback
    const { data: athlete } = await supabase
      .from('influencers')
      .select('level_id')
      .eq('id', influencerId)
      .single();

    if (athlete?.level_id) {
      const { data: level } = await supabase
        .from('comfort_levels')
        .select('perks')
        .eq('id', athlete.level_id)
        .single();

      if (level?.perks?.commission_pct) {
        commissionRate = level.perks.commission_pct;
      }
    }

    const netValue = parseFloat(net_value) || 0;
    const commissionAmount = Math.round(netValue * commissionRate / 100 * 100) / 100;

    // Insert attributed order with FROZEN commission rate
    const { data: order, error } = await supabase
      .from('attributed_orders')
      .insert([{
        influencer_id: influencerId,
        shopify_order_id,
        code_used,
        attribution_method,
        net_value: netValue,
        placed_at,
        customer_name,
        financial_status,
        fulfillment_status,
        currency,
        is_self_purchase,
        commission_rate: commissionRate,  // FROZEN — never recalculate
        commission_amount: commissionAmount,
        commission_status: is_self_purchase ? 'PENDING' : 'EARNED'
      }])
      .select()
      .single();

    if (error) {
      // Handle unique constraint race
      if (error.code === '23505') {
        const { data: race } = await supabase
          .from('attributed_orders')
          .select('*')
          .eq('shopify_order_id', shopify_order_id)
          .single();
        return { order: race, attributed: false, xpAwarded: false };
      }
      throw error;
    }

    // Award XP for the order (idempotent)
    let xpAwarded = false;
    if (!is_self_purchase) {
      try {
        const xpPerOrder = 10; // Default, should read from program_settings
        const { isNew } = await LedgerService.award(
          influencerId, 'XP', xpPerOrder, 'ORDER', order.id,
          `order:${shopify_order_id}:xp`, 'ORDER_XP'
        );
        xpAwarded = isNew;

        // Also award XP based on revenue (per Rs1000)
        const xpPer1000 = 20; // Default from settings
        const revenueXp = Math.floor(netValue / 1000 * xpPer1000);
        if (revenueXp > 0) {
          await LedgerService.award(
            influencerId, 'XP', revenueXp, 'ORDER', order.id,
            `order:${shopify_order_id}:revenue_xp`, 'ORDER_REVENUE_XP'
          );
        }
      } catch (err) {
        console.error(`[Attribution] Failed to award XP for order ${shopify_order_id}:`, err);
      }
    }

    console.log(`[Attribution] Order ${shopify_order_id} -> Athlete ${influencerId} | Rs${netValue} | ${commissionRate}% = Rs${commissionAmount}`);

    return { order, attributed: true, xpAwarded };
  },

  /**
   * Reverse an order's commission (refund or cancellation).
   *
   * @param {number} shopifyOrderId
   * @param {number} refundedAmount
   * @returns {Promise<void>}
   */
  async reverseOrder(shopifyOrderId, refundedAmount = 0) {
    const { data: order, error } = await supabase
      .from('attributed_orders')
      .select('*')
      .eq('shopify_order_id', shopifyOrderId)
      .maybeSingle();

    if (error) throw error;
    if (!order) return;

    // Update order record
    const updateData = { is_cancelled: true };
    if (refundedAmount > 0) {
      updateData.refunded_amount = parseFloat(order.refunded_amount || 0) + refundedAmount;
    }

    await supabase
      .from('attributed_orders')
      .update(updateData)
      .eq('shopify_order_id', shopifyOrderId);

    // Reverse commission if it was earned
    if (order.commission_status === 'EARNED') {
      await supabase
        .from('attributed_orders')
        .update({ commission_status: 'REVERSED' })
        .eq('shopify_order_id', shopifyOrderId);

      // Reverse XP via ledger
      try {
        await LedgerService.reverse(
          // Find the original XP entry
          order.id,
          'ORDER_REFUND'
        );
      } catch (err) {
        console.error(`[Attribution] Failed to reverse XP for order ${shopifyOrderId}:`, err);
      }
    }

    console.log(`[Attribution] Reversed order ${shopifyOrderId} — refunded Rs${refundedAmount}`);
  },

  /**
   * Get attributed orders for an athlete.
   *
   * @param {number} influencerId
   * @param {object} opts — { limit, offset, status }
   * @returns {Promise<object[]>}
   */
  async getOrders(influencerId, { limit = 50, offset = 0, status } = {}) {
    let query = supabase
      .from('attributed_orders')
      .select('*')
      .eq('influencer_id', influencerId)
      .order('placed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq('commission_status', status);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  },

  /**
   * Get commission summary for an athlete.
   *
   * @param {number} influencerId
   * @returns {Promise<object>}
   */
  async getCommissionSummary(influencerId) {
    const { data: orders, error } = await supabase
      .from('attributed_orders')
      .select('commission_status, commission_amount, net_value')
      .eq('influencer_id', influencerId);

    if (error) throw error;

    const summary = {
      total_orders: orders?.length || 0,
      total_revenue: 0,
      total_commission: 0,
      earned: 0,
      pending: 0,
      reversed: 0,
      paid: 0
    };

    for (const o of (orders || [])) {
      summary.total_revenue += parseFloat(o.net_value) || 0;
      summary.total_commission += parseFloat(o.commission_amount) || 0;

      if (o.commission_status === 'EARNED') summary.earned += parseFloat(o.commission_amount) || 0;
      else if (o.commission_status === 'PENDING') summary.pending += parseFloat(o.commission_amount) || 0;
      else if (o.commission_status === 'REVERSED') summary.reversed += parseFloat(o.commission_amount) || 0;
      else if (o.commission_status === 'PAID') summary.paid += parseFloat(o.commission_amount) || 0;
    }

    return summary;
  }
};

module.exports = AttributionService;
