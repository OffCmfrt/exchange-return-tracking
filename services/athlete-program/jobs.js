// ============================================================================
// Athlete Program — Scheduled Jobs
// ----------------------------------------------------------------------------
// Nightly standing recompute, level evaluation, inactivity checks,
// liveness verification, trial nudges, and trial expiry.
// ============================================================================

const { StandingService, LevelEngine, TransitionService } = require('./index');
const supabase = require('../../config/supabase');

const AthleteJobs = {

  /**
   * Run all nightly jobs in sequence.
   * Call this from a cron scheduler (e.g., node-cron) at midnight IST.
   */
  async runNightly() {
    console.log('[AthleteJobs] Starting nightly run...');
    const start = Date.now();

    try {
      // 1. Recompute standing for all active athletes
      const standingResult = await StandingService.recomputeAll();
      console.log(`[AthleteJobs] Standing recompute: ${standingResult.processed} processed, ${standingResult.errors} errors`);

      // 2. Evaluate levels for all active athletes
      const levelResult = await this.evaluateAllLevels();
      console.log(`[AthleteJobs] Level evaluation: ${levelResult.promoted} promoted, ${levelResult.errors} errors`);

      // 3. Check inactivity
      const inactivityResult = await this.checkInactivity();
      console.log(`[AthleteJobs] Inactivity check: ${inactivityResult.atRisk} at-risk, ${inactivityResult.toReserve} -> reserve, ${inactivityResult.toDischarge} -> discharged`);

      // 4. Check trial expiry
      const trialResult = await this.checkTrialExpiry();
      console.log(`[AthleteJobs] Trial check: ${trialResult.expired} expired, ${trialResult.nudged} nudged`);

    } catch (err) {
      console.error('[AthleteJobs] Nightly run failed:', err);
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[AthleteJobs] Nightly run complete in ${elapsed}s`);
  },

  /**
   * Evaluate levels for all ACTIVE and ON_TRIAL athletes.
   * Promotes one level at a time, re-enqueues after each promotion.
   */
  async evaluateAllLevels() {
    const { data: athletes, error } = await supabase
      .from('influencers')
      .select('id')
      .in('athlete_status', ['ACTIVE', 'ON_TRIAL']);

    if (error) throw error;

    let promoted = 0;
    let errors = 0;

    for (const athlete of (athletes || [])) {
      try {
        let reEnqueue = true;
        let maxIterations = 3; // Safety: max 3 promotions per nightly run

        while (reEnqueue && maxIterations > 0) {
          const result = await LevelEngine.evaluate(athlete.id);
          if (result.result === 'Promoted') promoted++;
          reEnqueue = result.reEnqueue;
          maxIterations--;
        }
      } catch (err) {
        console.error(`[AthleteJobs] Level eval failed for athlete ${athlete.id}:`, err);
        errors++;
      }
    }

    return { promoted, errors };
  },

  /**
   * Check inactivity and transition athletes through the lifecycle:
   * ACTIVE -> at_risk (flag only) -> RESERVE -> DISCHARGED
   */
  async checkInactivity() {
    // Read settings
    const atRiskDays = await this._getSetting('inactivity.at_risk_days', 45);
    const reserveDays = await this._getSetting('inactivity.reserve_days', 90);
    const dischargeDays = await this._getSetting('inactivity.discharge_days', 180);

    let atRisk = 0, toReserve = 0, toDischarge = 0;

    // Check ACTIVE athletes for inactivity
    const { data: activeAthletes } = await supabase
      .from('influencers')
      .select('id, athlete_status')
      .eq('athlete_status', 'ACTIVE');

    for (const athlete of (activeAthletes || [])) {
      const daysSince = await this._daysSinceLastActivity(athlete.id);

      if (daysSince >= reserveDays) {
        try {
          await TransitionService.move('influencer', athlete.id, 'RESERVE', 'system', 'INACTIVITY');
          toReserve++;
        } catch (err) {
          if (err.status !== 422) console.error(`[AthleteJobs] Failed to move ${athlete.id} to RESERVE:`, err);
        }
      } else if (daysSince >= atRiskDays) {
        atRisk++;
        // Future: send warning message
      }
    }

    // Check RESERVE athletes for discharge
    const { data: reserveAthletes } = await supabase
      .from('influencers')
      .select('id')
      .eq('athlete_status', 'RESERVE');

    for (const athlete of (reserveAthletes || [])) {
      const daysSince = await this._daysSinceLastActivity(athlete.id);

      if (daysSince >= dischargeDays) {
        try {
          await TransitionService.move('influencer', athlete.id, 'DISCHARGED', 'system', 'RESERVE_EXPIRED');
          toDischarge++;
        } catch (err) {
          if (err.status !== 422) console.error(`[AthleteJobs] Failed to discharge ${athlete.id}:`, err);
        }
      }
    }

    return { atRisk, toReserve, toDischarge };
  },

  /**
   * Check trial expiry and send nudges.
   */
  async checkTrialExpiry() {
    const windowDays = await this._getSetting('trial.window_days', 30);
    const nudgeDays = await this._getSetting('trial.nudge_days', [7, 14, 21, 27]);

    let expired = 0, nudged = 0;

    const { data: trialAthletes } = await supabase
      .from('influencers')
      .select('id, level_since')
      .eq('athlete_status', 'ON_TRIAL');

    for (const athlete of (trialAthletes || [])) {
      if (!athlete.level_since) continue;

      const daysInTrial = Math.floor(
        (Date.now() - new Date(athlete.level_since).getTime()) / (1000 * 60 * 60 * 24)
      );

      // Check if trial expired
      if (daysInTrial >= windowDays) {
        try {
          await TransitionService.move('influencer', athlete.id, 'TRIAL_LAPSED', 'system', 'TRIAL_EXPIRED');
          expired++;
        } catch (err) {
          if (err.status !== 422) console.error(`[AthleteJobs] Failed to expire trial for ${athlete.id}:`, err);
        }
      } else {
        // Check if today is a nudge day
        if (nudgeDays.includes(daysInTrial)) {
          nudged++;
          // Future: send WhatsApp nudge message
          console.log(`[AthleteJobs] Nudge day ${daysInTrial} for athlete ${athlete.id}`);
        }
      }
    }

    return { expired, nudged };
  },

  /**
   * Check liveness of APPROVED assignments past the horizon.
   * If post is removed -> CLAWED_BACK.
   * Call this hourly.
   */
  async checkLiveness() {
    const horizonDays = await this._getSetting('liveness.horizon_days', 30);
    const horizonAgo = new Date(Date.now() - horizonDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: assignments, error } = await supabase
      .from('assignments')
      .select('id, influencer_id, liveness_check_at')
      .eq('status', 'APPROVED')
      .lte('reviewed_at', horizonAgo);

    if (error) throw error;

    let verified = 0, clawed = 0;

    for (const assignment of (assignments || [])) {
      // Future: actually check if the post is still live via platform API
      // For now, mark as verified
      try {
        await supabase
          .from('assignments')
          .update({ status: 'VERIFIED_LIVE', liveness_check_at: new Date().toISOString() })
          .eq('id', assignment.id);

        verified++;
      } catch (err) {
        console.error(`[AthleteJobs] Liveness check failed for assignment ${assignment.id}:`, err);
      }
    }

    console.log(`[AthleteJobs] Liveness: ${verified} verified, ${clawed} clawed back`);
    return { verified, clawed };
  },

  /**
   * Get days since last approved submission or order.
   * @private
   */
  async _daysSinceLastActivity(influencerId) {
    // Check last approved assignment
    const { data: lastAssignment } = await supabase
      .from('assignments')
      .select('reviewed_at')
      .eq('influencer_id', influencerId)
      .in('status', ['APPROVED', 'VERIFIED_LIVE'])
      .order('reviewed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Check last attributed order
    const { data: lastOrder } = await supabase
      .from('attributed_orders')
      .select('placed_at')
      .eq('influencer_id', influencerId)
      .order('placed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let lastActivity = null;
    if (lastAssignment?.reviewed_at) lastActivity = new Date(lastAssignment.reviewed_at);
    if (lastOrder?.placed_at) {
      const orderDate = new Date(lastOrder.placed_at);
      if (!lastActivity || orderDate > lastActivity) lastActivity = orderDate;
    }

    if (!lastActivity) return 999; // No activity ever
    return Math.floor((Date.now() - lastActivity.getTime()) / (1000 * 60 * 60 * 24));
  },

  /**
   * Read a program setting value.
   * @private
   */
  async _getSetting(key, defaultValue) {
    const { data } = await supabase
      .from('program_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    return data?.value ?? defaultValue;
  }
};

module.exports = AthleteJobs;
