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
-- NOTE: An older `influencer_payouts` table may already exist from
-- supabase_migration_influencer_applications.sql with columns
-- (period_start, period_end, amount). We extend it here with the new
-- analytics columns so both schemas can coexist.

CREATE TABLE IF NOT EXISTS influencer_payouts (
    id BIGSERIAL PRIMARY KEY,
    influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
    month TEXT, -- Format: YYYY-MM (nullable for legacy rows)
    orders_count INTEGER NOT NULL DEFAULT 0,
    revenue_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    commission_rate NUMERIC(5, 2),
    amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending',
    paid_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add new analytics columns to existing table (idempotent)
ALTER TABLE influencer_payouts ADD COLUMN IF NOT EXISTS month TEXT;
ALTER TABLE influencer_payouts ADD COLUMN IF NOT EXISTS orders_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE influencer_payouts ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE influencer_payouts ADD COLUMN IF NOT EXISTS commission_rate NUMERIC(5, 2);
ALTER TABLE influencer_payouts ADD COLUMN IF NOT EXISTS amount_due NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE influencer_payouts ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE influencer_payouts ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE influencer_payouts ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE influencer_payouts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Make legacy required columns optional so new analytics rows can be inserted
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'influencer_payouts' AND column_name = 'period_start'
    ) THEN
        EXECUTE 'ALTER TABLE influencer_payouts ALTER COLUMN period_start DROP NOT NULL';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'influencer_payouts' AND column_name = 'period_end'
    ) THEN
        EXECUTE 'ALTER TABLE influencer_payouts ALTER COLUMN period_end DROP NOT NULL';
    END IF;
END$$;

-- Drop old status CHECK constraint (had 'cancelled') and add new one with ('pending','paid')
DO $$
DECLARE
    cons_name TEXT;
BEGIN
    SELECT conname INTO cons_name
    FROM pg_constraint
    WHERE conrelid = 'influencer_payouts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%';
    IF cons_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE influencer_payouts DROP CONSTRAINT %I', cons_name);
    END IF;
END$$;

ALTER TABLE influencer_payouts
    ADD CONSTRAINT influencer_payouts_status_check
    CHECK (status IN ('pending', 'paid', 'cancelled'));

-- Unique constraint on (influencer_id, month) for upserts (only when month is set)
CREATE UNIQUE INDEX IF NOT EXISTS uq_payouts_influencer_month
    ON influencer_payouts (influencer_id, month)
    WHERE month IS NOT NULL;

-- Indexes for payouts
CREATE INDEX IF NOT EXISTS idx_payouts_influencer_month
    ON influencer_payouts (influencer_id, month DESC);

CREATE INDEX IF NOT EXISTS idx_payouts_status_v2
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
