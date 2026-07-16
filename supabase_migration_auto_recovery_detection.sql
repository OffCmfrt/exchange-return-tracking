-- ============================================================================
-- Marketing Dashboard: Auto Recovery Detection
-- Add columns to track when/how abandoned carts were auto-detected as recovered
-- ============================================================================

-- Add recovery detection tracking columns
ALTER TABLE marketing_abandoned_carts
ADD COLUMN IF NOT EXISTS recovery_detected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS recovery_detection_method TEXT,
ADD COLUMN IF NOT EXISTS time_to_recovery_hours DECIMAL(10,2);

-- recovery_detection_method: 'shopify_webhook', 'cron_scan', 'manual'
-- time_to_recovery_hours: computed hours between created_at and recovered_at

-- Add index for faster recovery queries
CREATE INDEX IF NOT EXISTS idx_mac_recovered ON marketing_abandoned_carts(recovery_status, recovered_at DESC) WHERE recovery_status = 'recovered';
CREATE INDEX IF NOT EXISTS idx_mac_recovery_channel ON marketing_abandoned_carts(recovery_channel) WHERE recovery_status = 'recovered';

-- Add index for cron recovery scan (find non-recovered carts by email/phone)
CREATE INDEX IF NOT EXISTS idx_mac_active_email ON marketing_abandoned_carts(customer_email) WHERE recovery_status NOT IN ('recovered', 'expired');
CREATE INDEX IF NOT EXISTS idx_mac_active_phone ON marketing_abandoned_carts(customer_phone) WHERE recovery_status NOT IN ('recovered', 'expired');

-- Backfill time_to_recovery_hours for existing recovered carts
UPDATE marketing_abandoned_carts
SET time_to_recovery_hours = EXTRACT(EPOCH FROM (recovered_at - created_at)) / 3600,
    recovery_detection_method = COALESCE(recovery_detection_method, 'manual')
WHERE recovery_status = 'recovered'
  AND recovered_at IS NOT NULL
  AND time_to_recovery_hours IS NULL;
