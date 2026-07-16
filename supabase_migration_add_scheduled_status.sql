-- Add 'scheduled' status to the requests table check constraint
-- This allows the system to distinguish between:
-- - 'pickup_pending': Pickup is being arranged but not yet confirmed
-- - 'scheduled': Pickup has been successfully booked with carrier

-- Drop the existing check constraint
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;

-- Add new check constraint with 'scheduled' status included
ALTER TABLE requests 
ADD CONSTRAINT requests_status_check 
CHECK (status IN (
    'pending',
    'pickup_pending',
    'scheduled',
    'approved',
    'rejected',
    'delivered',
    'waiting_payment',
    'picked_up',
    'in_transit',
    'inspected'
));

-- Verify the constraint
SELECT conname, pg_get_constraintdef(oid) as constraint_definition
FROM pg_constraint 
WHERE conrelid = 'requests'::regclass 
AND contype = 'c';
