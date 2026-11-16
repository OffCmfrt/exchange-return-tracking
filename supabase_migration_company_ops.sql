-- ==========================================================================
-- Company Ops Portal — Departments, Staff, Tasks, HR modules, Chat
-- ==========================================================================
-- Full company-wide task management + realtime chat system served by
-- /company/* in this app. Mirrors the tech-team schema, generalized by
-- department, plus chat tables. Safe to re-run (everything IF NOT EXISTS).
-- Run in the Supabase SQL editor on the SAME project the app uses.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Departments
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_departments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    head_staff_id   UUID,          -- FK to company_staff added at the end
    color           TEXT,          -- hex accent for the dept chip
    active          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- 2. Staff (login: username + mobile, same contract as tech team)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_staff (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username              TEXT UNIQUE NOT NULL,
    full_name             TEXT NOT NULL,
    mobile                TEXT NOT NULL,
    email                 TEXT,
    role                  TEXT NOT NULL DEFAULT 'executive',
    department            TEXT NOT NULL DEFAULT 'operations',   -- company_departments.slug
    hierarchy             TEXT NOT NULL DEFAULT 'junior',       -- intern|junior|mid|senior|lead|manager|head|director
    reports_to            UUID REFERENCES company_staff(id) ON DELETE SET NULL,
    is_admin              BOOLEAN NOT NULL DEFAULT false,       -- department lead/console access
    can_view_departments  TEXT[] NOT NULL DEFAULT '{}',         -- extra dept slugs this lead may see
    skills                JSONB DEFAULT '[]'::jsonb,
    avatar_url            TEXT,
    active                BOOLEAN NOT NULL DEFAULT true,
    join_date             DATE,
    location              TEXT,
    timezone              TEXT,
    bio                   TEXT,
    overall_rating        TEXT,
    review_count          INTEGER NOT NULL DEFAULT 0,
    achievement_count     INTEGER NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_staff_username   ON company_staff(username);
CREATE INDEX IF NOT EXISTS idx_company_staff_department ON company_staff(department);
CREATE INDEX IF NOT EXISTS idx_company_staff_active     ON company_staff(active);

-- --------------------------------------------------------------------------
-- 3. Projects
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    department  TEXT,
    owner_id    UUID REFERENCES company_staff(id) ON DELETE SET NULL,
    status      TEXT NOT NULL DEFAULT 'active',   -- planning | active | on_hold | completed | archived
    start_date  DATE,
    target_date DATE,
    color       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_projects_department ON company_projects(department);
CREATE INDEX IF NOT EXISTS idx_company_projects_status     ON company_projects(status);

-- --------------------------------------------------------------------------
-- 4. Tasks (full workflow: stage machine + audit trail + SLA + recurrence)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_tasks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title            TEXT NOT NULL,
    description      TEXT,
    status           TEXT NOT NULL DEFAULT 'todo',        -- todo|in_progress|review|done|blocked (kanban lane)
    workflow_state   TEXT NOT NULL DEFAULT 'draft',       -- draft|assigned|in_progress|blocked|review|rework|done|cancelled
    priority         TEXT NOT NULL DEFAULT 'medium',      -- low | medium | high | critical
    assigned_to      UUID REFERENCES company_staff(id) ON DELETE SET NULL,
    created_by       UUID REFERENCES company_staff(id) ON DELETE SET NULL,
    project_id       UUID REFERENCES company_projects(id) ON DELETE SET NULL,
    department       TEXT,
    category         TEXT,
    due_date         DATE,
    sla_due_at       TIMESTAMPTZ,
    progress         INTEGER NOT NULL DEFAULT 0,          -- 0-100
    estimated_hours  INTEGER,
    actual_hours     INTEGER,
    parent_task_id   UUID REFERENCES company_tasks(id) ON DELETE SET NULL,
    depends_on       JSONB DEFAULT '[]'::jsonb,           -- [task_id]
    sort_order       INTEGER DEFAULT 0,
    tags             JSONB DEFAULT '[]'::jsonb,
    notes            JSONB DEFAULT '[]'::jsonb,           -- legacy free notes
    subtasks         JSONB DEFAULT '[]'::jsonb,           -- [{id,title,done}]
    attachments      JSONB DEFAULT '[]'::jsonb,           -- [{name,url,size}]
    watchers         JSONB DEFAULT '[]'::jsonb,           -- [staff_id]
    stage_history    JSONB DEFAULT '[]'::jsonb,           -- [{from,to,by,at}]
    acknowledged_at  TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    is_recurring     BOOLEAN NOT NULL DEFAULT false,
    recurrence_rule  TEXT,                                -- daily | weekly | biweekly | monthly
    time_logged      JSONB DEFAULT '[]'::jsonb,           -- [{by,minutes,note,at}]
    quality_rating   INTEGER,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_tasks_assigned_to ON company_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_company_tasks_status      ON company_tasks(status);
CREATE INDEX IF NOT EXISTS idx_company_tasks_department  ON company_tasks(department);
CREATE INDEX IF NOT EXISTS idx_company_tasks_project     ON company_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_company_tasks_priority    ON company_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_company_tasks_completed   ON company_tasks(completed_at);
CREATE INDEX IF NOT EXISTS idx_company_tasks_workflow    ON company_tasks(workflow_state);

-- --------------------------------------------------------------------------
-- 5. Task comments (threaded discussion table; task drawer links a chat thread)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_task_comments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID NOT NULL REFERENCES company_tasks(id) ON DELETE CASCADE,
    author_id  UUID REFERENCES company_staff(id) ON DELETE SET NULL,
    author_name TEXT,
    text       TEXT NOT NULL,
    parent_id  UUID REFERENCES company_task_comments(id) ON DELETE CASCADE,  -- thread reply
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_task_comments_task ON company_task_comments(task_id, created_at);

-- --------------------------------------------------------------------------
-- 6. Performance reviews
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_performance_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id        UUID NOT NULL REFERENCES company_staff(id) ON DELETE CASCADE,
    reviewer_id     UUID REFERENCES company_staff(id) ON DELETE SET NULL,
    review_period   TEXT,               -- e.g. 2026-Q4
    overall_rating  TEXT,               -- "4.5"
    timeliness      INTEGER,
    quality         INTEGER,
    communication   INTEGER,
    collaboration   INTEGER,
    initiative      INTEGER,
    problem_solving INTEGER,
    strengths       TEXT,
    improvements    TEXT,
    comments        TEXT,
    review_type     TEXT NOT NULL DEFAULT 'manager',   -- manager | peer | self
    department      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_reviews_staff   ON company_performance_reviews(staff_id);
CREATE INDEX IF NOT EXISTS idx_company_reviews_period  ON company_performance_reviews(review_period);
CREATE INDEX IF NOT EXISTS idx_company_reviews_dept    ON company_performance_reviews(department);

-- --------------------------------------------------------------------------
-- 7. Skills matrix
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_staff_skills (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id         UUID NOT NULL REFERENCES company_staff(id) ON DELETE CASCADE,
    skill_name       TEXT NOT NULL,
    category         TEXT,
    proficiency      INTEGER NOT NULL DEFAULT 1,    -- 1-5
    years_experience NUMERIC,
    last_used        DATE,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_skills_staff ON company_staff_skills(staff_id);
CREATE INDEX IF NOT EXISTS idx_company_skills_name  ON company_staff_skills(skill_name);

-- --------------------------------------------------------------------------
-- 8. OKRs (per staff or per department via dept_id slug)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_okrs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id       UUID REFERENCES company_staff(id) ON DELETE CASCADE,
    dept_id        TEXT,                              -- department slug for dept-level OKRs
    objective_text TEXT NOT NULL,
    period         TEXT,                              -- e.g. 2026-Q4
    key_results    JSONB DEFAULT '[]'::jsonb,         -- [{text,target,current,unit}]
    status         TEXT NOT NULL DEFAULT 'active',    -- active | achieved | missed | archived
    progress       INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_okrs_staff ON company_okrs(staff_id);
CREATE INDEX IF NOT EXISTS idx_company_okrs_dept  ON company_okrs(dept_id);
CREATE INDEX IF NOT EXISTS idx_company_okrs_period ON company_okrs(period);

-- --------------------------------------------------------------------------
-- 9. Meetings / 1:1s
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_meetings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id         UUID REFERENCES company_staff(id) ON DELETE CASCADE,
    organizer_id     UUID REFERENCES company_staff(id) ON DELETE SET NULL,
    department       TEXT,
    meeting_type     TEXT NOT NULL DEFAULT '1on1',    -- 1on1 | team | review | retro | planning
    title            TEXT NOT NULL,
    notes            TEXT,
    action_items     JSONB DEFAULT '[]'::jsonb,       -- [{text,owner,done}]
    attendees        JSONB DEFAULT '[]'::jsonb,       -- [staff_id]
    scheduled_at     TIMESTAMPTZ,
    duration_minutes INTEGER DEFAULT 30,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_meetings_staff ON company_meetings(staff_id);
CREATE INDEX IF NOT EXISTS idx_company_meetings_when  ON company_meetings(scheduled_at);

-- --------------------------------------------------------------------------
-- 10. Achievements
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_achievements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id    UUID NOT NULL REFERENCES company_staff(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    category    TEXT,
    awarded_by  UUID REFERENCES company_staff(id) ON DELETE SET NULL,
    badge_icon  TEXT,
    department  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_achievements_staff ON company_achievements(staff_id);

-- --------------------------------------------------------------------------
-- 11. Goals
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_goals (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id    UUID REFERENCES company_staff(id) ON DELETE CASCADE,
    department  TEXT,
    goal_text   TEXT NOT NULL,
    category    TEXT,
    target_date DATE,
    status      TEXT NOT NULL DEFAULT 'active',       -- active | achieved | abandoned
    progress    INTEGER NOT NULL DEFAULT 0,
    milestones  JSONB DEFAULT '[]'::jsonb,            -- [{text,done,due}]
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_goals_staff ON company_goals(staff_id);

-- --------------------------------------------------------------------------
-- 12. Chat — channels, membership, messages, task-thread links
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_chat_channels (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                TEXT NOT NULL DEFAULT 'group',   -- dept | group | direct | task
    name                TEXT,
    department          TEXT,                             -- dept slug for type='dept'
    created_by          UUID REFERENCES company_staff(id) ON DELETE SET NULL,
    pinned_message_ids  JSONB DEFAULT '[]'::jsonb,
    task_id             UUID REFERENCES company_tasks(id) ON DELETE CASCADE,  -- type='task'
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_chat_channels_dept  ON company_chat_channels(department);
CREATE INDEX IF NOT EXISTS idx_company_chat_channels_type  ON company_chat_channels(type);
CREATE UNIQUE INDEX IF NOT EXISTS uq_company_chat_task_thread ON company_chat_channels(task_id) WHERE task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS company_chat_channel_members (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id   UUID NOT NULL REFERENCES company_chat_channels(id) ON DELETE CASCADE,
    staff_id     UUID NOT NULL REFERENCES company_staff(id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'member',   -- member | owner
    last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    muted        BOOLEAN NOT NULL DEFAULT false,
    joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (channel_id, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_company_chat_members_staff ON company_chat_channel_members(staff_id);

CREATE TABLE IF NOT EXISTS company_chat_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  UUID NOT NULL REFERENCES company_chat_channels(id) ON DELETE CASCADE,
    sender_id   UUID REFERENCES company_staff(id) ON DELETE SET NULL,
    sender_name TEXT,
    text        TEXT NOT NULL,
    reply_to    UUID REFERENCES company_chat_messages(id) ON DELETE SET NULL,
    attachments JSONB DEFAULT '[]'::jsonb,   -- [{name,url,size}]
    reactions   JSONB DEFAULT '{}'::jsonb,   -- { "👍": [staff_id] } kept server-normalized
    mentions    JSONB DEFAULT '[]'::jsonb,   -- [staff_id] resolved at send time
    edited_at   TIMESTAMPTZ,
    deleted_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_chat_messages_channel ON company_chat_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_company_chat_messages_sender  ON company_chat_messages(sender_id);

-- --------------------------------------------------------------------------
-- 13. Late FK: department head -> staff
-- --------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_company_departments_head'
    ) THEN
        ALTER TABLE company_departments
            ADD CONSTRAINT fk_company_departments_head
            FOREIGN KEY (head_staff_id) REFERENCES company_staff(id) ON DELETE SET NULL;
    END IF;
END $$;

-- --------------------------------------------------------------------------
-- 14. updated_at triggers (one shared function, guarded)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION company_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
    c INT := 0;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'company_departments', 'company_staff', 'company_projects', 'company_tasks',
        'company_performance_reviews', 'company_staff_skills', 'company_okrs',
        'company_meetings', 'company_goals', 'company_chat_channels', 'company_chat_messages'
    ] LOOP
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t || '_updated_at' AND relkind = 'T') THEN
            c := c + 1;
        ELSE
            EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION company_set_updated_at()', t || '_updated_at', t);
        END IF;
    END LOOP;
    RAISE NOTICE 'updated_at triggers ensured (% already present)', c;
END $$;

-- --------------------------------------------------------------------------
-- 15. Seed departments (only when missing; admin can rename/add later)
-- --------------------------------------------------------------------------
INSERT INTO company_departments (slug, name) VALUES
    ('engineering',      'Engineering'),
    ('operations',       'Operations'),
    ('warehouse',        'Warehouse'),
    ('customer_support', 'Customer Support'),
    ('marketing',        'Marketing'),
    ('design',           'Design'),
    ('finance',          'Finance'),
    ('hr',               'People / HR'),
    ('retail',           'Retail')
ON CONFLICT (slug) DO NOTHING;

-- --------------------------------------------------------------------------
-- 16. RLS: enable everywhere; the server uses the service-role key which
--     bypasses RLS, so no public policies are needed.
-- --------------------------------------------------------------------------
ALTER TABLE company_departments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_staff               ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_projects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_task_comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_staff_skills        ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_okrs                ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_meetings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_achievements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_goals               ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_chat_channels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_chat_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_chat_messages       ENABLE ROW LEVEL SECURITY;

-- --------------------------------------------------------------------------
-- 16b. Atomic reaction toggle (single UPDATE, no read-modify-write race).
--      Adds/removes the staff id under the emoji key in `reactions`.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION company_toggle_reaction(
    p_message_id UUID,
    p_staff_id   TEXT,
    p_emoji      TEXT
)
RETURNS JSONB
LANGUAGE sql
AS $fn$
    WITH cur AS (
        SELECT m.channel_id,
               COALESCE(m.reactions, '{}'::jsonb) AS rx,
               COALESCE(m.reactions -> p_emoji, '[]'::jsonb) AS users
        FROM company_chat_messages m
        WHERE m.id = p_message_id AND m.deleted_at IS NULL
    ),
    next AS (
        UPDATE company_chat_messages m
        SET reactions = jsonb_set(
            cur.rx,
            ARRAY[p_emoji],
            CASE
                WHEN cur.users @> jsonb_build_array(p_staff_id)
                    -- strip this staff id from the array (jsonb -text only
                    -- deletes object keys, so rebuild from elements instead)
                    THEN (
                        SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
                        FROM jsonb_array_elements_text(cur.users) AS e
                        WHERE e <> p_staff_id
                    )
                ELSE cur.users || jsonb_build_array(p_staff_id)
            END,
            true
        )
        FROM cur
        WHERE m.id = p_message_id
        RETURNING m.id, m.channel_id, m.reactions
    )
    SELECT jsonb_build_object('id', id, 'channelId', channel_id, 'reactions', reactions)
    FROM next;
$fn$;

-- --------------------------------------------------------------------------
-- 17. Verification — paste result back if anything looks off
-- --------------------------------------------------------------------------
SELECT table_name,
       (SELECT count(*) FROM information_schema.columns c WHERE c.table_name = t.table_name) AS columns
FROM information_schema.tables t
WHERE t.table_schema = 'public' AND table_name LIKE 'company_%'
ORDER BY table_name;
