-- Migration: Add 'failed' status for orders that encountered critical errors
-- This allows admins to identify and re-dispatch orders that failed during processing

-- Drop the existing check constraint
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;

-- Add new check constraint with 'failed' status
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
    'cancelled',
    'failed'
));

-- Add a comment to explain the new status
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
- cancelled: Request cancelled by customer or admin
- failed: Order processing failed (carrier error, system error, etc.) - can be re-dispatched
';
