-- ==========================================================================
-- Tech Team Premium — Performance, Skills, OKRs, Meetings, Achievements, Goals
-- ==========================================================================
-- Extends the tech-team portal with:
--   1. Performance reviews (manager/peer/self with 6 sub-scores)
--   2. Skill matrix (per-member proficiency tracking)
--   3. OKRs (Objectives & Key Results per period)
--   4. Meetings (1-on-1, team, review, retro with action items)
--   5. Achievements (recognition & badges)
--   6. Goals (personal/professional with milestones)
--   7. Extended member profile fields
--   8. Extended task fields (subtasks, dependencies, time logging, quality)
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend tech_team_members with profile & rating fields
-- ---------------------------------------------------------------------------
ALTER TABLE tech_team_members
    ADD COLUMN IF NOT EXISTS join_date        DATE,
    ADD COLUMN IF NOT EXISTS location         TEXT,
    ADD COLUMN IF NOT EXISTS timezone         TEXT DEFAULT 'UTC',
    ADD COLUMN IF NOT EXISTS bio              TEXT,
    ADD COLUMN IF NOT EXISTS overall_rating   DECIMAL(3,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS review_count     INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS achievement_count INTEGER DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2. Extend tech_tasks with subtasks, dependencies, time, quality
-- ---------------------------------------------------------------------------
ALTER TABLE tech_tasks
    ADD COLUMN IF NOT EXISTS subtasks        JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS depends_on      JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS time_logged     INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS completed_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS quality_rating  INTEGER;

-- ---------------------------------------------------------------------------
-- 3. Performance reviews
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tech_performance_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES tech_team_members(id) ON DELETE CASCADE,
    reviewer_id     UUID NOT NULL REFERENCES tech_team_members(id) ON DELETE CASCADE,
    review_period   TEXT NOT NULL,                          -- e.g. "2026-Q3"
    overall_rating  DECIMAL(3,2) NOT NULL DEFAULT 0,        -- 1.00 - 5.00
    timeliness      INTEGER NOT NULL DEFAULT 3,             -- 1-5
    quality         INTEGER NOT NULL DEFAULT 3,             -- 1-5
    communication   INTEGER NOT NULL DEFAULT 3,             -- 1-5
    collaboration   INTEGER NOT NULL DEFAULT 3,             -- 1-5
    initiative      INTEGER NOT NULL DEFAULT 3,             -- 1-5
    problem_solving INTEGER NOT NULL DEFAULT 3,             -- 1-5
    strengths       TEXT,
    improvements    TEXT,
    comments        TEXT,
    review_type     TEXT NOT NULL DEFAULT 'manager',        -- manager | peer | self
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perf_reviews_member ON tech_performance_reviews(member_id);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_period ON tech_performance_reviews(review_period);
CREATE INDEX IF NOT EXISTS idx_perf_reviews_type   ON tech_performance_reviews(review_type);

-- ---------------------------------------------------------------------------
-- 4. Member skills matrix
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tech_member_skills (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES tech_team_members(id) ON DELETE CASCADE,
    skill_name      TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'technical',        -- technical | soft | domain | tool
    proficiency     INTEGER NOT NULL DEFAULT 1,               -- 1-5 (beginner..master)
    years_experience DECIMAL(3,1) DEFAULT 0,
    last_used       DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(member_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_skills_member   ON tech_member_skills(member_id);
CREATE INDEX IF NOT EXISTS idx_skills_category ON tech_member_skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_name     ON tech_member_skills(skill_name);

-- ---------------------------------------------------------------------------
-- 5. OKRs (Objectives & Key Results)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tech_okrs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES tech_team_members(id) ON DELETE CASCADE,
    objective_text  TEXT NOT NULL,
    period          TEXT NOT NULL,                          -- e.g. "2026-Q3"
    key_results     JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{text, target, current, unit}]
    status          TEXT NOT NULL DEFAULT 'draft',          -- draft | active | achieved | missed
    progress        INTEGER NOT NULL DEFAULT 0,             -- 0-100
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_okrs_member ON tech_okrs(member_id);
CREATE INDEX IF NOT EXISTS idx_okrs_period ON tech_okrs(period);
CREATE INDEX IF NOT EXISTS idx_okrs_status ON tech_okrs(status);

-- ---------------------------------------------------------------------------
-- 6. Meetings (1-on-1, team, review, retro)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tech_meetings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID REFERENCES tech_team_members(id) ON DELETE SET NULL,  -- null for team meetings
    meeting_type    TEXT NOT NULL DEFAULT '1on1',           -- 1on1 | team | review | retro
    title           TEXT NOT NULL,
    notes           TEXT,
    action_items    JSONB DEFAULT '[]'::jsonb,              -- [{text, done, assignee}]
    attendees       JSONB DEFAULT '[]'::jsonb,              -- [member_id, ...]
    scheduled_at    TIMESTAMPTZ,
    duration_minutes INTEGER DEFAULT 30,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meetings_member ON tech_meetings(member_id);
CREATE INDEX IF NOT EXISTS idx_meetings_type   ON tech_meetings(meeting_type);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled ON tech_meetings(scheduled_at);

-- ---------------------------------------------------------------------------
-- 7. Achievements (recognition & badges)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tech_achievements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES tech_team_members(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    description     TEXT,
    category        TEXT NOT NULL DEFAULT 'shoutout',       -- milestone | award | certification | shoutout
    awarded_by      UUID REFERENCES tech_team_members(id) ON DELETE SET NULL,
    badge_icon      TEXT DEFAULT 'star',                    -- icon identifier
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_achievements_member   ON tech_achievements(member_id);
CREATE INDEX IF NOT EXISTS idx_achievements_category ON tech_achievements(category);

-- ---------------------------------------------------------------------------
-- 8. Goals (personal/professional)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tech_goals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id       UUID NOT NULL REFERENCES tech_team_members(id) ON DELETE CASCADE,
    goal_text       TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'performance',    -- career | learning | performance | personal
    target_date     DATE,
    status          TEXT NOT NULL DEFAULT 'active',         -- active | achieved | paused | dropped
    progress        INTEGER NOT NULL DEFAULT 0,             -- 0-100
    milestones      JSONB DEFAULT '[]'::jsonb,              -- [{text, done}]
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goals_member  ON tech_goals(member_id);
CREATE INDEX IF NOT EXISTS idx_goals_status  ON tech_goals(status);
CREATE INDEX IF NOT EXISTS idx_goals_category ON tech_goals(category);

-- ==========================================================================
-- Done. Apply this migration in Supabase SQL Editor:
-- https://app.supabase.com/project/xfirtmnciahexpnlnhdc/sql/new
-- ==========================================================================
