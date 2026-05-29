-- Migration: Influencer Analytics & Leaderboard
-- Adds tables for tracking product shipments, reels, and monthly payouts
-- Run this in your Supabase SQL Editor

-- ==================== PRODUCT SHIPMENTS ====================
-- Tracks products manually sent to influencers by admin
CREATE TABLE IF NOT EXISTS influencer_product_shipments (
    id BIGSERIAL PRIMARY KEY,
    influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
    product_title TEXT NOT NULL,
    product_image_url TEXT,
    shopify_product_id BIGINT,
    sent_at DATE NOT NULL,
    reel_due_date DATE NOT NULL,
    reel_status TEXT NOT NULL DEFAULT 'pending' CHECK (reel_status IN ('pending', 'received', 'overdue')),
    reel_url TEXT,
    reel_received_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for shipments
CREATE INDEX IF NOT EXISTS idx_shipments_influencer_date
    ON influencer_product_shipments (influencer_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipments_status_due
    ON influencer_product_shipments (reel_status, reel_due_date);

-- Auto-update updated_at on shipments
CREATE OR REPLACE FUNCTION update_shipments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_shipments_updated_at ON influencer_product_shipments;
CREATE TRIGGER trg_shipments_updated_at
    BEFORE UPDATE ON influencer_product_shipments
    FOR EACH ROW
    EXECUTE FUNCTION update_shipments_updated_at();

-- ==================== MONTHLY PAYOUTS ====================
-- One row per influencer per calendar month
CREATE TABLE IF NOT EXISTS influencer_payouts (
    id BIGSERIAL PRIMARY KEY,
    influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
    month TEXT NOT NULL, -- Format: YYYY-MM
    orders_count INTEGER NOT NULL DEFAULT 0,
    revenue_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    commission_rate NUMERIC(5, 2) NOT NULL,
    amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    paid_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (influencer_id, month)
);

-- Indexes for payouts
CREATE INDEX IF NOT EXISTS idx_payouts_influencer_month
    ON influencer_payouts (influencer_id, month DESC);

CREATE INDEX IF NOT EXISTS idx_payouts_status
    ON influencer_payouts (status);

-- Auto-update updated_at on payouts
CREATE OR REPLACE FUNCTION update_payouts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payouts_updated_at ON influencer_payouts;
CREATE TRIGGER trg_payouts_updated_at
    BEFORE UPDATE ON influencer_payouts
    FOR EACH ROW
    EXECUTE FUNCTION update_payouts_updated_at();

-- ==================== VERIFICATION ====================
-- Run these queries to verify tables were created:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'influencer_%';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'influencer_product_shipments';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'influencer_payouts';
