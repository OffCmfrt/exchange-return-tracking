-- Migration: Operator Accounts, Permissions & Activity Tracking
-- Created: 2026-08-08
-- Purpose: Multi-operator access for the admin portal. Super admin creates named
--          operator accounts (username + password), grants/bans per-function
--          permissions, and reviews a full activity log per operator.

-- ─────────────────────────────────────────────────────────────
-- 1. Operators table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operators (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(100),
  email VARCHAR(255),
  password_hash TEXT NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  banned_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_operators_username ON operators(lower(username));
CREATE INDEX IF NOT EXISTS idx_operators_active ON operators(is_active);

COMMENT ON TABLE operators IS 'Named operator accounts for the admin portal (created by super admin)';
COMMENT ON COLUMN operators.permissions IS 'Allowed permission keys: approve, reject, edit_requests, delete_requests, book_pickups, view_analytics, manage_settings, manage_influencers, manage_marketing';
COMMENT ON COLUMN operators.is_active IS 'FALSE = banned: login blocked and existing tokens rejected';

-- ─────────────────────────────────────────────────────────────
-- 2. Operator activity log (tamper-evident audit trail)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_activity_logs (
  id BIGSERIAL PRIMARY KEY,
  operator_id BIGINT, -- NULL for super admin
  username VARCHAR(60) NOT NULL, -- stored denormalized so history survives operator deletion
  action VARCHAR(80) NOT NULL, -- human-readable label, e.g. 'Approve Request', 'permission_denied', 'login_failed'
  method VARCHAR(10),
  path TEXT,
  target VARCHAR(80), -- e.g. request id being acted upon
  success BOOLEAN DEFAULT TRUE,
  ip VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_operator ON operator_activity_logs(operator_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON operator_activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON operator_activity_logs(action);

COMMENT ON TABLE operator_activity_logs IS 'Audit trail of admin/operator actions (logins, approvals, rejections, settings changes, permission denials)';
