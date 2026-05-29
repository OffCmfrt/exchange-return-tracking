-- Migration: Add discount code tracking columns to requests table
-- Purpose: Track discount codes issued for return compensation
-- Date: 2026-05-21

-- Add discount code tracking columns to requests table
ALTER TABLE requests 
ADD COLUMN IF NOT EXISTS discount_code TEXT,
ADD COLUMN IF NOT EXISTS discount_value NUMERIC,
ADD COLUMN IF NOT EXISTS discount_type TEXT CHECK (discount_type IN ('percentage', 'fixed')),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_requests_discount_code ON requests(discount_code);

-- Add helpful comments
COMMENT ON COLUMN requests.discount_code IS 'Shopify discount code issued for return compensation';
COMMENT ON COLUMN requests.discount_value IS 'Discount value (percentage or fixed amount)';
COMMENT ON COLUMN requests.discount_type IS 'Type of discount: percentage or fixed';
COMMENT ON COLUMN requests.approved_at IS 'Timestamp when return was approved';

-- Verify the changes
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'requests' 
  AND column_name IN ('discount_code', 'discount_value', 'discount_type', 'approved_at')
ORDER BY ordinal_position;
