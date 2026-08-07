-- ============================================================
-- AI Admin Copilot — pending actions, chat history, usage log
-- + exec_read_sql RPC used by the run_sql_read copilot tool
-- Run this in the Supabase SQL editor (safe to re-run).
-- ============================================================

-- 1. Pending actions (confirmation flow for mutating AI tools)
CREATE TABLE IF NOT EXISTS ai_pending_actions (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_args JSONB DEFAULT '{}'::jsonb,
    summary TEXT,
    status TEXT NOT NULL DEFAULT 'pending', -- pending/confirmed/cancelled/expired/executed/failed
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_pending_actions_actor_status
    ON ai_pending_actions (actor, status);

-- 2. Copilot chat history (last ~20 turns per admin, pruned by the app)
CREATE TABLE IF NOT EXISTS ai_chat_history (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT NOT NULL,
    role TEXT NOT NULL, -- user/assistant
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_history_actor_id
    ON ai_chat_history (actor, id DESC);

-- 3. Usage log (tokens + estimated cost, powers the usage widget & daily caps)
CREATE TABLE IF NOT EXISTS ai_usage_log (
    id BIGSERIAL PRIMARY KEY,
    actor TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'chat', -- chat/suggest_reply
    model TEXT,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0,
    tool_calls TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_actor_created
    ON ai_usage_log (actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created
    ON ai_usage_log (created_at DESC);

-- Lock the AI tables down: server uses the service-role key, which bypasses RLS.
ALTER TABLE ai_pending_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_chat_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

-- 4. Read-only SQL RPC for the copilot's run_sql_read tool.
--    The app validates the query first (single SELECT, keyword blocklist,
--    wrapped in LIMIT 100); this function adds a second server-side guard and
--    runs in a read-only transaction so writes are impossible.
CREATE OR REPLACE FUNCTION exec_read_sql(query TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    result JSONB;
BEGIN
    -- Defense in depth: only a single SELECT statement is allowed
    IF query IS NULL OR btrim(query) = '' THEN
        RAISE EXCEPTION 'Empty query';
    END IF;
    IF position(';' IN query) > 0 THEN
        RAISE EXCEPTION 'Multiple statements are not allowed';
    END IF;
    IF lower(btrim(query)) !~ '^(select|with)\s' THEN
        RAISE EXCEPTION 'Only SELECT queries are allowed';
    END IF;

    -- Read-only transaction: any write attempt errors out
    SET LOCAL TRANSACTION READ ONLY;
    SET LOCAL statement_timeout = '5s';

    EXECUTE format('SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', query)
    INTO result;

    RETURN result;
END;
$$;

-- Only the service role (used by the Node server) may call it
REVOKE ALL ON FUNCTION exec_read_sql(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION exec_read_sql(TEXT) FROM anon;
REVOKE ALL ON FUNCTION exec_read_sql(TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION exec_read_sql(TEXT) TO service_role;

-- 5. Default settings (kill switch + daily limits, editable without redeploy)
INSERT INTO store_settings (key, value)
VALUES
    ('ai_admin_copilot_enabled', 'true'),
    ('ai_daily_admin_limit', '50'),
    ('ai_suggest_reply_daily_limit', '100')
ON CONFLICT (key) DO NOTHING;
