// ============================================================================
// StandingService — Derived 0-100 score, recomputed from rolling 90-day window
// ----------------------------------------------------------------------------
// Standing drives promotion eligibility, seeding priority, campaign selection.
// Never stored in the ledger. Never pushes a level down.
//
// Formula (spec §04):
//   standing = 100 * (0.40*on_time_rate + 0.30*completion_rate
//                   + 0.20*approval_rate + 0.10*response_rate)
//
//   no history      -> 70 (neutral)
//   <3 closed items  -> blend toward 70 to damp small-sample noise
//   zero activity    -> decay 5 per 30 days, floor 0
// ============================================================================

const supabase = require('../../config/supabase');

const StandingService = {

  /**
   * Recompute standing score for an athlete.
   * Uses rolling 90-day window of closed assignments.
   *
   * @param {number} influencerId
   * @returns {Promise<number>} new standing score (0-100)
   */
  async recompute(influencerId) {
    const windowStart = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch all assignments in the window
    const { data: assignments, error } = await supabase
      .from('assignments')
      .select('status, was_on_time, attempt_no, due_at, submitted_at, reviewed_at')
      .eq('influencer_id', influencerId)
      .gte('created_at', windowStart)
      .in('status', ['APPROVED', 'VERIFIED_LIVE', 'REJECTED', 'EXPIRED', 'CLAWED_BACK']);

    if (error) throw error;

    // No history -> neutral 70
    if (!assignments || assignments.length === 0) {
      // Check for decay: if standing was previously set, decay by 5 per 30 days of inactivity
      const { data: athlete } = await supabase
        .from('influencers')
        .select('standing_score, level_since')
        .eq('id', influencerId)
        .single();

      if (athlete && athlete.level_since) {
        const daysSinceActivity = Math.floor(
          (Date.now() - new Date(athlete.level_since).getTime()) / (1000 * 60 * 60 * 24)
        );
        const decayAmount = Math.floor(daysSinceActivity / 30) * 5;
        const decayed = Math.max(0, (athlete.standing_score || 70) - decayAmount);

        await this._update(influencerId, decayed);
        return decayed;
      }

      await this._update(influencerId, 70);
      return 70;
    }

    const total = assignments.length;

    // On-time rate: % of closed assignments that were on time
    const onTimeCount = assignments.filter(a => a.was_on_time === true).length;
    const onTimeRate = total > 0 ? onTimeCount / total : 0;

    // Completion rate: % of assigned tasks that reached a terminal state (not EXPIRED)
    const completedCount = assignments.filter(a => a.status !== 'EXPIRED').length;
    const completionRate = total > 0 ? completedCount / total : 0;

    // Approval rate: % of reviewed assignments that were approved
    const reviewedCount = assignments.filter(a =>
      ['APPROVED', 'VERIFIED_LIVE', 'REJECTED', 'CLAWED_BACK'].includes(a.status)
    ).length;
    const approvedCount = assignments.filter(a =>
      ['APPROVED', 'VERIFIED_LIVE'].includes(a.status)
    ).length;
    const approvalRate = reviewedCount > 0 ? approvedCount / reviewedCount : 0;

    // Response rate: % of assignments that had at least one submission (attempt_no > 0)
    const respondedCount = assignments.filter(a => a.attempt_no > 0 || a.submitted_at).length;
    const responseRate = total > 0 ? respondedCount / total : 0;

    // Calculate raw standing
    let standing = 100 * (
      0.40 * onTimeRate +
      0.30 * completionRate +
      0.20 * approvalRate +
      0.10 * responseRate
    );

    // Damp toward 70 for small sample sizes (<3 closed items)
    if (total < 3) {
      const blendFactor = total / 3;  // 0/3 = 0, 1/3 = 0.33, 2/3 = 0.67
      standing = standing * blendFactor + 70 * (1 - blendFactor);
    }

    // Round to 2 decimal places, clamp 0-100
    standing = Math.min(100, Math.max(0, Math.round(standing * 100) / 100));

    await this._update(influencerId, standing);
    return standing;
  },

  /**
   * Batch recompute for all active athletes.
   * Called nightly.
   *
   * @returns {Promise<{processed: number, errors: number}>}
   */
  async recomputeAll() {
    const { data: athletes, error } = await supabase
      .from('influencers')
      .select('id')
      .in('athlete_status', ['ACTIVE', 'ON_TRIAL']);

    if (error) throw error;

    let processed = 0;
    let errors = 0;

    for (const athlete of (athletes || [])) {
      try {
        await this.recompute(athlete.id);
        processed++;
      } catch (err) {
        console.error(`[StandingService] Failed to recompute for athlete ${athlete.id}:`, err);
        errors++;
      }
    }

    console.log(`[StandingService] Recomputed standing for ${processed} athletes (${errors} errors)`);
    return { processed, errors };
  },

  /**
   * Update the cached standing score on the influencer row.
   * @private
   */
  async _update(influencerId, score) {
    const { error } = await supabase
      .from('influencers')
      .update({ standing_score: score })
      .eq('id', influencerId);

    if (error) {
      console.error(`[StandingService] Failed to update standing for athlete ${influencerId}:`, error);
    }
  }
};

module.exports = StandingService;
