-- ==========================================================================
-- Tech Team Portal — Members + Tasks
-- ==========================================================================
-- Two tables powering the tech-team task management portal.
-- Members log in with username + mobile; admins assign and track tasks.
-- ==========================================================================

-- Team members table
CREATE TABLE IF NOT EXISTS tech_team_members (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username    TEXT UNIQUE NOT NULL,
    full_name   TEXT NOT NULL,
    mobile      TEXT NOT NULL,
    email       TEXT,
    role        TEXT NOT NULL DEFAULT 'developer',   -- developer | lead | admin | intern | qa | designer
    department  TEXT NOT NULL DEFAULT 'engineering',  -- engineering | frontend | backend | devops | design | qa | product | data
    hierarchy   TEXT NOT NULL DEFAULT 'junior',       -- intern | junior | mid | senior | lead | manager | head | director
    reports_to  UUID REFERENCES tech_team_members(id) ON DELETE SET NULL,  -- reporting manager
    skills      JSONB DEFAULT '[]'::jsonb,            -- ["react", "node", "aws", ...]
    avatar_url  TEXT,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tech_tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'todo',         -- todo | in_progress | review | done | blocked
    priority    TEXT NOT NULL DEFAULT 'medium',       -- low | medium | high | critical
    assigned_to UUID REFERENCES tech_team_members(id) ON DELETE SET NULL,
    created_by  UUID REFERENCES tech_team_members(id) ON DELETE SET NULL,
    project     TEXT,
    due_date    DATE,
    progress    INTEGER NOT NULL DEFAULT 0,           -- 0-100
    tags        JSONB DEFAULT '[]'::jsonb,
    notes       JSONB DEFAULT '[]'::jsonb,            -- [{text, author, created_at}]
    department  TEXT,                                  -- which dept this task belongs to
    category    TEXT,                                  -- feature | bug | maintenance | infra | documentation | testing
    estimated_hours INTEGER,                           -- time estimate
    actual_hours    INTEGER,                           -- time spent
    parent_task_id  UUID REFERENCES tech_tasks(id) ON DELETE SET NULL,  -- sub-task support
    sort_order  INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_tech_tasks_assigned_to ON tech_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tech_tasks_status ON tech_tasks(status);
CREATE INDEX IF NOT EXISTS idx_tech_tasks_project ON tech_tasks(project);
CREATE INDEX IF NOT EXISTS idx_tech_team_members_username ON tech_team_members(username);
CREATE INDEX IF NOT EXISTS idx_tech_team_members_active ON tech_team_members(active);
