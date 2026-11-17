-- =====================================================================
-- OFFCOMFRT Product Lab — schema (Phase 1)
-- Run in the Supabase SQL Editor of the "exchange-return-tracking"
-- dashboard project (the same project the app reaches via SUPABASE_URL).
-- Idempotent: safe to paste more than once. No placeholders.
-- =====================================================================

-- 16 document-style collections + tombstones for delta sync ------------
CREATE TABLE IF NOT EXISTS pl_products (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_milestones (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_tasks (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_approvals (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_activity (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_config (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_samples (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_fabrics (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_trims (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_suppliers (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_ideas (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_costsheets (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_qc (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_hires (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_expenses (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_experiments (id text PRIMARY KEY, pid text, data jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS pl_tombstones (id text PRIMARY KEY, collection text NOT NULL, record_id text NOT NULL, deleted_at timestamptz NOT NULL DEFAULT now());

-- Per-column idempotency for tables that may already exist in an older shape
ALTER TABLE pl_products ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_products ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_products ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_milestones ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_milestones ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_milestones ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_tasks ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_tasks ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_tasks ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_approvals ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_approvals ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_approvals ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_activity ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_activity ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_activity ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_config ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_config ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_config ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_samples ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_samples ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_samples ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_fabrics ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_fabrics ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_fabrics ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_trims ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_trims ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_trims ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_suppliers ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_suppliers ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_suppliers ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_ideas ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_ideas ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_ideas ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_costsheets ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_costsheets ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_costsheets ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_qc ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_qc ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_qc ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_hires ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_hires ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_hires ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_expenses ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_expenses ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_expenses ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_experiments ADD COLUMN IF NOT EXISTS pid text;
ALTER TABLE pl_experiments ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE pl_experiments ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pl_tombstones ADD COLUMN IF NOT EXISTS collection text NOT NULL;
ALTER TABLE pl_tombstones ADD COLUMN IF NOT EXISTS record_id text NOT NULL;
ALTER TABLE pl_tombstones ADD COLUMN IF NOT EXISTS deleted_at timestamptz NOT NULL DEFAULT now();

-- Indexes: watermark paging (updated_at) and per-product lookups (pid) --
CREATE INDEX IF NOT EXISTS pl_products_updated_at ON pl_products (updated_at);
CREATE INDEX IF NOT EXISTS pl_products_pid ON pl_products (pid);
CREATE INDEX IF NOT EXISTS pl_milestones_updated_at ON pl_milestones (updated_at);
CREATE INDEX IF NOT EXISTS pl_milestones_pid ON pl_milestones (pid);
CREATE INDEX IF NOT EXISTS pl_tasks_updated_at ON pl_tasks (updated_at);
CREATE INDEX IF NOT EXISTS pl_tasks_pid ON pl_tasks (pid);
CREATE INDEX IF NOT EXISTS pl_approvals_updated_at ON pl_approvals (updated_at);
CREATE INDEX IF NOT EXISTS pl_approvals_pid ON pl_approvals (pid);
CREATE INDEX IF NOT EXISTS pl_activity_updated_at ON pl_activity (updated_at);
CREATE INDEX IF NOT EXISTS pl_activity_pid ON pl_activity (pid);
CREATE INDEX IF NOT EXISTS pl_config_updated_at ON pl_config (updated_at);
CREATE INDEX IF NOT EXISTS pl_samples_updated_at ON pl_samples (updated_at);
CREATE INDEX IF NOT EXISTS pl_samples_pid ON pl_samples (pid);
CREATE INDEX IF NOT EXISTS pl_fabrics_updated_at ON pl_fabrics (updated_at);
CREATE INDEX IF NOT EXISTS pl_fabrics_pid ON pl_fabrics (pid);
CREATE INDEX IF NOT EXISTS pl_trims_updated_at ON pl_trims (updated_at);
CREATE INDEX IF NOT EXISTS pl_trims_pid ON pl_trims (pid);
CREATE INDEX IF NOT EXISTS pl_suppliers_updated_at ON pl_suppliers (updated_at);
CREATE INDEX IF NOT EXISTS pl_ideas_updated_at ON pl_ideas (updated_at);
CREATE INDEX IF NOT EXISTS pl_ideas_pid ON pl_ideas (pid);
CREATE INDEX IF NOT EXISTS pl_costsheets_updated_at ON pl_costsheets (updated_at);
CREATE INDEX IF NOT EXISTS pl_costsheets_pid ON pl_costsheets (pid);
CREATE INDEX IF NOT EXISTS pl_qc_updated_at ON pl_qc (updated_at);
CREATE INDEX IF NOT EXISTS pl_qc_pid ON pl_qc (pid);
CREATE INDEX IF NOT EXISTS pl_hires_updated_at ON pl_hires (updated_at);
CREATE INDEX IF NOT EXISTS pl_expenses_updated_at ON pl_expenses (updated_at);
CREATE INDEX IF NOT EXISTS pl_expenses_pid ON pl_expenses (pid);
CREATE INDEX IF NOT EXISTS pl_experiments_updated_at ON pl_experiments (updated_at);
CREATE INDEX IF NOT EXISTS pl_experiments_pid ON pl_experiments (pid);
CREATE INDEX IF NOT EXISTS pl_tombstones_deleted_at ON pl_tombstones (deleted_at);
CREATE INDEX IF NOT EXISTS pl_tombstones_collection_record ON pl_tombstones (collection, record_id);

-- RLS on, no policies: anon/authenticated keys can read nothing;
-- the server's service role key bypasses RLS.
ALTER TABLE pl_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_fabrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_trims ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_costsheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_qc ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_hires ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_tombstones ENABLE ROW LEVEL SECURITY;

-- Seed the workspace config row (Founder + Product Lead people) --------
INSERT INTO pl_config (id, pid, data, updated_at)
VALUES ('main', 'main', $seed$
{
  "id": "main",
  "company": "OFFCOMFRT",
  "currency": "INR",
  "people": [
    {"id": "p-founder", "name": "Founder", "role": "founder", "title": "Founder / Creative Director", "resp": "Brand, creative direction and creative approval.", "external": false},
    {"id": "p-lead", "name": "Product Lead", "role": "lead", "title": "Product Lead", "resp": "Runs product development end to end: pipeline, sampling, suppliers, technical approval.", "external": false}
  ],
  "collections": [],
  "budget": {},
  "finance": {}
}
$seed$::jsonb, now())
ON CONFLICT (id) DO NOTHING;

-- Verification: paste the result back to confirm the adopted shape -----
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name LIKE 'pl_%'
ORDER BY table_name, ordinal_position;
