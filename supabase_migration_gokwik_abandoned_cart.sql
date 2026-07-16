-- ============================================================================
-- Marketing Dashboard: Gokwik Abandoned Cart Integration
-- Add Gokwik-specific columns to support abandoned cart tracking from Gokwik checkout
-- ============================================================================

-- Add Gokwik-specific columns to marketing_abandoned_carts table
ALTER TABLE marketing_abandoned_carts 
ADD COLUMN IF NOT EXISTS gokwik_checkout_id TEXT,
ADD COLUMN IF NOT EXISTS checkout_version TEXT,
ADD COLUMN IF NOT EXISTS gokwik_customer_phone_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS payment_method TEXT,
ADD COLUMN IF NOT EXISTS checkout_source TEXT DEFAULT 'shopify';
-- checkout_source: 'shopify' or 'gokwik' (to distinguish from existing 'source' field)

-- Add comment for documentation
COMMENT ON COLUMN marketing_abandoned_carts.gokwik_checkout_id IS 'Unique checkout identifier from Gokwik';
COMMENT ON COLUMN marketing_abandoned_carts.checkout_version IS 'Gokwik checkout version: v1 (modal) or v2 (Shopify native)';
COMMENT ON COLUMN marketing_abandoned_carts.gokwik_customer_phone_verified IS 'Whether customer phone was verified by Gokwik';
COMMENT ON COLUMN marketing_abandoned_carts.payment_method IS 'Payment method attempted during checkout';
COMMENT ON COLUMN marketing_abandoned_carts.checkout_source IS 'Source of abandoned cart: shopify or gokwik';

-- Create indexes for Gokwik-specific queries
CREATE INDEX IF NOT EXISTS idx_mac_gokwik_checkout_id ON marketing_abandoned_carts(gokwik_checkout_id);
CREATE INDEX IF NOT EXISTS idx_mac_checkout_source ON marketing_abandoned_carts(checkout_source);
CREATE INDEX IF NOT EXISTS idx_mac_checkout_version ON marketing_abandoned_carts(checkout_version);

-- Update existing records to set checkout_source to 'shopify' for backward compatibility
UPDATE marketing_abandoned_carts 
SET checkout_source = 'shopify' 
WHERE checkout_source IS NULL;

-- Add unique constraint on gokwik_checkout_id to prevent duplicates
-- Note: Using NULLS NOT DISTINCT to allow multiple NULL values (for non-Gokwik carts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_mac_gokwik_checkout_id_unique 
ON marketing_abandoned_carts(gokwik_checkout_id) 
WHERE gokwik_checkout_id IS NOT NULL;
