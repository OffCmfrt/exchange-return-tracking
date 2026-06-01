-- Migration: Make reel_due_date Optional in influencer_product_shipments
-- This allows inventory-based shipments without requiring a reel due date
-- Run this in your Supabase SQL Editor

-- Drop the NOT NULL constraint on reel_due_date
ALTER TABLE influencer_product_shipments 
ALTER COLUMN reel_due_date DROP NOT NULL;

-- Add a comment explaining the change
COMMENT ON COLUMN influencer_product_shipments.reel_due_date IS 'Due date for reel submission. Can be NULL for inventory-based shipments that do not require reels.';

-- Verify the change (optional - you can remove this after running)
-- SELECT column_name, is_nullable 
-- FROM information_schema.columns 
-- WHERE table_name = 'influencer_product_shipments' 
-- AND column_name = 'reel_due_date';
