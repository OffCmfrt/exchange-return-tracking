-- Migration: Add pickup_booked status
-- This status is used when a shipment is successfully created with the carrier
-- pickup_pending is reserved for when shipment creation fails and needs manual intervention

-- Drop the existing check constraint
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;

-- Add new check constraint with pickup_booked status
ALTER TABLE requests ADD CONSTRAINT requests_status_check 
CHECK (status IN (
    'pending',
    'pickup_pending',
    'pickup_booked',
    'scheduled',
    'picked_up',
    'in_transit',
    'delivered',
    'inspected',
    'approved',
    'rejected',
    'waiting_payment',
    'cancelled'
));

-- Add a comment to explain the status flow
COMMENT ON COLUMN requests.status IS '
Status Flow:
- pending: Initial request submitted
- pickup_pending: Pickup needs to be booked (manual intervention required)
- pickup_booked: Shipment successfully created with carrier (AWB assigned)
- scheduled: Pickup date scheduled
- picked_up: Package picked up by carrier
- in_transit: Package in transit
- delivered: Package delivered to warehouse
- inspected: Package inspected at warehouse
- approved: Admin approved the request
- rejected: Admin rejected the request
- waiting_payment: Waiting for customer payment
- cancelled: Request cancelled
';
