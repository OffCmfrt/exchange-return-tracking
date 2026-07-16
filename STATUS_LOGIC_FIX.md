# Status Logic Fix: pickup_booked vs pickup_pending

## Problem

The system was using `pickup_pending` for ALL carrier bookings, even when shipments were successfully created. This was confusing because:

- `pickup_pending` should mean "pending manual action"
- But it was being used for "shipment successfully booked"

## Solution

Introduced a new status: **`pickup_booked`**

### Status Definitions

| Status | Meaning | When Used |
|--------|---------|-----------|
| **pickup_booked** | ✅ Shipment successfully created with carrier | - Delhivery/Shiprocket returns waybill<br>- Duplicate order recovered with waybill<br>- Background auto-pickup succeeds |
| **pickup_pending** | ⚠️ Shipment NOT created, needs manual action | - Both carriers failed<br>- Sync detects AWB but not booked<br>- Manual intervention required |

## Changes Made

### 1. Database Migration

**File**: `supabase_migration_add_pickup_booked_status.sql`

```sql
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check 
CHECK (status IN (
    'pending',
    'pickup_pending',
    'pickup_booked',  -- NEW!
    'scheduled',
    ...
));
```

**Action Required**: Run this migration in Supabase SQL editor

### 2. Code Changes (server.js)

**Location 1 - Line 2685**: Background auto-pickup
```javascript
// BEFORE
updates.status = 'pickup_pending';

// AFTER
updates.status = 'pickup_booked';
```

**Location 2 - Line 4060**: Admin approve endpoint
```javascript
// BEFORE
updates.status = 'pickup_pending';

// AFTER  
updates.status = 'pickup_booked';
```

**Location 3 - Line 4064**: Response message
```javascript
// BEFORE
`Pickup initiated via ${carrierUsed} and status updated to pickup_pending`

// AFTER
`Pickup initiated via ${carrierUsed} and status updated to pickup_booked`
```

**Location 4 - Line 4656**: Manual pickup booking
```javascript
// BEFORE
status: 'pickup_pending',

// AFTER
status: 'pickup_booked',
```

### 3. Recovery Scripts Updated

- `batch-recover-delhivery-orders.js` - Uses `pickup_booked`
- `manual-fix-req76588.js` - Uses `pickup_booked`

## Status Flow Diagram

```
Customer submits request
         ↓
     [pending]
         ↓
   Admin approves
         ↓
   Try to book pickup
         ↓
    ┌────┴────┐
    ↓         ↓
SUCCESS   FAILURE
    ↓         ↓
[pickup_  [pickup_
 booked]  pending]
    ↓         ↓
 Carrier   Manual
schedules  intervention
pickup     required
    ↓
[scheduled]
    ↓
[picked_up]
    ↓
[in_transit]
    ↓
[delivered]
```

## Migration Steps

### Step 1: Run Database Migration

1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `supabase_migration_add_pickup_booked_status.sql`
3. Execute the migration

### Step 2: Deploy Code Changes

The following files have been updated:
- `server.js` (4 locations)
- `batch-recover-delhivery-orders.js`
- `manual-fix-req76588.js`

Restart your server to apply changes.

### Step 3: Update Existing Records (Optional)

If you want to update existing `pickup_pending` records that actually have AWBs:

```sql
-- Update pickup_pending records that have AWB numbers to pickup_booked
UPDATE requests 
SET status = 'pickup_booked'
WHERE status = 'pickup_pending'
  AND awb_number IS NOT NULL;
```

## Monitoring

### Log Messages

**Successful Booking**:
```
[REQ-XXXXX] ✅ Delhivery success: AWB 54716210000711
Pickup initiated via delhivery and status updated to pickup_booked
```

**Failed Booking (needs manual action)**:
```
[REQ-XXXXX] ❌ Both carriers failed
Status remains: pending (for manual admin intervention)
```

**Duplicate Order Recovery**:
```
⚠️ Delhivery duplicate order detected for REQ-XXXXX. Using existing waybill: 54716210000711
Status set to: pickup_booked
```

## Benefits

1. ✅ **Clear Status Meaning**: `pickup_booked` = success, `pickup_pending` = needs action
2. ✅ **Better Admin UX**: Admins can see which orders need attention
3. ✅ **Accurate Reporting**: Can track booking success vs failure rates
4. ✅ **Shiprocket Parity**: Matches Shiprocket's manual booking workflow

## Rollback

If you need to rollback:

```sql
-- Remove pickup_booked from constraint
ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;

-- Add old constraint back
ALTER TABLE requests ADD CONSTRAINT requests_status_check 
CHECK (status IN (
    'pending',
    'pickup_pending',
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

-- Update any pickup_booked records back to pickup_pending
UPDATE requests 
SET status = 'pickup_pending'
WHERE status = 'pickup_booked';
```

Then revert the code changes in server.js.

## Files Modified

1. `server.js` - Status assignments (4 locations)
2. `supabase_migration_add_pickup_booked_status.sql` - Database migration (NEW)
3. `batch-recover-delhivery-orders.js` - Recovery script
4. `manual-fix-req76588.js` - Manual fix script
5. `fix-status-logic.js` - Status update script (helper)
6. `update-recovery-status.js` - Recovery status updater (helper)
7. `STATUS_LOGIC_FIX.md` - This documentation (NEW)
