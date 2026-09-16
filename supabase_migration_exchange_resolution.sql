-- Migration: Exchange Resolution Options & Return-to-Exchange Conversion
-- Adds support for:
--   1. Resolution choices at exchange approval: exchange / refund / store_credit
--   2. Converting a return request into an exchange
--   3. Full request history preservation

-- ── Resolution column ──
-- Records which resolution the admin selected when approving:
--   'exchange'     → forward shipment dispatched (default for native exchanges)
--   'refund'       → Shopify refund issued to customer
--   'store_credit' → Shopify discount code issued as store credit
ALTER TABLE requests ADD COLUMN IF NOT EXISTS resolution VARCHAR(20);

-- ── Original type column ──
-- When a return is converted to an exchange, this stores 'return'.
-- Null for requests that were always exchanges.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS original_type VARCHAR(20);

-- ── Request history column ──
-- JSONB array of history entries. Each entry:
--   { action, from_type, to_type, resolution, notes, timestamp, by }
-- Preserves the full audit trail of conversions and resolution decisions.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_history JSONB DEFAULT '[]'::jsonb;

-- Verify columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'requests'
  AND column_name IN ('resolution', 'original_type', 'request_history')
ORDER BY column_name;
