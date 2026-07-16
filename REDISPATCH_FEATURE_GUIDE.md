# Admin Re-dispatch Feature Guide

## Overview
This feature gives administrators the power to re-initiate or re-dispatch orders that have been cancelled or failed. This ensures that no order is permanently lost due to temporary issues.

## New Features

### 1. Re-dispatch Cancelled Orders
Admins can now re-dispatch orders that were previously cancelled by customers or admins.

**How to use:**
1. Open a request with `cancelled` status in the admin dashboard
2. You'll see a **Carrier Override** dropdown to select your preferred carrier
3. Click **"Re-dispatch Cancelled Order"** (orange button)
4. The order will be reset to `pending` status
5. You can now approve it again with a fresh carrier booking

### 2. Re-dispatch Failed Orders
Admins can re-dispatch orders that encountered critical errors during processing.

**How to use:**
1. Open a request with `failed` status in the admin dashboard
2. You'll see a **Carrier Override** dropdown to select your preferred carrier
3. Click **"Re-dispatch Failed Order"** (orange button)
4. The order will be reset to `pending` status
5. You can now approve it again with a fresh carrier booking

## Status Definitions

### Cancelled Status
- **Meaning**: Order was cancelled by customer or admin
- **Color**: Gray badge
- **Action Available**: Re-dispatch to pending

### Failed Status
- **Meaning**: Order processing failed due to carrier error, system error, or other critical issues
- **Color**: Orange badge
- **Action Available**: Re-dispatch to pending

## UI Changes

### Admin Dashboard Modal

**For `cancelled` status:**
- Shows: "Re-dispatch Cancelled Order" button (orange)
- Shows: Carrier Override dropdown
- Shows: Warning message explaining the re-dispatch process
- Behavior: Resets order to pending status with cleared carrier info

**For `failed` status:**
- Shows: "Re-dispatch Failed Order" button (orange)
- Shows: Carrier Override dropdown
- Shows: Warning message explaining the re-dispatch process
- Behavior: Resets order to pending status with cleared carrier info

### Status Filter Dropdown
Two new filter options have been added:
- **Cancelled**: Filter to see all cancelled orders
- **Failed**: Filter to see all failed orders

### Status Badges
- **Cancelled**: Gray badge with text "Cancelled"
- **Failed**: Orange badge with text "Failed — Requires Re-dispatch"

## Server Changes

### New Endpoint: `/api/admin/redispatch`

**Method**: POST

**Authentication**: Admin token required

**Request Body**:
```json
{
  "requestId": "REQ-12345",
  "carrierOverride": "delhivery" // optional: "shiprocket" or "delhivery"
}
```

**Response**:
```json
{
  "success": true,
  "message": "Order reset to pending for re-dispatch. You can now approve it again.",
  "request": { /* updated request object */ }
}
```

**What it does**:
1. Validates that the order is in `cancelled` or `failed` status
2. Clears all previous carrier information:
   - carrier
   - carrierAwb
   - carrierShipmentId
   - awbNumber
   - shipmentId
   - pickupDate
   - forwardAwbNumber
   - forwardShipmentId
3. Resets status to `pending`
4. Adds admin note documenting the re-dispatch action

**Error Responses**:
- `404`: Request not found
- `400`: Can only re-dispatch cancelled or failed orders (includes current status)
- `500`: Internal server error

## Database Migration

### Migration File: `supabase_migration_add_failed_status.sql`

This migration adds the `failed` status to the database constraint.

**To apply**:
1. Go to Supabase Dashboard → SQL Editor
2. Copy contents of `supabase_migration_add_failed_status.sql`
3. Execute the migration

**New Status Constraint**:
```sql
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
))
```

## Workflow Examples

### Example 1: Re-dispatching a Cancelled Order

1. Customer cancels their exchange request → Status: `cancelled`
2. Admin reviews and decides to re-dispatch
3. Admin opens the order details
4. Admin selects carrier from dropdown (e.g., Delhivery)
5. Admin clicks "Re-dispatch Cancelled Order"
6. Order status changes to `pending`
7. Admin clicks "Approve & Initiate Pickup"
8. Fresh pickup booking is created with selected carrier

### Example 2: Recovering a Failed Order

1. Order fails during carrier booking due to API error → Status: `failed`
2. Admin sees the failed order in the dashboard
3. Admin opens the order details
4. Admin selects a different carrier (e.g., switch from Shiprocket to Delhivery)
5. Admin clicks "Re-dispatch Failed Order"
6. Order status changes to `pending`
7. Admin clicks "Approve & Initiate Pickup"
8. Order is processed with the new carrier

## Important Notes

### ⚠️ Warnings
1. **Previous carrier bookings remain**: The previous carrier booking will remain in the carrier's system. Make sure to cancel it manually if needed.
2. **All carrier info is cleared**: When re-dispatching, all AWB numbers, shipment IDs, and carrier info are cleared to ensure a fresh booking.
3. **Admin notes are preserved**: The re-dispatch action is logged in the admin notes for audit trail.

### ✅ Best Practices
1. **Check carrier balance**: Before re-dispatching, ensure the selected carrier has sufficient balance.
2. **Use carrier override**: If an order failed with one carrier, try the other carrier for re-dispatch.
3. **Document the reason**: Add notes explaining why the order was cancelled or failed for future reference.
4. **Monitor after re-dispatch**: Keep an eye on the re-dispatched order to ensure it processes successfully.

## Files Modified

### Backend
1. `server.js` - Added `/api/admin/redispatch` endpoint
2. `supabase_migration_add_failed_status.sql` - Database migration (NEW)

### Frontend
1. `public/admin/index.html` - Added re-dispatch button and logic
2. `public/admin/custom-pages.css` - Added badge styling for cancelled and failed

## Troubleshooting

### Issue: "Can only re-dispatch cancelled or failed orders"
**Solution**: The order is not in a re-dispatchable state. Check the current status in the database.

### Issue: Re-dispatched order fails again
**Possible Causes**:
- Insufficient carrier balance
- Invalid address or pincode
- Carrier API downtime

**Solution**: 
1. Try with a different carrier
2. Check carrier account status
3. Verify customer address details
4. Check server logs for specific error messages

### Issue: Cannot find cancelled/failed orders in filter
**Solution**: 
1. Ensure you've applied the latest database migration
2. Refresh the admin dashboard
3. Check the status filter dropdown for the new options

## Future Enhancements

Potential improvements for the future:
1. **Bulk re-dispatch**: Allow admins to select multiple cancelled/failed orders and re-dispatch them at once
2. **Automatic retry**: Implement automatic retry logic for failed orders with exponential backoff
3. **Re-dispatch history**: Track how many times an order has been re-dispatched
4. **Smart carrier selection**: Automatically suggest the best carrier based on previous failures
