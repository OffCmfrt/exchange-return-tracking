-- Migration: Add 'out_for_delivery' status
-- The smart carrier sync now distinguishes the last-mile leg ("Out for Delivery"
-- / Delhivery "Dispatched") from generic in_transit. Without this value the
-- requests_status_check constraint rejects the update:
--   new row for relation "requests" violates check constraint "requests_status_check"

-- Drop the existing check constraint
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;

-- Re-add the constraint including 'out_for_delivery'
ALTER TABLE requests ADD CONSTRAINT requests_status_check
CHECK (status IN (
    'pending',
    'pickup_pending',
    'pickup_booked',
    'scheduled',
    'picked_up',
    'in_transit',
    'out_for_delivery',
    'delivered',
    'inspected',
    'approved',
    'rejected',
    'waiting_payment',
    'cancelled',
    'failed'
));

-- Optional timestamp column the sync writes when a shipment goes out for delivery.
-- Written defensively by the app (failure ignored), so this makes it persist.
ALTER TABLE requests ADD COLUMN IF NOT EXISTS out_for_delivery_at TIMESTAMPTZ;

-- Update the column comment to document the full status flow
COMMENT ON COLUMN requests.status IS '
Status Flow:
- pending: Initial request submitted
- pickup_pending: Pickup needs to be booked (manual intervention required)
- pickup_booked: Shipment successfully created with carrier (AWB assigned)
- scheduled: Pickup date scheduled
- picked_up: Package picked up by carrier
- in_transit: Package in transit
- out_for_delivery: Package out for delivery / last-mile (Delhivery "Dispatched")
- delivered: Package delivered to warehouse
- inspected: Package inspected at warehouse
- approved: Admin approved the request
- rejected: Admin rejected the request
- waiting_payment: Waiting for customer payment
- cancelled: Request cancelled by customer or admin
- failed: Order processing failed (carrier error, system error, etc.) - can be re-dispatched
';

-- Verify the constraint
SELECT conname, pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint
WHERE conrelid = 'requests'::regclass
AND contype = 'c';
