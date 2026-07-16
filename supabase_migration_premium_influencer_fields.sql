-- Premium Influencer Fields Migration
-- Run this migration in your Supabase SQL editor

-- 1. Add new columns to influencers table
ALTER TABLE influencers 
ADD COLUMN IF NOT EXISTS content_weekly_count INTEGER DEFAULT 3,
ADD COLUMN IF NOT EXISTS shipping_address TEXT,
ADD COLUMN IF NOT EXISTS shipping_city TEXT,
ADD COLUMN IF NOT EXISTS shipping_state TEXT,
ADD COLUMN IF NOT EXISTS shipping_pin TEXT,
ADD COLUMN IF NOT EXISTS shipping_landmark TEXT,
ADD COLUMN IF NOT EXISTS address_type TEXT CHECK (address_type IN ('home', 'office')),
ADD COLUMN IF NOT EXISTS height_cm DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS weight_kg DECIMAL(5,2),
ADD COLUMN IF NOT EXISTS selected_products JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS follower_tier TEXT DEFAULT 'Rising Star',
ADD COLUMN IF NOT EXISTS monthly_target INTEGER DEFAULT 12,
ADD COLUMN IF NOT EXISTS admin_notes TEXT,
ADD COLUMN IF NOT EXISTS tier_override INTEGER,
ADD COLUMN IF NOT EXISTS application_submitted_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- 2. Create tier_configuration table for admin-editable tiers
CREATE TABLE IF NOT EXISTS tier_configuration (
    id SERIAL PRIMARY KEY,
    tier_name TEXT NOT NULL UNIQUE,
    min_followers INTEGER DEFAULT 0,
    max_followers INTEGER,
    product_limit INTEGER NOT NULL,
    tier_color TEXT DEFAULT '#6366f1',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Insert default tier configurations
INSERT INTO tier_configuration (tier_name, min_followers, max_followers, product_limit, tier_color) VALUES
    ('Rising Star', 0, 49999, 2, '#3b82f6'),
    ('Growing Creator', 50000, 99999, 3, '#22c55e'),
    ('Established Influencer', 100000, 499999, 4, '#a855f7'),
    ('Top Tier Creator', 500000, NULL, 5, '#f59e0b')
ON CONFLICT (tier_name) DO NOTHING;

-- 4. Create influencer_performance table for tracking monthly targets
CREATE TABLE IF NOT EXISTS influencer_performance (
    id SERIAL PRIMARY KEY,
    influencer_id BIGINT REFERENCES influencers(id) ON DELETE CASCADE,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    target_content INTEGER DEFAULT 0,
    delivered_content INTEGER DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    total_revenue DECIMAL(10,2) DEFAULT 0,
    commission_earned DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(influencer_id, month, year)
);

-- 5. Create admin_notes table for influencer notes
CREATE TABLE IF NOT EXISTS admin_notes (
    id SERIAL PRIMARY KEY,
    influencer_id BIGINT REFERENCES influencers(id) ON DELETE CASCADE,
    admin_name TEXT NOT NULL,
    note_text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Create index for better performance
CREATE INDEX IF NOT EXISTS idx_influencers_follower_tier ON influencers(follower_tier);
CREATE INDEX IF NOT EXISTS idx_influencers_monthly_target ON influencers(monthly_target);
CREATE INDEX IF NOT EXISTS idx_influencer_performance_influencer ON influencer_performance(influencer_id);
CREATE INDEX IF NOT EXISTS idx_admin_notes_influencer ON admin_notes(influencer_id);

-- 7. Enable Row Level Security (optional but recommended)
ALTER TABLE influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE influencer_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notes ENABLE ROW LEVEL SECURITY;

-- 8. Create policies for admin access (adjust role as needed)
DROP POLICY IF EXISTS "Admin full access to influencers" ON influencers;
CREATE POLICY "Admin full access to influencers" ON influencers
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin full access to tier_configuration" ON tier_configuration;
CREATE POLICY "Admin full access to tier_configuration" ON tier_configuration
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin full access to influencer_performance" ON influencer_performance;
CREATE POLICY "Admin full access to influencer_performance" ON influencer_performance
    FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin full access to admin_notes" ON admin_notes;
CREATE POLICY "Admin full access to admin_notes" ON admin_notes
    FOR ALL USING (auth.role() = 'service_role');

-- Migration completed successfully