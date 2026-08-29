-- ============================================================================
-- Founder OS: Cloud State Persistence
-- Stores the Founder OS app state (tasks, projects, departments, decisions,
-- goals, reviews, personal log, etc.) so it syncs across devices instead of
-- living only in browser localStorage.
-- Accessed via /api/founder-os/state (authenticated admin endpoints).
-- ============================================================================

CREATE TABLE IF NOT EXISTS founder_os_state (
    key TEXT PRIMARY KEY,
    state JSONB NOT NULL DEFAULT '{}',
    updated_by TEXT,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE founder_os_state IS 'Founder OS app state, one row per workspace (key = main)';
