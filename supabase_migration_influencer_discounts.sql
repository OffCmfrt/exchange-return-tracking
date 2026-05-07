-- Migration: Add new columns to influencers table for Shopify discount code sync
-- Run this in your Supabase SQL Editor

-- Add discount_value column (what percentage off the customer gets)
ALTER TABLE influencers
ADD COLUMN IF NOT EXISTS discount_value NUMERIC DEFAULT 10.00;

-- Add usage_limit column (max number of uses, null = unlimited)
ALTER TABLE influencers
ADD COLUMN IF NOT EXISTS usage_limit INTEGER DEFAULT NULL;

-- Add shopify_price_rule_id column (to track the Shopify Price Rule)
ALTER TABLE influencers
ADD COLUMN IF NOT EXISTS shopify_price_rule_id TEXT;

-- Add shopify_discount_code_id column (to track the Shopify Discount Code)
ALTER TABLE influencers
ADD COLUMN IF NOT EXISTS shopify_discount_code_id TEXT;

-- Optional: Add index for faster lookups on shopify IDs
CREATE INDEX IF NOT EXISTS idx_influencers_shopify_price_rule_id ON influencers(shopify_price_rule_id);
CREATE INDEX IF NOT EXISTS idx_influencers_shopify_discount_code_id ON influencers(shopify_discount_code_id);
