-- ============================================================
-- Manufacture Control Tower: product development workspace
-- Run in the Supabase SQL editor (same project as the other
-- supabase_migration_*.sql files).
--
-- Four tables mirroring the control-tower data model. Nested
-- lists (QC rows, revisions, comms, files, size breakdowns and
-- the sample cost breakdown) are stored as jsonb.
--
-- Optional cleanup: the previous iteration used a single
-- `manufacture_designs` table which is no longer used:
--   drop table if exists manufacture_designs;
-- ============================================================

-- Manufacturers directory
create table if not exists manufacturers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  location text,
  contact text,
  phone text,
  email text,
  categories text,
  fabric_capabilities text,
  moq text,
  sample_lead_time text,
  bulk_lead_time text,
  quality_rating integer,
  communication_rating integer,
  notes text,
  -- Portal access (managed from the admin dashboard, Manufacturers tab):
  -- portal_access    = portal login enabled for this manufacturer;
  -- link_token       = their private portal link (?token=...), like influencers;
  -- portal_password  = set by the admin, required on top of the link.
  -- Multiple manufacturers can have portal access at the same time.
  portal_access boolean not null default false,
  link_token text unique,
  portal_password text,
  created_at timestamptz not null default now()
);

-- Idempotent: adds portal columns if the table was created by an earlier
-- version of this migration (create table if not exists won't alter it)
alter table manufacturers
  add column if not exists portal_access boolean not null default false;
alter table manufacturers
  add column if not exists link_token text unique;
alter table manufacturers
  add column if not exists portal_password text;

-- Tech pack versions (user-typed ids like TP-SKU-V1)
create table if not exists mfr_tech_packs (
  id text primary key,
  sku text,
  product text,
  version text,
  status text,
  link text,
  created_by text,
  created_date date,
  sent_to_manufacturer boolean not null default false,
  manufacturer_acknowledged boolean not null default false,
  manufacturer_questions text,
  revision_required boolean not null default false,
  final_approved boolean not null default false,
  approved_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Samples (user-typed ids like OFC-SKU-S1)
create table if not exists mfr_samples (
  id text primary key,
  sku text,
  product text not null,
  category text,
  version text,
  type text,
  request_date date,
  target_date date,
  manufacturer text not null,
  manufacturer_contact text,
  fabric text,
  gsm integer,
  composition text,
  color text,
  size text,
  fit text,
  tech_pack_id text,
  ref_link text,
  cost jsonb not null default '{}'::jsonb,
  courier_awb text,
  date_sent date,
  date_received date,
  status text,
  stage text,
  mfr_update text,
  feedback text,
  changes_required text,
  next_action text,
  action_owner text,
  waiting_on text,
  next_due date,
  approval_status text not null default 'Pending',
  approved_by text,
  approval_date date,
  final_decision text,
  notes text,
  qc jsonb not null default '[]'::jsonb,
  revisions jsonb not null default '[]'::jsonb,
  comms jsonb not null default '[]'::jsonb,
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mfr_samples_manufacturer on mfr_samples(manufacturer);
create index if not exists idx_mfr_samples_stage on mfr_samples(stage);
create index if not exists idx_mfr_samples_status on mfr_samples(status);

-- Production orders (user-typed ids like PO-SKU-B1)
create table if not exists mfr_production_orders (
  id text primary key,
  sample_id text,
  sku text,
  product text not null,
  category text,
  manufacturer text not null,
  manufacturer_contact text,
  po_date date,
  expected_delivery date,
  actual_delivery date,
  breakdown jsonb not null default '[]'::jsonb,
  unit_price numeric,
  advance_paid numeric,
  payment_status text,
  current_stage text,
  action_owner text,
  waiting_on text,
  next_action text,
  next_action_due date,
  shipping_method text,
  tracking_number text,
  notes text,
  qc jsonb not null default '[]'::jsonb,
  comms jsonb not null default '[]'::jsonb,
  files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_mfr_orders_manufacturer on mfr_production_orders(manufacturer);
create index if not exists idx_mfr_orders_stage on mfr_production_orders(current_stage);
