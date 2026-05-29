-- =====================================================
-- SUPABASE MIGRATION: Influencer Reel Targets & Shipments Enhancement
-- Created: 2026-05-29
-- Purpose: Monthly reel quota management and enhanced shipment tracking
-- =====================================================

-- =====================================================
-- TABLE 1: influencer_reel_targets
-- Purpose: Track monthly reel assignment quotas per influencer
-- =====================================================

CREATE TABLE IF NOT EXISTS influencer_reel_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id BIGINT NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
    month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
    year INTEGER NOT NULL CHECK (year >= 2024),
    target_count INTEGER NOT NULL DEFAULT 3 CHECK (target_count > 0),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Prevent duplicate targets for same influencer/month/year
    UNIQUE(influencer_id, month, year)
);

-- Performance indexes for reel targets
CREATE INDEX IF NOT EXISTS idx_reel_targets_influencer ON influencer_reel_targets(influencer_id);
CREATE INDEX IF NOT EXISTS idx_reel_targets_month_year ON influencer_reel_targets(month, year);
CREATE INDEX IF NOT EXISTS idx_reel_targets_created ON influencer_reel_targets(created_at DESC);

-- =====================================================
-- TABLE 2: influencer_product_requests
-- Purpose: Manage influencer product request lifecycle from submission to delivery
-- =====================================================

CREATE TABLE IF NOT EXISTS influencer_product_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    influencer_id BIGINT NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
    
    -- Product Information
    product_title TEXT NOT NULL,
    product_image_url TEXT,
    shopify_product_id TEXT,
    shopify_variant_id TEXT,
    
    -- Request Details
    reason TEXT NOT NULL CHECK (char_length(reason) >= 10),
    
    -- Shipping Information (collected at request time)
    shipping_full_name TEXT NOT NULL,
    shipping_address_line1 TEXT NOT NULL,
    shipping_address_line2 TEXT,
    shipping_city TEXT NOT NULL,
    shipping_state TEXT NOT NULL,
    shipping_pincode TEXT NOT NULL CHECK (char_length(shipping_pincode) = 6),
    shipping_phone TEXT NOT NULL CHECK (char_length(shipping_phone) = 10),
    
    -- Status & Tracking
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'shipped', 'delivered')),
    delhivery_awb TEXT,
    delhivery_shipment_id TEXT,
    delhivery_tracking_url TEXT GENERATED ALWAYS AS (
        CASE WHEN delhivery_awb IS NOT NULL 
        THEN 'https://www.delhivery.com/track?wb=' || delhivery_awb 
        ELSE NULL END
    ) STORED,
    
    -- Admin Fields
    admin_notes TEXT,
    rejection_reason TEXT,
    
    -- Timestamps
    approved_at TIMESTAMP WITH TIME ZONE,
    rejected_at TIMESTAMP WITH TIME ZONE,
    shipped_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Performance indexes for product requests
CREATE INDEX IF NOT EXISTS idx_product_requests_influencer ON influencer_product_requests(influencer_id);
CREATE INDEX IF NOT EXISTS idx_product_requests_status ON influencer_product_requests(status);
CREATE INDEX IF NOT EXISTS idx_product_requests_created ON influencer_product_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_requests_delhivery_awb ON influencer_product_requests(delhivery_awb) WHERE delhivery_awb IS NOT NULL;

-- =====================================================
-- ENHANCEMENT: influencer_product_shipments table
-- Purpose: Add monthly target linkage and Delhivery tracking
-- =====================================================

-- Add new columns to existing shipments table
ALTER TABLE influencer_product_shipments
ADD COLUMN IF NOT EXISTS reel_target_id UUID REFERENCES influencer_reel_targets(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS is_monthly_target BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS admin_notes TEXT,
ADD COLUMN IF NOT EXISTS tracking_awb TEXT,
ADD COLUMN IF NOT EXISTS tracking_status TEXT CHECK (tracking_status IN ('pending', 'shipped', 'delivered', 'returned')),
ADD COLUMN IF NOT EXISTS tracking_url TEXT GENERATED ALWAYS AS (
    CASE WHEN tracking_awb IS NOT NULL 
    THEN 'https://www.delhivery.com/track?wb=' || tracking_awb 
    ELSE NULL END
) STORED,
ADD COLUMN IF NOT EXISTS delhivery_shipment_id TEXT,
ADD COLUMN IF NOT EXISTS shipping_carrier TEXT DEFAULT 'delhivery',
ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP WITH TIME ZONE;

-- Performance indexes for enhanced shipments
CREATE INDEX IF NOT EXISTS idx_shipments_reel_target ON influencer_product_shipments(reel_target_id) WHERE reel_target_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_monthly_target ON influencer_product_shipments(is_monthly_target) WHERE is_monthly_target = true;
CREATE INDEX IF NOT EXISTS idx_shipments_tracking_awb ON influencer_product_shipments(tracking_awb) WHERE tracking_awb IS NOT NULL;

-- =====================================================
-- TRIGGERS: Auto-update updated_at timestamp
-- =====================================================

-- Function to update timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to reel_targets
DROP TRIGGER IF EXISTS update_reel_targets_updated_at ON influencer_reel_targets;
CREATE TRIGGER update_reel_targets_updated_at
    BEFORE UPDATE ON influencer_reel_targets
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to product_requests
DROP TRIGGER IF EXISTS update_product_requests_updated_at ON influencer_product_requests;
CREATE TRIGGER update_product_requests_updated_at
    BEFORE UPDATE ON influencer_product_requests
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- COMMENTS: Documentation for database schema
-- =====================================================

COMMENT ON TABLE influencer_reel_targets IS 'Monthly reel assignment quotas for influencers';
COMMENT ON TABLE influencer_product_requests IS 'Product request workflow from submission to delivery';
COMMENT ON COLUMN influencer_product_requests.reason IS 'Justification for product request (min 10 chars)';
COMMENT ON COLUMN influencer_product_requests.status IS 'Request lifecycle: pending → approved/rejected → shipped → delivered';
COMMENT ON COLUMN influencer_product_requests.delhivery_tracking_url IS 'Auto-generated tracking URL when AWB exists';
COMMENT ON COLUMN influencer_product_shipments.is_monthly_target IS 'Marks if shipment counts toward monthly reel quota';
COMMENT ON COLUMN influencer_product_shipments.reel_target_id IS 'Links to specific monthly target for progress tracking';

-- =====================================================
-- VERIFICATION: Test the migration
-- =====================================================

-- Verify tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('influencer_reel_targets', 'influencer_product_requests')
ORDER BY table_name;

-- Verify columns added to shipments
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'influencer_product_shipments' 
  AND column_name IN ('reel_target_id', 'is_monthly_target', 'tracking_awb', 'tracking_url')
ORDER BY column_name;

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
