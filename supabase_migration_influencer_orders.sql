-- Migration: Create influencer_orders table to store individual Shopify orders attributed to influencers
-- This replaces the need to re-scan ALL Shopify orders for every conversions/stats request
-- Run this in your Supabase SQL Editor

-- ==================== TABLE ====================
CREATE TABLE IF NOT EXISTS influencer_orders (
    shopify_order_id BIGINT PRIMARY KEY,
    influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
    referral_code TEXT NOT NULL,
    order_name TEXT,
    total_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'INR',
    financial_status TEXT,
    fulfillment_status TEXT,
    customer_name TEXT,
    cancelled_at TIMESTAMPTZ,
    order_created_at TIMESTAMPTZ NOT NULL,
    order_updated_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== INDEXES ====================
-- Primary query pattern: find orders for a specific influencer, sorted by date
CREATE INDEX IF NOT EXISTS idx_inf_orders_influencer_date
    ON influencer_orders (influencer_id, order_created_at DESC);

-- Quick lookup by referral code (for webhook ingestion)
CREATE INDEX IF NOT EXISTS idx_inf_orders_code
    ON influencer_orders (referral_code);

-- Date-range queries across all influencers
CREATE INDEX IF NOT EXISTS idx_inf_orders_date
    ON influencer_orders (order_created_at DESC);

-- ==================== SYNC METADATA ====================
-- Store the timestamp of the last successful Shopify sync (used for incremental fetch)
CREATE TABLE IF NOT EXISTS sync_metadata (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the last_shopify_order_sync key (null value = first run will do a full 180-day scan)
INSERT INTO sync_metadata (key, value)
VALUES ('last_shopify_order_sync', NULL)
ON CONFLICT (key) DO NOTHING;

-- ==================== OPTIONAL: Add helper columns on influencers ====================
-- Store a cached JSON snapshot of recent 20 conversions for zero-query admin rendering
ALTER TABLE influencers
ADD COLUMN IF NOT EXISTS recent_conversions_cache JSONB DEFAULT '[]'::jsonb;

ALTER TABLE influencers
ADD COLUMN IF NOT EXISTS recent_conversions_updated_at TIMESTAMPTZ;
