-- Performance optimization indexes
-- Created: 2026-05-08
-- Purpose: Improve query performance for admin dashboard and background sync job

-- Index for status filtering (used in sync job and admin queries)
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

-- Index for type filtering (returns vs exchanges)
CREATE INDEX IF NOT EXISTS idx_requests_type ON requests(type);

-- Index for recent requests (admin dashboard default sort)
CREATE INDEX IF NOT EXISTS idx_requests_created_at_desc ON requests(created_at DESC);

-- Index for order number lookups (customer tracking)
CREATE INDEX IF NOT EXISTS idx_requests_order_number ON requests(order_number);

-- Index for AWB tracking (sync job optimization)
CREATE INDEX IF NOT EXISTS idx_requests_awb_number ON requests(awb_number) WHERE awb_number IS NOT NULL;

-- Index for shipment ID tracking
CREATE INDEX IF NOT EXISTS idx_requests_shipment_id ON requests(shipment_id) WHERE shipment_id IS NOT NULL;

-- Composite index for active request queries (sync job)
-- This is the most important index for the background sync performance
CREATE INDEX IF NOT EXISTS idx_requests_active_sync ON requests(status, awb_number) 
WHERE status IN ('pending', 'scheduled', 'picked_up', 'in_transit') AND awb_number IS NOT NULL;

-- Verify indexes were created
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'requests' 
AND indexname LIKE 'idx_requests%'
ORDER BY indexname;
