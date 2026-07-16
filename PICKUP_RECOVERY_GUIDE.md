# Pickup Recovery and Carrier Override Guide

## Overview
This guide explains how to use the new features to:
1. Re-initiate pickups with different carriers
2. Fix the 40-50 failed bulk approvals from the server crash

## New Features

### 1. Re-initiate Pickup with Different Carrier
Admins can now re-initiate pickup for requests that are already in `pickup_pending` status with a different carrier.

**How to use:**
1. Open a request with `pickup_pending` status in the admin dashboard
2. You'll see a **Carrier Override** dropdown (same as for pending requests)
3. Select the carrier you want to use (Shiprocket or Delhivery)
4. Click **"Re-initiate Pickup with Selected Carrier"** (orange button)
5. A new pickup booking will be created with the selected carrier

**Warning:** The previous carrier booking will remain in the carrier's system. Make sure to cancel it manually if needed.

### 2. Reset Pickup to Pending
If a pickup booking failed or needs to be completely redone, you can reset it to `pending` status.

**How to use:**
1. Open a request with `pickup_pending` or `scheduled` status
2. Click the **"Reset to Pending"** button (red button)
3. Confirm the action
4. The request will be reset to `pending` status with all carrier info cleared
5. You can now re-initiate pickup normally

---

## Fixing the 40-50 Failed Bulk Approvals

### Step 1: Run Diagnostic Script

First, identify which requests failed:

```bash
node find-failed-pickups.js
```

**What this does:**
- Finds all requests with `pickup_pending` or `scheduled` status
- Categorizes them by carrier (Delhivery, Shiprocket, or missing)
- Shows requests with missing AWB or Shipment IDs
- Lists all Delhivery requests that need verification

**Output:**
- Summary of all problematic requests
- List of request IDs that need recovery
- Instructions on next steps

### Step 2: Verify Delhivery Bookings (Optional)

For requests showing Delhivery as carrier:
1. Log into your Delhivery dashboard
2. Search for the AWB numbers shown in the diagnostic output
3. Mark which AWBs actually exist in Delhivery
4. Note the AWBs that don't exist (these are the failed ones)

### Step 3: Prepare Recovery List

From the diagnostic output, copy the failed request IDs. They'll look like:
```json
[
  "req_abc123",
  "req_def456",
  "req_ghi789"
]
```

### Step 4: Run Recovery Script

1. Open `recover-failed-pickups.js`
2. Replace the `FAILED_REQUEST_IDS` array with your actual failed IDs:

```javascript
const FAILED_REQUEST_IDS = [
  'req_abc123',
  'req_def456',
  'req_ghi789',
  // ... add all failed request IDs
];
```

3. Run the recovery script:

```bash
node recover-failed-pickups.js
```

**What this does:**
- Resets each failed request from `pickup_pending` to `pending`
- Clears all carrier-related fields (AWB, shipment ID, etc.)
- Adds a system note to adminNotes explaining the reset
- Shows detailed results of successful/failed resets

### Step 5: Re-initiate Pickups

After recovery, you have two options:

**Option A: Bulk Pickup (Recommended for many requests)**
1. Go to admin dashboard
2. Filter by `pending` status
3. Select all recovered requests
4. Click **"Initiate Pickups"**
5. The system will create new carrier bookings for all selected requests

**Option B: Individual with Carrier Override**
1. Open each request individually
2. Select desired carrier from Carrier Override dropdown
3. Click **"Approve & Initiate Pickup"**
4. Repeat for each request

---

## UI Changes Summary

### Admin Dashboard Modal

**For `pending` status:**
- Shows: "Approve & Initiate Pickup" button (blue)
- Shows: Carrier Override dropdown
- Behavior: Creates initial pickup booking

**For `pickup_pending` status:**
- Shows: "Re-initiate Pickup with Selected Carrier" button (orange)
- Shows: Carrier Override dropdown with warning message
- Shows: "Reset to Pending" button (red)
- Behavior: Creates NEW pickup booking (previous remains in carrier system)

**For `scheduled` status:**
- Shows: "Reset to Pending" button (red)
- Behavior: Clears carrier info and resets to pending

---

## Server Changes Summary

### Modified Endpoints

1. **`/api/admin/approve`** (Modified)
   - Now accepts `pickup_pending` status in addition to `pending`
   - Logs re-initiation attempts
   - Adds note to adminNotes about previous carrier

2. **`/api/admin/reset-pickup`** (New)
   - Resets `pickup_pending` or `scheduled` requests to `pending`
   - Clears: carrier, carrierAwb, carrierShipmentId, awbNumber, shipmentId, pickupDate
   - Adds system note to adminNotes

---

## Troubleshooting

### Issue: "Can only reset pickup_pending or scheduled requests"
**Solution:** The request is not in a resettable state. Check the current status in the database.

### Issue: Carrier booking fails again after reset
**Solutions:**
1. Try the other carrier (use carrier override)
2. Check carrier API credentials in `.env`
3. Verify pickup location is configured correctly for the carrier
4. Check server logs for specific error messages

### Issue: Too many requests to reset manually
**Solution:** Use the bulk recovery script:
1. Run `find-failed-pickups.js` to get all failed IDs
2. Add them all to `recover-failed-pickups.js`
3. Run the recovery script
4. Use bulk pickup in admin dashboard

---

## Important Notes

1. **Previous carrier bookings are NOT cancelled automatically** - You need to cancel them manually in the carrier's dashboard if needed.

2. **Admin notes are preserved** - All reset and re-initiation actions are logged in the adminNotes field for audit trail.

3. **Carrier mode settings still apply** - If you don't use carrier override, the system will use your configured carrier mode (shiprocket_only, delhivery_only, etc.)

4. **Server timeout protection** - The bulk pickup endpoint has a 5-minute timeout to handle large batches.

---

## Quick Reference Commands

```bash
# Find failed pickups
node find-failed-pickups.js

# Recover failed pickups (after updating FAILED_REQUEST_IDS)
node recover-failed-pickups.js

# Check current status distribution
node check-pickup-pending.js
```

---

## Need Help?

If you encounter issues:
1. Check server console logs for detailed error messages
2. Verify `.env` has correct carrier credentials
3. Test carrier APIs individually
4. Use the diagnostic scripts to identify specific problems
