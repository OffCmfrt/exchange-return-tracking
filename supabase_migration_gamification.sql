-- ============================================================================
-- GAMIFICATION LAYER — Daily Tasks, Weekly Challenges, Streaks, Badges
-- ----------------------------------------------------------------------------
-- Extends the athlete program with game mechanics:
--   - Daily task pools (5 tasks per day, athletes pick what to do)
--   - Weekly challenges (same for all, leaderboard + prizes)
--   - Streaks (daily completion tracking)
--   - Badges (achievement system)
--   - Configurable game settings
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. DAILY TASK POOLS — admin-curated sets of tasks per day
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_task_pools (
  id BIGSERIAL PRIMARY KEY,
  pool_date DATE NOT NULL UNIQUE,
  task_template_ids BIGINT[] NOT NULL DEFAULT '{}',
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_pools_date ON daily_task_pools(pool_date);
CREATE INDEX IF NOT EXISTS idx_daily_pools_published ON daily_task_pools(is_published) WHERE is_published = true;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. DAILY TASK PICKS — which tasks each athlete chose from the pool
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_task_picks (
  id BIGSERIAL PRIMARY KEY,
  influencer_id BIGINT NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  pool_date DATE NOT NULL,
  task_template_id BIGINT NOT NULL REFERENCES task_templates(id),
  assignment_id BIGINT REFERENCES assignments(id),
  picked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PICKED'
    CHECK (status IN ('PICKED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPIRED')),
  UNIQUE(influencer_id, pool_date, task_template_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_picks_influencer ON daily_task_picks(influencer_id);
CREATE INDEX IF NOT EXISTS idx_daily_picks_date ON daily_task_picks(pool_date);
CREATE INDEX IF NOT EXISTS idx_daily_picks_status ON daily_task_picks(status);
CREATE INDEX IF NOT EXISTS idx_daily_picks_athlete_date ON daily_task_picks(influencer_id, pool_date);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. WEEKLY CHALLENGES — one challenge per week, same for all athletes
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weekly_challenges (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  instructions TEXT,
  task_template_id BIGINT REFERENCES task_templates(id),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  max_winners INTEGER NOT NULL DEFAULT 3,
  reward_xp INTEGER NOT NULL DEFAULT 0,
  reward_coins INTEGER NOT NULL DEFAULT 0,
  reward_badge TEXT,
  cover_emoji TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (week_end > week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_challenges_active ON weekly_challenges(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_weekly_challenges_week ON weekly_challenges(week_start, week_end);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. WEEKLY CHALLENGE ENTRIES — athletes' submissions for the weekly
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS weekly_challenge_entries (
  id BIGSERIAL PRIMARY KEY,
  weekly_challenge_id BIGINT NOT NULL REFERENCES weekly_challenges(id) ON DELETE CASCADE,
  influencer_id BIGINT NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  submission_url TEXT,
  caption TEXT,
  media_urls TEXT[] DEFAULT '{}',
  disclosure_found BOOLEAN DEFAULT false,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score NUMERIC(7,2) DEFAULT 0,
  rank INTEGER,
  reviewed_at TIMESTAMPTZ,
  reviewer_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WINNER')),
  UNIQUE(weekly_challenge_id, influencer_id)
);

CREATE INDEX IF NOT EXISTS idx_weekly_entries_challenge ON weekly_challenge_entries(weekly_challenge_id);
CREATE INDEX IF NOT EXISTS idx_weekly_entries_influencer ON weekly_challenge_entries(influencer_id);
CREATE INDEX IF NOT EXISTS idx_weekly_entries_rank ON weekly_challenge_entries(weekly_challenge_id, rank) WHERE rank IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_weekly_entries_status ON weekly_challenge_entries(status);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. ATHLETE STREAKS — daily completion streaks
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS athlete_streaks (
  id BIGSERIAL PRIMARY KEY,
  influencer_id BIGINT NOT NULL UNIQUE REFERENCES influencers(id) ON DELETE CASCADE,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_active_date DATE,
  total_active_days INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_streaks_current ON athlete_streaks(current_streak DESC);
CREATE INDEX IF NOT EXISTS idx_streaks_longest ON athlete_streaks(longest_streak DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. ATHLETE BADGES — earned achievements
-- ────────────────────────────────────────────────────────────────────────────

-- 6a. Badge definitions (what badges exist in the system)
CREATE TABLE IF NOT EXISTS badge_definitions (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  category TEXT DEFAULT 'GENERAL'
    CHECK (category IN ('GENERAL', 'STREAK', 'WEEKLY', 'LEVEL', 'SPECIAL', 'CONTENT')),
  criteria_type TEXT DEFAULT 'MANUAL'
    CHECK (criteria_type IN ('MANUAL', 'AUTO_STREAK', 'AUTO_WEEKLY_WIN', 'AUTO_LEVEL', 'AUTO_TASKS_COUNT')),
  criteria_value INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_badges_code ON badge_definitions(code);
CREATE INDEX IF NOT EXISTS idx_badges_category ON badge_definitions(category);
CREATE INDEX IF NOT EXISTS idx_badges_active ON badge_definitions(is_active) WHERE is_active = true;

-- 6b. Badge awards (which athlete earned which badge)
CREATE TABLE IF NOT EXISTS athlete_badges (
  id BIGSERIAL PRIMARY KEY,
  influencer_id BIGINT NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
  badge_code TEXT NOT NULL REFERENCES badge_definitions(code),
  badge_name TEXT NOT NULL,
  badge_icon TEXT,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(influencer_id, badge_code)
);

CREATE INDEX IF NOT EXISTS idx_athlete_badges_influencer ON athlete_badges(influencer_id);
CREATE INDEX IF NOT EXISTS idx_athlete_badges_code ON athlete_badges(badge_code);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. GAME SETTINGS — extend program_settings with gamification keys
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO program_settings (key, value, description) VALUES
  -- Daily tasks
  ('daily_task.refresh_time',       '"09:00"'::jsonb,    'IST time when new daily tasks become available'),
  ('daily_task.max_picks',          '5'::jsonb,           'Maximum tasks an athlete can pick per day'),
  ('daily_task.pick_deadline_time', '"22:00"'::jsonb,     'IST deadline by which picks must be made'),

  -- Weekly challenges
  ('weekly_challenge.xp_reward_1st',   '500'::jsonb,      'XP for 1st place weekly winner'),
  ('weekly_challenge.xp_reward_2nd',   '300'::jsonb,      'XP for 2nd place weekly winner'),
  ('weekly_challenge.xp_reward_3rd',   '150'::jsonb,      'XP for 3rd place weekly winner'),
  ('weekly_challenge.coin_reward_1st', '200'::jsonb,      'Coins for 1st place weekly winner'),
  ('weekly_challenge.coin_reward_2nd', '100'::jsonb,      'Coins for 2nd place weekly winner'),
  ('weekly_challenge.coin_reward_3rd', '50'::jsonb,       'Coins for 3rd place weekly winner'),
  ('weekly_challenge.badge_reward',    '"weekly_champion"'::jsonb, 'Badge code awarded to weekly winner'),
  ('weekly_challenge.day_of_week',     '1'::jsonb,         'Day new weekly challenge starts (0=Sun, 1=Mon)'),

  -- Streaks
  ('streak.bonus_xp_per_day',       '10'::jsonb,          'Bonus XP per consecutive day'),
  ('streak.milestone_7_xp',         '100'::jsonb,         'Bonus XP for 7-day streak'),
  ('streak.milestone_30_xp',        '500'::jsonb,         'Bonus XP for 30-day streak'),
  ('streak.milestone_100_xp',       '2000'::jsonb,        'Bonus XP for 100-day streak'),

  -- Leaderboard
  ('leaderboard.weekly_period',     '"weekly"'::jsonb,    'Weekly leaderboard period'),
  ('leaderboard.podium_count',      '3'::jsonb,           'Number of athletes shown on podium'),

  -- Gamification display
  ('gamification.confetti_enabled', 'true'::jsonb,        'Enable confetti animation on task completion'),
  ('gamification.sound_enabled',    'false'::jsonb,       'Enable sound effects (future)')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. SEED BADGE DEFINITIONS
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO badge_definitions (code, name, description, icon, category, criteria_type, criteria_value) VALUES
  -- Streak badges
  ('streak_7',       'Week Warrior',       '7-day completion streak',          '🔥',  'STREAK',  'AUTO_STREAK', 7),
  ('streak_30',      'Monthly Master',     '30-day completion streak',         '⚡',  'STREAK',  'AUTO_STREAK', 30),
  ('streak_100',     'Centurion',          '100-day completion streak',        '💎',  'STREAK',  'AUTO_STREAK', 100),
  ('streak_365',     'Iron Athlete',       '365-day completion streak',        '👑',  'STREAK',  'AUTO_STREAK', 365),

  -- Weekly challenge badges
  ('weekly_champion','Weekly Champion',    'Won a weekly challenge',           '🏆',  'WEEKLY',  'AUTO_WEEKLY_WIN', 1),
  ('weekly_3x',      'Hat Trick',          'Won 3 weekly challenges',          '🎩',  'WEEKLY',  'AUTO_WEEKLY_WIN', 3),
  ('weekly_10x',     'Deca Champion',      'Won 10 weekly challenges',         '🌟',  'WEEKLY',  'AUTO_WEEKLY_WIN', 10),

  -- Level badges
  ('level_cl4',      'Comfort 4',          'Reached Comfort Level 4',          '🥉',  'LEVEL',   'AUTO_LEVEL', 2),
  ('level_cl3',      'Comfort 3',          'Reached Comfort Level 3',          '🥈',  'LEVEL',   'AUTO_LEVEL', 3),
  ('level_cl2',      'Comfort 2',          'Reached Comfort Level 2',          '🥇',  'LEVEL',   'AUTO_LEVEL', 4),
  ('level_cl1',      'Comfort 1',          'Reached Comfort Level 1',          '💫',  'LEVEL',   'AUTO_LEVEL', 5),
  ('level_zero',     'Zero Comfort',       'Reached Zero Comfort — the top',   '🏅',  'LEVEL',   'AUTO_LEVEL', 6),

  -- Content badges
  ('first_post',     'First Post',         'Submitted your first task',        '📸',  'CONTENT', 'AUTO_TASKS_COUNT', 1),
  ('ten_posts',      'Content Creator',    'Completed 10 tasks',               '🎬',  'CONTENT', 'AUTO_TASKS_COUNT', 10),
  ('fifty_posts',    'Content Machine',    'Completed 50 tasks',               '🚀',  'CONTENT', 'AUTO_TASKS_COUNT', 50),
  ('hundred_posts',  'Legendary Creator',  'Completed 100 tasks',              '🦄',  'CONTENT', 'AUTO_TASKS_COUNT', 100),

  -- Special badges
  ('early_adopter',  'Early Adopter',      'Joined in the first cohort',       '🌱',  'SPECIAL', 'MANUAL', NULL),
  ('community_pick', 'Community Pick',     'Most liked submission in a week',  '❤️',  'SPECIAL', 'MANUAL', NULL)
ON CONFLICT (code) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. TRIGGERS — auto-update updated_at
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  t TEXT;
  tbl_list TEXT[] := ARRAY[
    'daily_task_pools', 'daily_task_picks', 'weekly_challenges',
    'weekly_challenge_entries', 'athlete_streaks'
  ];
BEGIN
  FOREACH t IN ARRAY tbl_list LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
       CREATE TRIGGER trg_%s_updated_at
         BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION athlete_program_updated_at();',
      t, t, t, t
    );
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. VERIFICATION
-- ────────────────────────────────────────────────────────────────────────────

-- Run these to verify:
-- SELECT table_name FROM information_schema.tables
--   WHERE table_schema = 'public'
--   AND table_name IN ('daily_task_pools','daily_task_picks','weekly_challenges',
--     'weekly_challenge_entries','athlete_streaks','badge_definitions','athlete_badges')
--   ORDER BY table_name;
--
-- SELECT * FROM badge_definitions ORDER BY category, code;
-- SELECT key, value FROM program_settings WHERE key LIKE 'daily_task.%' OR key LIKE 'weekly_challenge.%' OR key LIKE 'streak.%' OR key LIKE 'gamification.%' ORDER BY key;
