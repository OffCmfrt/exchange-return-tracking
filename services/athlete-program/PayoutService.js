// ============================================================================
// PayoutService — Batch payout generation + idempotent sending
// ----------------------------------------------------------------------------
// Builds batches for all verified athletes, calculates gross/TDS/net.
// Idempotent per (influencer, period) via idempotency_key.
// ============================================================================

const supabase = require('../../config/supabase');

const PayoutService = {

  /**
   * Build a payout batch for a given period.
   * Queries all attributed orders in the period with EARNED commission.
   * Only includes athletes with VERIFIED payout methods.
   *
   * @param {string} periodStart — ISO date (YYYY-MM-DD)
   * @param {string} periodEnd — ISO date (YYYY-MM-DD)
   * @returns {Promise<{batch: object[], totalGross: number, totalNet: number, athleteCount: number}>}
   */
  async buildBatch(periodStart, periodEnd) {
    if (!periodStart || !periodEnd) throw new Error('periodStart and periodEnd are required');

    // Get all orders with EARNED commission in the period
    const { data: orders, error: ordErr } = await supabase
      .from('attributed_orders')
      .select('influencer_id, commission_amount, net_value')
      .eq('commission_status', 'EARNED')
      .gte('placed_at', periodStart)
      .lte('placed_at', periodEnd);

    if (ordErr) throw ordErr;

    // Group by influencer
    const byInfluencer = {};
    for (const order of (orders || [])) {
      if (!byInfluencer[order.influencer_id]) {
        byInfluencer[order.influencer_id] = { gross: 0, orders: 0 };
      }
      byInfluencer[order.influencer_id].gross += parseFloat(order.commission_amount) || 0;
      byInfluencer[order.influencer_id].orders++;
    }

    // Get verified payout methods for these influencers
    const influencerIds = Object.keys(byInfluencer).map(Number);
    if (influencerIds.length === 0) {
      return { batch: [], totalGross: 0, totalNet: 0, athleteCount: 0 };
    }

    const { data: methods } = await supabase
      .from('payout_methods')
      .select('influencer_id, id')
      .in('influencer_id', influencerIds)
      .eq('status', 'VERIFIED')
      .eq('is_primary', true);

    const verifiedMap = {};
    for (const m of (methods || [])) {
      verifiedMap[m.influencer_id] = m.id;
    }

    // Build payout records
    const batch = [];
    let totalGross = 0;
    let totalNet = 0;

    for (const [infId, data] of Object.entries(byInfluencer)) {
      const influencerId = Number(infId);
      const payoutMethodId = verifiedMap[influencerId];

      if (!payoutMethodId) {
        console.log(`[Payout] Athlete ${influencerId} skipped — no verified payout method`);
        continue;
      }

      const gross = Math.round(data.gross * 100) / 100;
      const tdsRate = 0.05; // 5% TDS (configurable in future)
      const tdsAmount = Math.round(gross * tdsRate * 100) / 100;
      const net = Math.round((gross - tdsAmount) * 100) / 100;

      // Check minimum payout threshold
      // (Future: read from program_settings)
      const minimumAmount = 500;
      if (net < minimumAmount) {
        console.log(`[Payout] Athlete ${influencerId} skipped — net Rs${net} below minimum Rs${minimumAmount}`);
        continue;
      }

      const idempotencyKey = `payout:${influencerId}:${periodStart}:${periodEnd}`;

      batch.push({
        influencer_id: influencerId,
        payout_method_id: payoutMethodId,
        period_start: periodStart,
        period_end: periodEnd,
        gross,
        tds_amount: tdsAmount,
        net,
        status: 'DRAFT',
        idempotency_key: idempotencyKey,
        orders_count: data.orders
      });

      totalGross += gross;
      totalNet += net;
    }

    console.log(`[Payout] Built batch: ${batch.length} athletes, gross Rs${totalGross}, net Rs${totalNet}`);

    return { batch, totalGross: Math.round(totalGross * 100) / 100, totalNet: Math.round(totalNet * 100) / 100, athleteCount: batch.length };
  },

  /**
   * Save a batch of payouts to the database.
   * Idempotent — skips records with existing idempotency_key.
   *
   * @param {object[]} batch — array from buildBatch()
   * @returns {Promise<{created: number, skipped: number}>}
   */
  async saveBatch(batch) {
    let created = 0;
    let skipped = 0;

    for (const record of batch) {
      // Check idempotency
      const { data: existing } = await supabase
        .from('payouts')
        .select('id')
        .eq('idempotency_key', record.idempotency_key)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      const { error } = await supabase
        .from('payouts')
        .insert([record]);

      if (error) {
        if (error.code === '23505') {
          skipped++;
          continue;
        }
        throw error;
      }

      created++;
    }

    console.log(`[Payout] Saved batch: ${created} created, ${skipped} skipped`);
    return { created, skipped };
  },

  /**
   * Queue payouts for sending.
   *
   * @param {string} periodStart
   * @param {string} periodEnd
   * @returns {Promise<{queued: number}>}
   */
  async queueBatch(periodStart, periodEnd) {
    const { data, error } = await supabase
      .from('payouts')
      .update({
        status: 'QUEUED',
        queued_at: new Date().toISOString()
      })
      .eq('status', 'DRAFT')
      .gte('period_start', periodStart)
      .lte('period_end', periodEnd)
      .select('id');

    if (error) throw error;

    const queued = data?.length || 0;
    console.log(`[Payout] Queued ${queued} payouts for ${periodStart} to ${periodEnd}`);
    return { queued };
  },

  /**
   * Mark a payout as sent (after gateway transfer).
   *
   * @param {number} payoutId
   * @param {string} utrReference
   * @returns {Promise<void>}
   */
  async markSent(payoutId, utrReference) {
    const { error } = await supabase
      .from('payouts')
      .update({
        status: 'SENT',
        sent_at: new Date().toISOString(),
        utr_reference: utrReference
      })
      .eq('id', payoutId);

    if (error) throw error;

    // Update commission status on attributed orders
    const { data: payout } = await supabase
      .from('payouts')
      .select('influencer_id, period_start, period_end')
      .eq('id', payoutId)
      .single();

    if (payout) {
      await supabase
        .from('attributed_orders')
        .update({ commission_status: 'PAID' })
        .eq('influencer_id', payout.influencer_id)
        .eq('commission_status', 'EARNED')
        .gte('placed_at', payout.period_start)
        .lte('placed_at', payout.period_end);
    }
  },

  /**
   * Get payout history for an athlete.
   *
   * @param {number} influencerId
   * @returns {Promise<object[]>}
   */
  async getHistory(influencerId) {
    const { data, error } = await supabase
      .from('payouts')
      .select('*')
      .eq('influencer_id', influencerId)
      .order('period_end', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * Get all payouts with optional status filter.
   *
   * @param {object} opts — { status, periodStart, periodEnd }
   * @returns {Promise<object[]>}
   */
  async list({ status, periodStart, periodEnd } = {}) {
    let query = supabase
      .from('payouts')
      .select('*, influencer:influencers(id, name, athlete_no)')
      .order('period_end', { ascending: false });

    if (status) query = query.eq('status', status);
    if (periodStart) query = query.gte('period_start', periodStart);
    if (periodEnd) query = query.lte('period_end', periodEnd);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
};

module.exports = PayoutService;
