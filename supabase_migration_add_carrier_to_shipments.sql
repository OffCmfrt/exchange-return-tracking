-- Add carrier and delhivery_shipment_id columns to influencer_product_shipments table
ALTER TABLE influencer_product_shipments ADD COLUMN IF NOT EXISTS carrier TEXT;
ALTER TABLE influencer_product_shipments ADD COLUMN IF NOT EXISTS delhivery_shipment_id TEXT;

-- Add comment to explain the columns
COMMENT ON COLUMN influencer_product_shipments.carrier IS 'Shipping carrier used: delhivery or shiprocket';
COMMENT ON COLUMN influencer_product_shipments.delhivery_shipment_id IS 'Shipment ID from Delhivery API';
