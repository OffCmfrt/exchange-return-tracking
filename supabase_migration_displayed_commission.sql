-- Migration: Add displayed_commission_rate column to influencers table
-- This allows admins to show a different commission rate to influencers than the actual rate
-- Run this in your Supabase SQL Editor

-- Add displayed_commission_rate column (what influencers see)
ALTER TABLE influencers
ADD COLUMN IF NOT EXISTS displayed_commission_rate NUMERIC DEFAULT 7.00;

-- Set existing influencers' displayed_commission_rate to match their current commission_rate
UPDATE influencers 
SET displayed_commission_rate = commission_rate 
WHERE displayed_commission_rate IS NULL;

-- Optional: Add a comment to explain the column
COMMENT ON COLUMN influencers.displayed_commission_rate IS 'The commission rate shown to influencers (may differ from actual commission_rate)';
