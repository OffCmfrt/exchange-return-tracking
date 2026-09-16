-- Migration: Agent-initiated payment links for return/exchange requests
-- Allows support agents to generate Razorpay payment links directly from the dashboard.
-- Once the customer pays, the request is auto-approved.

ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS agent_payment_link        TEXT,
    ADD COLUMN IF NOT EXISTS agent_payment_link_id     TEXT,
    ADD COLUMN IF NOT EXISTS agent_payment_amount      NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS agent_payment_status      TEXT DEFAULT NULL,        -- pending | paid | expired | cancelled
    ADD COLUMN IF NOT EXISTS agent_payment_paid_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS agent_payment_initiated_by TEXT,                    -- agent/operator username
    ADD COLUMN IF NOT EXISTS agent_payment_initiated_at TIMESTAMPTZ;
