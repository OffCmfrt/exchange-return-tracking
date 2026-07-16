-- Add missing shipping address columns to requests table
-- This migration adds separate columns for city, state, and pincode from the shipping address

ALTER TABLE requests
ADD COLUMN IF NOT EXISTS shipping_city TEXT,
ADD COLUMN IF NOT EXISTS shipping_state TEXT,
ADD COLUMN IF NOT EXISTS shipping_pincode TEXT;

-- Also ensure new_state column exists (it was missing in some earlier migrations)
ALTER TABLE requests
ADD COLUMN IF NOT EXISTS new_state TEXT;

-- Add indexes for better query performance on address fields
CREATE INDEX IF NOT EXISTS idx_requests_shipping_city ON requests(shipping_city);
CREATE INDEX IF NOT EXISTS idx_requests_shipping_state ON requests(shipping_state);
CREATE INDEX IF NOT EXISTS idx_requests_new_state ON requests(new_state);

COMMENT ON COLUMN requests.shipping_city IS 'City from original shipping address';
COMMENT ON COLUMN requests.shipping_state IS 'State from original shipping address';
COMMENT ON COLUMN requests.shipping_pincode IS 'Pincode from original shipping address';
COMMENT ON COLUMN requests.new_state IS 'State for new delivery address (exchange)';
