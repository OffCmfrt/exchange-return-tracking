-- Sync Improvements Migration
-- Created: 2026-05-17
-- Purpose: Add sync tracking columns and create sync_logs table for monitoring
-- Impact: Enables retry logic, error tracking, and sync performance monitoring

-- ============================================================================
-- PART 1: Add sync tracking columns to requests table
-- ============================================================================

-- Track when a request was last synced
ALTER TABLE requests ADD COLUMN IF NOT EXISTS last_sync_attempt TIMESTAMP;

-- Track how many retry attempts were made (0 = success, >0 = failed attempts)
ALTER TABLE requests ADD COLUMN IF NOT EXISTS sync_retry_count INTEGER DEFAULT 0;

-- Store the last error message for debugging
ALTER TABLE requests ADD COLUMN IF NOT EXISTS last_sync_error TEXT;

-- Track which carrier was used for forward shipments (important for exchanges)
ALTER TABLE requests ADD COLUMN IF NOT EXISTS forward_carrier VARCHAR(50);

-- ============================================================================
-- PART 2: Create sync_logs table for historical tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_started_at TIMESTAMP NOT NULL,
    sync_completed_at TIMESTAMP,
    sync_type VARCHAR(50) NOT NULL, -- 'background' or 'manual'
    total_requests INTEGER DEFAULT 0,
    successful_updates INTEGER DEFAULT 0,
    failed_updates INTEGER DEFAULT 0,
    skipped_requests INTEGER DEFAULT 0,
    carrier_breakdown JSONB, -- { "shiprocket": {"success": 10, "failed": 2}, "delhivery": {...} }
    error_details JSONB, -- Array of { requestId, carrier, error } objects
    duration_seconds NUMERIC(10, 2),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Add comment for documentation
COMMENT ON TABLE sync_logs IS 'Historical log of sync job executions for monitoring and debugging';
COMMENT ON COLUMN sync_logs.sync_type IS 'Type of sync: "background" (scheduled) or "manual" (admin-triggered)';
COMMENT ON COLUMN sync_logs.carrier_breakdown IS 'JSON object with success/failed counts per carrier';
COMMENT ON COLUMN sync_logs.error_details IS 'JSON array of errors encountered during sync';

-- ============================================================================
-- PART 3: Create indexes for sync job optimization
-- ============================================================================

-- Index for finding requests that need syncing (active statuses)
CREATE INDEX IF NOT EXISTS idx_requests_sync_needed 
ON requests(status, last_sync_attempt) 
WHERE status IN ('pending', 'pickup_pending', 'scheduled', 'picked_up', 'in_transit');

-- Index for finding failed syncs (retry candidates)
CREATE INDEX IF NOT EXISTS idx_requests_sync_failed 
ON requests(sync_retry_count, last_sync_attempt) 
WHERE sync_retry_count > 0;

-- Index for sync_logs queries (recent syncs)
CREATE INDEX IF NOT EXISTS idx_sync_logs_created_at 
ON sync_logs(created_at DESC);

-- ============================================================================
-- PART 4: Verify migration
-- ============================================================================

-- Show new columns in requests table
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'requests' 
AND column_name IN ('last_sync_attempt', 'sync_retry_count', 'last_sync_error', 'forward_carrier')
ORDER BY column_name;

-- Show sync_logs table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'sync_logs'
ORDER BY ordinal_position;

-- Show new indexes
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename IN ('requests', 'sync_logs')
AND indexname LIKE 'idx_%sync%'
ORDER BY indexname;

-- ============================================================================
-- Migration complete!
-- ============================================================================
-- Next steps:
-- 1. Verify columns were added successfully (query above should show 4 rows)
-- 2. Verify sync_logs table was created (query above should show 10 rows)
-- 3. Verify indexes were created (query above should show 3 rows)
-- 4. Deploy updated server.js with new sync logic
-- 5. Monitor sync_logs table for successful sync executions
