-- ============================================================================
-- ATHLETE PORTAL — 50 rotating gym and community missions
-- ----------------------------------------------------------------------------
-- Prerequisites: supabase_migration_athlete_program.sql and
-- supabase_migration_gamification.sql.
-- The athlete-only flag prevents these missions from appearing in legacy or
-- generic task workflows. Every proof is a shareable URL because the current
-- athlete submission endpoint accepts a URL and caption.
-- ============================================================================

ALTER TABLE task_templates
  ADD COLUMN IF NOT EXISTS is_athlete_portal_task BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_task_templates_athlete_portal_active
  ON task_templates (is_athlete_portal_task, is_active)
  WHERE is_athlete_portal_task = true AND is_active = true;

WITH missions (
  code, title, brief_md, type, platform, xp_value, coin_value,
  due_days, requires_disclosure, cooldown_days, monthly_cap
) AS (
  VALUES
    ('gym_train_together', 'Train Together', 'Train with another OFFCOMFRT athlete. Capture both sides of the session. If a post is requested, publish the reel; otherwise share a viewable video link and a short session note.', 'UGC_RAW', 'instagram', 180, 70, 14, true, 14, 2),
    ('gym_pass_it_on', 'Pass It On', 'Take a friend who does not train to their first session. If you give them a piece of kit, document their first session in it. Share a viewable photo or video link with a short note.', 'EVENT', NULL, 220, 90, 21, false, 28, 1),
    ('gym_training_log', 'The Training Log', 'Create one handwritten page: date, what you did, who you met, and one or two lines about the session. Share a clear link to the completed page.', 'SURVEY', NULL, 100, 40, 7, false, 7, 4),
    ('gym_unasked_questions', 'The Questions You Kept', 'For one week, note every question you wanted to ask at the gym but did not. Share a link to the list at the end of the week.', 'SURVEY', NULL, 160, 60, 10, false, 21, 2),
    ('gym_training_letter', 'Write It Forward', 'Write and send a letter to someone who helped you train: a coach, former partner, or the owner of your first gym. Share a photograph link before sending it.', 'EVENT', NULL, 240, 100, 21, false, 28, 1),
    ('gym_month_end_scorecard', 'Month-End Scorecard', 'At month end, submit numbers only: strangers spoken to, times you went first, and classes joined. Keep a tally and share the completed scorecard link.', 'CHALLENGE', NULL, 300, 130, 31, false, 28, 1),
    ('gym_ask_for_advice', 'Ask for Advice', 'Ask someone at the gym for one piece of advice. Write it down in their own words, using their first name only, then share a link to the note.', 'EVENT', NULL, 120, 45, 7, false, 7, 4),
    ('gym_start_a_conversation', 'Start the Conversation', 'Start a respectful public conversation with someone new. Record or post only with their clear consent. Share the reel or a viewable proof link.', 'CONTENT_POST', 'instagram', 260, 110, 14, true, 21, 2),
    ('gym_first_rep', 'First Rep', 'Arrive early and take the first working set before anyone else in your group. Share a short training clip or a photo of the session setup.', 'UGC_RAW', 'instagram', 90, 35, 3, false, 3, 6),
    ('gym_form_focus', 'Form Focus', 'Choose one movement and film a clean technical set from a useful angle. Add one sentence about the cue you focused on.', 'UGC_RAW', 'instagram', 110, 45, 5, false, 5, 4),
    ('gym_zone_two_walk', 'Zone Two Outside', 'Complete a steady outdoor walk, run, cycle, or row at conversational pace. Share a route, tracker, or post-session reflection link.', 'STREAK', NULL, 80, 30, 3, false, 3, 8),
    ('gym_finish_strong', 'Finish Strong', 'Do the final set you planned to skip. Share a short note explaining what made you stay for it and a proof link from the session.', 'CHALLENGE', NULL, 100, 40, 3, false, 4, 6),
    ('gym_warmup_ritual', 'Warm-Up Ritual', 'Build and complete a five-minute warm-up before training. Share the sequence as a clip, photo carousel, or written routine link.', 'CONTENT_POST', 'instagram', 100, 40, 5, true, 5, 4),
    ('gym_recovery_walk', 'Recovery Walk', 'Take a deliberate recovery walk after a hard session. Share a photo or short reflection about how you recovered rather than how far you went.', 'STREAK', NULL, 70, 25, 3, false, 3, 8),
    ('gym_mobility_reset', 'Mobility Reset', 'Spend ten focused minutes on mobility for the area that limits your training most. Share your sequence and one observation afterward.', 'UGC_RAW', 'instagram', 90, 35, 5, false, 5, 5),
    ('gym_new_movement', 'New Movement', 'Try a movement you have avoided or never learned. Keep the load appropriate, ask for support if needed, and share a short proof or reflection link.', 'CHALLENGE', NULL, 140, 55, 10, false, 14, 2),
    ('gym_rest_day_honesty', 'Rest Day, Honestly', 'Take a real recovery day when your body needs it. Share a short note on what you noticed instead of forcing a session.', 'SURVEY', NULL, 70, 25, 3, false, 3, 8),
    ('gym_pre_session_plan', 'Plan the Session', 'Write a session plan before entering the gym: goal, three movements, and one non-negotiable. Share a link to the completed plan after training.', 'SURVEY', NULL, 80, 30, 3, false, 3, 8),
    ('gym_post_session_review', 'Post-Session Review', 'Within ten minutes of finishing, write what worked, what did not, and what changes next time. Share the review link.', 'SURVEY', NULL, 80, 30, 3, false, 3, 8),
    ('gym_early_session', 'Before the Noise', 'Train at a time you would normally avoid: early morning, late evening, or a quieter window. Share proof of the session and a one-line reflection.', 'CHALLENGE', NULL, 130, 50, 7, false, 7, 3),
    ('gym_partner_set', 'Partner Set', 'Invite someone to complete one working set alongside you. Keep it supportive, not competitive. Share a consented clip or a written session note.', 'EVENT', NULL, 120, 45, 7, false, 7, 4),
    ('gym_spot_someone', 'Offer a Spot', 'Offer a safe, respectful spot or setup assist to someone who needs one. Share a short reflection about the interaction; do not film anyone without consent.', 'EVENT', NULL, 100, 40, 7, false, 7, 4),
    ('gym_welcome_newcomer', 'Welcome the Newcomer', 'Notice someone new to the gym and make their first session easier: explain one piece of equipment, offer a cue, or simply introduce yourself. Share a reflection link.', 'EVENT', NULL, 150, 60, 10, false, 14, 2),
    ('gym_gym_map', 'The Gym Map', 'Document the three places in your gym that help you train best: a machine, a quiet corner, and a recovery spot. Share a simple photo set or notes link.', 'CONTENT_POST', 'instagram', 110, 45, 7, true, 7, 4),
    ('gym_coach_cue', 'Coach Cue', 'Ask a coach or experienced lifter for one technical cue, apply it in the same session, and share what changed.', 'EVENT', NULL, 130, 50, 7, false, 7, 3),
    ('gym_training_partner_thank_you', 'Credit Your Partner', 'Give a genuine thank-you to someone who has made training easier. Share a note, card, or consented post link.', 'EVENT', NULL, 110, 45, 10, false, 14, 2),
    ('gym_class_drop_in', 'Join the Class', 'Join a class, group run, or training format you have never tried. Share proof of attendance and one sentence about what surprised you.', 'CHALLENGE', NULL, 160, 65, 14, false, 14, 2),
    ('gym_share_a_cue', 'Share a Cue', 'Teach one simple training cue that has genuinely helped you. Publish a concise reel or share a viewable explanation link.', 'CONTENT_POST', 'instagram', 140, 55, 7, true, 7, 3),
    ('gym_training_playlist', 'Set the Tone', 'Create a short training playlist or sound ritual that changes how you arrive. Share it with a note on when you use it.', 'CONTENT_POST', 'instagram', 90, 35, 7, true, 7, 4),
    ('gym_gym_portrait', 'Portrait of the Work', 'Make one restrained black-and-white image from your training environment: hands, chalk, equipment, or recovery. Share the image link and a caption.', 'CONTENT_POST', 'instagram', 130, 50, 7, true, 7, 3),
    ('gym_sweat_equity', 'Sweat Equity', 'Document the unglamorous part of training: setup, cleanup, carrying plates, or recovery work. Share a raw clip or photo link.', 'UGC_RAW', 'instagram', 100, 40, 5, false, 5, 5),
    ('gym_three_sets_story', 'Three Sets, One Story', 'Capture three moments from one session: arrival, hard work, and finish. Turn them into a short reel or a three-image story.', 'CONTENT_POST', 'instagram', 170, 70, 10, true, 10, 2),
    ('gym_no_filter_checkin', 'No-Filter Check-In', 'Record a short honest check-in before or after training about how you actually feel. Share it privately through a viewable link if you do not want to post.', 'UGC_RAW', NULL, 100, 40, 5, false, 5, 4),
    ('gym_progress_not_perfection', 'Progress, Not Perfection', 'Compare one current training note, movement, or habit with an earlier version. Share a concise before-and-now reflection.', 'SURVEY', NULL, 130, 50, 10, false, 14, 2),
    ('gym_one_minute_motivation', 'One Minute of Momentum', 'Create a one-minute message for someone who is nervous to start training. Keep it practical and honest. Share the posted reel or a viewable video link.', 'CONTENT_POST', 'instagram', 160, 65, 10, true, 10, 2),
    ('gym_training_kit', 'What Is in Your Bag', 'Document the few items you actually bring to train and why each earns its place. Share a photo set or concise video link.', 'CONTENT_POST', 'instagram', 110, 45, 7, true, 7, 3),
    ('gym_water_check', 'Hydration Check', 'Track your hydration around one training day. Share a simple note on what helped you stay consistent without overstating results.', 'STREAK', NULL, 60, 20, 2, false, 2, 10),
    ('gym_sleep_note', 'Sleep Before Strength', 'Log the previous night’s sleep and how it affected one session. Share the observation, not medical advice.', 'SURVEY', NULL, 60, 20, 3, false, 3, 8),
    ('gym_meal_prep', 'Fuel the Work', 'Prepare one practical meal or snack that supports your training day. Share the result and why it is realistic for your routine.', 'CONTENT_POST', 'instagram', 100, 40, 5, true, 5, 4),
    ('gym_recovery_protocol', 'Recovery Protocol', 'Choose one recovery practice you will actually repeat this week: stretching, mobility, a walk, sleep routine, or meal prep. Share the plan and a follow-up note.', 'STREAK', NULL, 100, 40, 7, false, 7, 4),
    ('gym_breathe_between_sets', 'Breathe Between Sets', 'Use a deliberate breathing reset between every working set in one session. Share a short note on whether it changed your pace or focus.', 'SURVEY', NULL, 70, 25, 3, false, 3, 8),
    ('gym_screen_free_session', 'Screen-Free Session', 'Train one full session without scrolling between sets. Share a reflection about attention, pace, or conversation afterward.', 'CHALLENGE', NULL, 100, 40, 5, false, 5, 5),
    ('gym_consistency_chain', 'Consistency Chain', 'Complete three planned sessions within seven days and share a simple record of the chain. The goal is showing up, not chasing intensity.', 'STREAK', NULL, 150, 60, 8, false, 10, 3),
    ('gym_comeback_session', 'Come Back Anyway', 'Return for the next planned session after a missed day or difficult week. Share a brief note about how you restarted.', 'CHALLENGE', NULL, 120, 45, 7, false, 7, 4),
    ('gym_personal_standard', 'Set Your Standard', 'Write one personal standard for how you show up in training this month. Share the statement and one action that proves it.', 'SURVEY', NULL, 110, 45, 10, false, 14, 2),
    ('gym_small_win', 'The Small Win', 'Identify one small win from the week that you would usually dismiss. Share a short note or image link and why it counts.', 'SURVEY', NULL, 70, 25, 3, false, 3, 8),
    ('gym_recommend_a_gym', 'Recommend the Room', 'Share what makes a training space feel welcoming to a beginner. This can be a post, note, or short video; focus on practical details.', 'CONTENT_POST', 'instagram', 120, 45, 7, true, 7, 3),
    ('gym_observe_and_learn', 'Observe and Learn', 'Watch an experienced athlete complete a movement you want to improve. Write down three observations and share a link to the note.', 'SURVEY', NULL, 90, 35, 5, false, 5, 5),
    ('gym_future_self_note', 'Note to Future You', 'Write a note to yourself to read before your next difficult session. Share a photograph or document link to the note.', 'SURVEY', NULL, 100, 40, 7, false, 7, 4),
    ('gym_weekly_debrief', 'Weekly Debrief', 'Review the week: one thing to keep, one thing to improve, and one person who helped. Share your three-part debrief.', 'CHALLENGE', NULL, 140, 55, 8, false, 7, 4)
)
INSERT INTO task_templates (
  code, title, brief_md, type, platform, xp_value, coin_value, due_days,
  proof_type, requires_disclosure, repeatable, cooldown_days, monthly_cap,
  is_trial_task, is_active, is_athlete_portal_task
)
SELECT
  code, title, brief_md, type, platform, xp_value, coin_value, due_days,
  'URL', requires_disclosure, true, cooldown_days, monthly_cap,
  false, true, true
FROM missions
ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title,
  brief_md = EXCLUDED.brief_md,
  type = EXCLUDED.type,
  platform = EXCLUDED.platform,
  xp_value = EXCLUDED.xp_value,
  coin_value = EXCLUDED.coin_value,
  due_days = EXCLUDED.due_days,
  proof_type = EXCLUDED.proof_type,
  requires_disclosure = EXCLUDED.requires_disclosure,
  repeatable = EXCLUDED.repeatable,
  cooldown_days = EXCLUDED.cooldown_days,
  monthly_cap = EXCLUDED.monthly_cap,
  is_trial_task = EXCLUDED.is_trial_task,
  is_active = EXCLUDED.is_active,
  is_athlete_portal_task = true,
  updated_at = NOW();

-- Verify after execution:
-- SELECT count(*) FROM task_templates WHERE is_athlete_portal_task = true;
-- Expected: 50
