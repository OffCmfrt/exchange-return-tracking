-- Add carrier tracking columns to requests table
ALTER TABLE requests ADD COLUMN IF NOT EXISTS carrier TEXT DEFAULT 'shiprocket';
ALTER TABLE requests ADD COLUMN IF NOT EXISTS carrier_shipment_id TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS carrier_awb TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS carrier_fallback_reason TEXT;

-- Add index for carrier queries
CREATE INDEX IF NOT EXISTS idx_requests_carrier ON requests(carrier);

-- Add comment to explain the columns
COMMENT ON COLUMN requests.carrier IS 'Shipping carrier used: shiprocket or delhivery';
COMMENT ON COLUMN requests.carrier_shipment_id IS 'Shipment ID from the carrier API';
COMMENT ON COLUMN requests.carrier_awb IS 'AWB/tracking number from the carrier';
COMMENT ON COLUMN requests.carrier_fallback_reason IS 'Reason for falling back to alternative carrier';
