-- ============================================================
-- Manufacture Studio: design submissions from the manufacturer
-- Run in the Supabase SQL editor (same project as the other
-- supabase_migration_*.sql files).
-- ============================================================

create table if not exists manufacture_designs (
  id uuid primary key default gen_random_uuid(),
  design_name text not null,
  style_code text,
  description text,
  quantity integer not null default 0,
  deadline timestamptz not null,
  status text not null default 'pending', -- pending/approved/in_production/completed/rejected
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_manufacture_designs_status on manufacture_designs(status);
create index if not exists idx_manufacture_designs_created on manufacture_designs(created_at desc);
