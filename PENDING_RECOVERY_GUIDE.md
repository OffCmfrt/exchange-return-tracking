# Recovery Guide: Delhivery Orders Stuck in "Pending Review"

## Problem Summary

Some orders that were already initiated in Delhivery are showing as **"Pending Review"** (status: `pending` or `pickup_pending`) in your database because:

1. The AWB number wasn't saved to the database during initial creation
2. These orders exist in Delhivery with valid AWBs
3. Re-initiating them creates **duplicate order errors** in Delhivery
4. Background sync doesn't update them because they're missing AWB numbers

## Root Cause

The background sync logic has two issues:

1. **Sync requires AWB**: The sync query filters `.not('awb_number', 'is', null)`, so orders without AWB are skipped
2. **Missing pickup_booked sync**: Orders with `pickup_booked` status weren't included in sync (now fixed)

## Solution

### Step 1: Run the Recovery Script

```bash
node recover-pending-delhivery-orders.js
```

**What it does:**
- Finds all orders in `pending` or `pickup_pending` status without AWB numbers
- Queries Delhivery API to check if they exist
- Recovers the AWB number from Delhivery
- Updates the database with correct AWB and status (`pickup_booked`, `in_transit`, etc.)

**Expected Output:**
```
🚀 Starting recovery of Delhivery orders stuck in pending review...

🔍 Fetching orders stuck in pending/pickup_pending without AWB...
📊 Found 15 orders that may need recovery

[1/15] REQ-26030
   Type: exchange, Current Status: pending
   🔍 Checking Delhivery for: fws-REQ-26030
   ✅ Found! AWB: 54716210000781, Status: In Transit
   ✅ Database updated - Status: in_transit, AWB: 54716210000781

📊 RECOVERY SUMMARY
Total orders checked: 15
✅ Recovered & Updated: 12
❌ Not found in Delhivery: 3
```

### Step 2: Verify in Admin Dashboard

After recovery:
- Orders will show correct status (`pickup_booked`, `in_transit`, etc.)
- AWB numbers will be populated
- Tracking information will be available

### Step 3: Background Sync Will Now Work

The recovery script fixes the immediate issue. Additionally, I've updated the server code to:

1. ✅ Include `pickup_booked` status in background sync (line 492)
2. ✅ Include `pickup_booked` in the sync query (line 340)

This ensures that recovered orders will continue to get tracking updates automatically.

## For Orders NOT Found in Delhivery

If the recovery script reports "Not found in Delhivery", these orders need manual action:

### Option 1: Initiate Pickup (If Not in Delhivery)

If the order truly doesn't exist in Delhivery:
1. Go to Admin Dashboard → Requests
2. Find the order
3. Click "Approve" or "Initiate Pickup"
4. This will create the order in Delhivery (no duplicate error)

### Option 2: Check with Different Reference

Sometimes orders might be under a different reference:
- Forward orders (exchanges): `fws-REQ-XXXXX`
- Return orders: `REQ-XXXXX`

You can manually check in Delhivery dashboard using the order number.

## Prevention

To prevent this issue in the future:

1. **Monitor Logs**: Watch for errors during order creation
2. **Check Status**: Verify orders have AWB numbers after approval
3. **Use Recovery Script**: Run `recover-pending-delhivery-orders.js` if you notice stuck orders

## Files Modified

### New Files
- `recover-pending-delhivery-orders.js` - Recovery script

### Updated Files
- `server.js` (2 changes):
  - Line 340: Added `pickup_booked` to sync query
  - Line 492: Added `pickup_booked` to sync status list

## Technical Details

### Status Mapping

The recovery script maps Delhivery statuses to your internal statuses:

| Delhivery Status | Internal Status |
|-----------------|----------------|
| Pickup Generated | `pickup_booked` |
| AWB Assigned | `pickup_booked` |
| Scheduled | `scheduled` |
| Picked Up | `picked_up` |
| In Transit | `in_transit` |
| Out for Delivery | `in_transit` |
| Delivered | `delivered` |

### Delhivery API Endpoints Used

- **Tracking**: `https://track.delhivery.com/api/v1/packages/json/?refnum={requestId}`
- **Authentication**: `Token {DELHIVERY_API_KEY}`

### Database Updates

```sql
UPDATE requests 
SET 
  awb_number = '{recovered_waybill}',
  carrier = 'delhivery',
  status = '{mapped_status}',
  updated_at = NOW()
WHERE request_id = '{requestId}';
```

## Troubleshooting

### Script Returns "Not found in Delhivery" for All Orders

**Possible causes:**
1. Wrong API key in `.env`
2. Orders haven't been created in Delhivery yet
3. Reference number format mismatch

**Solution:**
```bash
# Test Delhivery API connection
node test-delhivery-pickup.js
```

### Database Update Fails

**Possible causes:**
1. Database constraint doesn't allow certain statuses
2. Connection issues

**Solution:**
Run the status constraint migration if needed:
```sql
-- In Supabase SQL Editor
-- File: supabase_migration_add_pickup_booked_status.sql
```

### Orders Still Show Wrong Status After Recovery

**Solution:**
1. Wait for background sync (runs every 15 minutes)
2. Or manually trigger sync: Visit `/admin/sync` endpoint
3. Check server logs for sync errors

## Monitoring

Check these indicators in your logs:

**Successful Recovery:**
```
✅ Found! AWB: 54716210000781, Status: In Transit
✅ Database updated - Status: in_transit, AWB: 54716210000781
```

**Background Sync Working:**
```
[REQ-XXXXX] Status updated: pickup_booked → in_transit (delhivery)
```

## Need Help?

If you encounter issues:
1. Check the recovery script output
2. Review server logs for sync errors
3. Verify Delhivery API key is correct
4. Check Supabase connection in `.env`
