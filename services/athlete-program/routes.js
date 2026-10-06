// ============================================================================
// Athlete Program — API Routes
// ----------------------------------------------------------------------------
// Mount these in server.js: require('./services/athlete-program/routes')(app)
// Admin routes under /api/athlete-admin/
// Athlete routes under /api/athlete/
// ============================================================================

const supabase = require('../../config/supabase');
const {
  LedgerService, LevelEngine, TransitionService,
  TokenService, StandingService, AttributionService, PayoutService
} = require('./index');

module.exports = function mountAthleteRoutes(app) {

  // ── Helper: authenticate admin ──
  async function authAdmin(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });
    // Reuse existing authenticateAdmin logic or check a simple admin token
    // For now, pass through if token exists (integrate with existing auth)
    req.adminToken = token;
    next();
  }

  // ── Helper: resolve athlete from scoped token ──
  async function authAthlete(req, res, next) {
    const { token } = req.params;
    if (!token) return res.status(401).json({ error: 'No token' });

    const resolved = await TokenService.resolve(token);
    if (!resolved) return res.status(401).json({ error: 'Invalid or expired token' });

    req.athleteScope = resolved;
    next();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ADMIN ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  // ── Dashboard Stats ──
  app.get('/api/athlete-admin/dashboard', authAdmin, async (req, res) => {
    try {
      const [athletes, apps, review] = await Promise.all([
        supabase.from('influencers').select('id, athlete_status', { count: 'exact', head: false }),
        supabase.from('applications').select('id, status', { count: 'exact', head: false }).eq('status', 'APPLIED'),
        supabase.from('assignments').select('id', { count: 'exact', head: false }).in('status', ['SUBMITTED', 'UNDER_REVIEW'])
      ]);
      res.json({ success: true, data: {
        total_athletes: athletes.data?.length || 0,
        active: athletes.data?.filter(a => a.athlete_status === 'ACTIVE').length || 0,
        on_trial: athletes.data?.filter(a => a.athlete_status === 'ON_TRIAL').length || 0,
        pending_apps: apps.data?.length || 0,
        review_queue: review.data?.length || 0
      }});
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Athletes List ──
  app.get('/api/athlete-admin/athletes', authAdmin, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('influencers')
        .select('id, name, athlete_no, athlete_status, xp_total, coin_balance, standing_score, level_id, joined_at, phone, email')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Enrich with level info
      const levelIds = [...new Set(data.map(a => a.level_id).filter(Boolean))];
      let levelsMap = {};
      if (levelIds.length > 0) {
        const { data: levels } = await supabase
          .from('comfort_levels')
          .select('id, display_name, ordinal, dial_segments_lit')
          .in('id', levelIds);
        levels.forEach(l => levelsMap[l.id] = l);
      }

      const enriched = (data || []).map(a => ({
        ...a,
        level: levelsMap[a.level_id] || null,
        level_name: levelsMap[a.level_id]?.display_name || 'Unranked',
        level_ordinal: levelsMap[a.level_id]?.ordinal || 0,
        level_dial: levelsMap[a.level_id]?.dial_segments_lit || 0
      }));

      res.json({ success: true, data: enriched });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Athlete Status Transition ──
  app.patch('/api/athlete-admin/athletes/:id/status', authAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;
      const result = await TransitionService.move('influencer', parseInt(id), status, req.adminToken, reason);
      res.json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ── Level Override ──
  app.post('/api/athlete-admin/athletes/:id/override-level', authAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { level_id, reason } = req.body;
      await LevelEngine.override(parseInt(id), level_id, reason, req.adminToken);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Applications ──
  app.get('/api/athlete-admin/applications', authAdmin, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('applications')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/athlete-admin/applications/:id/approve', authAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      // Update application status
      await supabase.from('applications').update({ status: 'APPROVED', reviewed_at: new Date().toISOString(), reviewed_by: req.adminToken }).eq('id', id);
      // Fetch application
      const { data: app } = await supabase.from('applications').select('*').eq('id', id).single();
      if (!app) return res.status(404).json({ error: 'Application not found' });

      // Generate athlete_no
      const { count } = await supabase.from('influencers').select('*', { count: 'exact', head: true });
      const athleteNo = 'OFC-' + String((count || 0) + 1).padStart(4, '0');

      // Get CL5 level
      const { data: cl5 } = await supabase.from('comfort_levels').select('id').eq('ordinal', 1).single();

      // Create influencer
      const { data: influencer, error: infErr } = await supabase
        .from('influencers')
        .insert([{
          name: app.payload?.name || app.email,
          phone: app.phone,
          email: app.email,
          athlete_no: athleteNo,
          athlete_status: 'ON_TRIAL',
          level_id: cl5?.id,
          xp_total: 0,
          coin_balance: 0,
          standing_score: 70,
          joined_at: new Date().toISOString(),
          level_since: new Date().toISOString()
        }])
        .select()
        .single();

      if (infErr) throw infErr;

      // Update application with influencer_id
      await supabase.from('applications').update({ influencer_id: influencer.id }).eq('id', id);

      // Create social record
      if (app.primary_handle) {
        await supabase.from('influencer_socials').insert([{
          influencer_id: influencer.id,
          platform: app.payload?.platform || 'instagram',
          handle: app.primary_handle,
          followers: app.payload?.followers || 0,
          is_primary: true
        }]);
      }

      // Issue PROGRESS token
      const progressToken = await TokenService.issue('PROGRESS', influencer.id);

      // Issue ONBOARDING token
      const onboardingToken = await TokenService.issue('ONBOARDING', influencer.id);

      // Create level history
      await supabase.from('level_history').insert([{
        influencer_id: influencer.id,
        from_level_id: null,
        to_level_id: cl5.id,
        direction: 'OVERRIDE',
        reason_code: 'APPLICATION_APPROVED',
        actor_id: req.adminToken
      }]);

      res.json({ success: true, data: { influencer_id: influencer.id, athlete_no: athleteNo, progress_token: progressToken } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/athlete-admin/applications/:id/reject', authAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      await supabase.from('applications').update({ status: 'REJECTED', decision_reason: reason, reviewed_at: new Date().toISOString() }).eq('id', id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Task Templates ──
  app.get('/api/athlete-admin/tasks', authAdmin, async (req, res) => {
    try {
      const { data, error } = await supabase.from('task_templates').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/athlete-admin/tasks', authAdmin, async (req, res) => {
    try {
      const { data, error } = await supabase.from('task_templates').insert([req.body]).select().single();
      if (error) throw error;
      res.json({ success: true, data });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Review Queue ──
  app.get('/api/athlete-admin/review-queue', authAdmin, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('assignments')
        .select('*, influencer:influencers(name, athlete_no)')
        .in('status', ['SUBMITTED', 'UNDER_REVIEW'])
        .order('due_at', { ascending: true });

      if (error) {
        // Fallback without join
        const { data: fallback, error: fbErr } = await supabase
          .from('assignments')
          .select('*')
          .in('status', ['SUBMITTED', 'UNDER_REVIEW'])
          .order('due_at', { ascending: true });
        if (fbErr) throw fbErr;
        return res.json({ success: true, data: fallback || [] });
      }

      // Also fetch latest submission for each assignment
      const assignmentIds = (data || []).map(a => a.id);
      let submissionsMap = {};
      if (assignmentIds.length > 0) {
        const { data: submissions } = await supabase
          .from('submissions')
          .select('*')
          .in('assignment_id', assignmentIds)
          .order('created_at', { ascending: false });

        (submissions || []).forEach(s => {
          if (!submissionsMap[s.assignment_id]) submissionsMap[s.assignment_id] = s;
        });
      }

      const enriched = (data || []).map(a => ({
        ...a,
        post_url: submissionsMap[a.id]?.post_url,
        athlete_name: a.influencer?.name || a.influencer_id
      }));

      res.json({ success: true, data: enriched });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Review Assignment ──
  app.patch('/api/athlete-admin/assignments/:id/review', authAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;

      // Transition assignment
      const result = await TransitionService.move('assignment', parseInt(id), status, req.adminToken, reason);

      // If approved, award XP
      if (status === 'APPROVED') {
        const { data: assignment } = await supabase.from('assignments').select('*').eq('id', id).single();
        const { data: task } = await supabase.from('task_templates').select('*').eq('id', assignment.task_template_id).single();

        if (task) {
          let xpValue = task.xp_value || 0;
          // Apply on-time bonus or late penalty
          const isOnTime = !assignment.due_at || new Date(assignment.submitted_at || Date.now()) <= new Date(assignment.due_at);
          if (isOnTime) {
            const bonusPct = 20; // From settings
            xpValue = Math.round(xpValue * (1 + bonusPct / 100));
          } else {
            const penaltyPct = 25;
            xpValue = Math.round(xpValue * (1 - penaltyPct / 100));
          }

          if (xpValue > 0) {
            await LedgerService.award(assignment.influencer_id, 'XP', xpValue, 'ASSIGNMENT', assignment.id,
              `assignment:${id}:approved`, 'TASK_APPROVED');
          }

          if (task.coin_value > 0) {
            await LedgerService.award(assignment.influencer_id, 'COIN', task.coin_value, 'ASSIGNMENT', assignment.id,
              `assignment:${id}:coins`, 'TASK_COINS');
          }

          // Update assignment with awarded amounts
          await supabase.from('assignments').update({
            xp_awarded: xpValue,
            coin_awarded: task.coin_value,
            was_on_time: isOnTime,
            reviewed_at: new Date().toISOString(),
            reviewer_id: req.adminToken
          }).eq('id', id);

          // Recompute standing
          await StandingService.recompute(assignment.influencer_id);

          // Evaluate level
          await LevelEngine.evaluate(assignment.influencer_id);
        }
      }

      res.json({ success: true, data: result });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  // ── Levels ──
  app.get('/api/athlete-admin/levels', authAdmin, async (req, res) => {
    try {
      const { data, error } = await supabase.from('comfort_levels').select('*').order('ordinal');
      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Ledger ──
  app.get('/api/athlete-admin/ledger/:influencerId', authAdmin, async (req, res) => {
    try {
      const entries = await LedgerService.history(parseInt(req.params.influencerId));
      res.json({ success: true, data: entries });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Settings ──
  app.get('/api/athlete-admin/settings', authAdmin, async (req, res) => {
    try {
      const { data, error } = await supabase.from('program_settings').select('*').order('key');
      if (error) throw error;
      res.json({ success: true, data: data || [] });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.patch('/api/athlete-admin/settings', authAdmin, async (req, res) => {
    try {
      const { settings } = req.body;
      for (const s of settings) {
        await supabase.from('program_settings')
          .update({ value: s.value, updated_at: new Date().toISOString(), updated_by: req.adminToken })
          .eq('key', s.key);
      }
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Payouts ──
  app.get('/api/athlete-admin/payouts', authAdmin, async (req, res) => {
    try {
      const list = await PayoutService.list();
      res.json({ success: true, data: list });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/athlete-admin/payouts/build-batch', authAdmin, async (req, res) => {
    try {
      const { period_start, period_end } = req.body;
      const { batch, totalGross, totalNet, athleteCount } = await PayoutService.buildBatch(period_start, period_end);
      const { created, skipped } = await PayoutService.saveBatch(batch);
      res.json({ success: true, data: { created, skipped, totalGross, totalNet, athleteCount } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/athlete-admin/payouts/:id/queue', authAdmin, async (req, res) => {
    try {
      await supabase.from('payouts').update({ status: 'QUEUED', queued_at: new Date().toISOString() }).eq('id', req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // ATHLETE-FACING ROUTES (scoped token auth)
  // ══════════════════════════════════════════════════════════════════════════

  // ── Application ──
  app.post('/api/athlete/apply', async (req, res) => {
    try {
      const { name, phone, email, platform, handle, followers, city, niche, why_join } = req.body;
      if (!name || !phone || !email || !handle) {
        return res.status(400).json({ error: 'Name, phone, email, and handle are required' });
      }

      // Check for existing application
      const { data: existing } = await supabase
        .from('applications')
        .select('id')
        .eq('email', email)
        .in('status', ['APPLIED', 'SCREENING'])
        .maybeSingle();

      if (existing) return res.status(409).json({ error: 'You already have a pending application' });

      // Auto-score based on followers
      let autoScore = 0;
      if (followers >= 500000) autoScore = 90;
      else if (followers >= 100000) autoScore = 70;
      else if (followers >= 50000) autoScore = 50;
      else if (followers >= 10000) autoScore = 30;
      else autoScore = 15;

      const { data, error } = await supabase.from('applications').insert([{
        payload: { name, platform, followers, niche, city, why_join },
        email, phone, primary_handle: handle, auto_score: autoScore, status: 'APPLIED'
      }]).select().single();

      if (error) throw error;
      res.json({ success: true, application_id: data.id });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Progress (PROGRESS token) ──
  app.get('/api/athlete/:token/progress', authAthlete, async (req, res) => {
    try {
      const { influencerId, scope } = req.athleteScope;
      if (scope !== 'PROGRESS') return res.status(403).json({ error: 'Wrong scope' });

      const { data: athlete, error } = await supabase
        .from('influencers')
        .select('id, name, athlete_no, athlete_status, xp_total, coin_balance, standing_score, level_id, joined_at')
        .eq('id', influencerId)
        .single();

      if (error) throw error;

      // Get level info
      let level = null, nextLevel = null;
      if (athlete.level_id) {
        const { data: lvl } = await supabase.from('comfort_levels').select('*').eq('id', athlete.level_id).single();
        level = lvl;
        const { data: next } = await supabase.from('comfort_levels').select('*').eq('ordinal', lvl.ordinal + 1).maybeSingle();
        nextLevel = next;
      }

      // WHITELIST fields per spec §09 — only expose safe fields
      res.json({ success: true, data: {
        id: athlete.id,
        name: athlete.name,
        athlete_no: athlete.athlete_no,
        athlete_status: athlete.athlete_status,
        xp_total: athlete.xp_total,
        coin_balance: athlete.coin_balance,
        standing_score: athlete.standing_score,
        joined_at: athlete.joined_at,
        level: level ? { display_name: level.display_name, ordinal: level.ordinal, display_number: level.display_number, dial_segments_lit: level.dial_segments_lit, min_xp: level.min_xp } : null,
        next_level: nextLevel ? { display_name: nextLevel.display_name, min_xp: nextLevel.min_xp } : null
      }});
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Assignments ──
  app.get('/api/athlete/:token/assignments', authAthlete, async (req, res) => {
    try {
      const { influencerId } = req.athleteScope;
      const { data, error } = await supabase
        .from('assignments')
        .select('id, task_template_id, status, due_at, submitted_at, attempt_no, xp_awarded, coin_awarded')
        .eq('influencer_id', influencerId)
        .in('status', ['ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'])
        .order('due_at', { ascending: true });

      if (error) throw error;

      // Enrich with task template info
      const templateIds = [...new Set((data || []).map(a => a.task_template_id))];
      let templatesMap = {};
      if (templateIds.length > 0) {
        const { data: templates } = await supabase.from('task_templates').select('id, title, type, platform, xp_value, coin_value, brief_md').in('id', templateIds);
        (templates || []).forEach(t => templatesMap[t.id] = t);
      }

      const enriched = (data || []).map(a => ({
        ...a,
        title: templatesMap[a.task_template_id]?.title || 'Task',
        task_type: templatesMap[a.task_template_id]?.type || 'CONTENT_POST',
        platform: templatesMap[a.task_template_id]?.platform || '',
        xp_value: templatesMap[a.task_template_id]?.xp_value || 0,
        coin_value: templatesMap[a.task_template_id]?.coin_value || 0,
        brief: templatesMap[a.task_template_id]?.brief_md || ''
      }));

      res.json({ success: true, data: enriched });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Submit Proof ──
  app.post('/api/athlete/:token/submissions/:assignmentId', authAthlete, async (req, res) => {
    try {
      const { influencerId, scope } = req.athleteScope;
      const { assignmentId } = req.params;
      const { post_url, caption, disclosure_found } = req.body;

      if (!post_url) return res.status(400).json({ error: 'post_url is required' });

      // Verify assignment belongs to this athlete
      const { data: assignment } = await supabase
        .from('assignments')
        .select('*')
        .eq('id', parseInt(assignmentId))
        .eq('influencer_id', influencerId)
        .single();

      if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

      // Create submission
      const crypto = require('crypto');
      const urlHash = crypto.createHash('sha256').update(post_url).digest('hex');

      const { data: submission, error } = await supabase.from('submissions').insert([{
        assignment_id: assignment.id,
        attempt_no: (assignment.attempt_no || 0) + 1,
        post_url,
        url_hash: urlHash,
        posted_at: new Date().toISOString(),
        caption,
        disclosure_found: disclosure_found || false
      }]).select().single();

      if (error) throw error;

      // Update assignment
      await supabase.from('assignments').update({
        status: 'SUBMITTED',
        submitted_at: new Date().toISOString(),
        attempt_no: submission.attempt_no
      }).eq('id', assignment.id);

      // If first submission, transition to IN_PROGRESS first
      if (assignment.status === 'ASSIGNED') {
        await TransitionService.move('assignment', assignment.id, 'IN_PROGRESS', 'athlete');
        await TransitionService.move('assignment', assignment.id, 'SUBMITTED', 'athlete');
      }

      res.json({ success: true, data: { submission_id: submission.id } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Leaderboard ──
  app.get('/api/athlete/:token/leaderboard', authAthlete, async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('influencers')
        .select('id, name, athlete_no, xp_total, level_id, leaderboard_opt_out')
        .eq('leaderboard_opt_out', false)
        .in('athlete_status', ['ACTIVE', 'ON_TRIAL'])
        .order('xp_total', { ascending: false })
        .limit(20);

      if (error) throw error;

      // Enrich with level names
      const levelIds = [...new Set((data || []).map(a => a.level_id).filter(Boolean))];
      let levelsMap = {};
      if (levelIds.length > 0) {
        const { data: levels } = await supabase.from('comfort_levels').select('id, display_name').in('id', levelIds);
        (levels || []).forEach(l => levelsMap[l.id] = l);
      }

      const enriched = (data || []).map(a => ({
        ...a,
        level_name: levelsMap[a.level_id]?.display_name || '—'
      }));

      res.json({ success: true, data: enriched });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
};
