-- Add EDD (Expected Delivery Date) columns to requests table
-- These persist carrier-reported EDD so it's visible even when carrier API is temporarily unavailable

-- Return shipment EDD
ALTER TABLE requests ADD COLUMN IF NOT EXISTS expected_delivery_date TIMESTAMPTZ;

-- Forward/replacement shipment EDD (exchanges only)
ALTER TABLE requests ADD COLUMN IF NOT EXISTS forward_expected_delivery_date TIMESTAMPTZ;

-- Carrier name for display (persisted from sync)
ALTER TABLE requests ADD COLUMN IF NOT EXISTS carrier_name TEXT;

-- Forward carrier name for display
ALTER TABLE requests ADD COLUMN IF NOT EXISTS forward_carrier_name TEXT;

-- Last sync timestamp (when tracking was last refreshed)
ALTER TABLE requests ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ DEFAULT NOW();
