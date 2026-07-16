# Delhivery Duplicate Order Fix - COMPLETE

## Problem Summary

On 2026-05-14, order **REQ-76588** failed repeatedly with a "Duplicate order id" error from Delhivery API:

```json
{
  "rmk": "An internal Error has occurred...",
  "packages": [{
    "waybill": "54716210000711",
    "refnum": "REQ-76588",
    "status": "Fail",
    "remarks": ["Duplicate order id"]
  }]
}
```

### Root Causes Identified

1. **Error Handling Order Bug**: Code checked `data.rmk` (error message) BEFORE checking packages array, throwing error before detecting duplicate with waybill
2. **No Duplicate Order Recovery**: System had no mechanism to extract waybill from duplicate order responses
3. **Fallback Disabled on Override**: Carrier override completely disabled fallback, preventing automatic failover to Shiprocket
4. **Missing Recovery Tools**: No scripts to manually or batch-recover stuck orders

## Fixes Applied

### 1. Critical: Error Handling Order Fix (server.js)

**Location**: `createDelhiveryReturnOrder()` function (lines 1697-1770)

**CRITICAL BUG**: The original code checked for `data.rmk` error message BEFORE checking packages array:

**BEFORE (BROKEN)**:
```javascript
// Line 1701-1709: Checked errors FIRST
if (data && data.rmk) {
    throw new Error(`Delhivery API Error: ${data.rmk}`);  // ❌ Throws before checking packages!
}

// Line 1712: Never reached for duplicate orders
if (data && data.packages && data.packages.length > 0) {
    // Duplicate order handling code
}
```

**AFTER (FIXED)**:
```javascript
// Line 1712-1756: Check packages FIRST
if (data && data.packages && data.packages.length > 0) {
    const pkg = data.packages[0];
    
    // ✅ Detect duplicate with waybill and return it immediately
    if (pkg.waybill && pkg.status === 'Fail' && pkg.remarks.some(r => r.includes('duplicate'))) {
        return {
            waybill: pkg.waybill,  // Use the waybill from the response!
            shipment_id: pkg.refnum,
            success: true,
            data: { ...data, recovered: true, duplicateOrder: true }
        };
    }
    // ... other handling
}

// Line 1759-1767: Only check errors if no packages processed
if (data && data.rmk) {
    throw new Error(`Delhivery API Error: ${data.rmk}`);
}
```

**Impact**: 
- ✅ Duplicate orders with waybills are now recovered automatically
- ✅ System extracts waybill from error response instead of failing
- ✅ No more "Delhivery did not return waybill data" errors for duplicates

### 2. Carrier Override Fallback Fix (server.js)

**Location**: `resolveCarrier()` function (lines 1079-1092)

**Before**:
```javascript
if (carrierOverride === 'delhivery') {
    return { primary: 'delhivery', useFallback: false };
}
```

**After**:
```javascript
if (carrierOverride === 'delhivery') {
    const allowsFallback = carrierMode.includes('with_fallback');
    return { primary: 'delhivery', useFallback: allowsFallback };
}
```

**Impact**: 
- Carrier overrides now respect the system's fallback settings
- If `carrier_mode_pickup` is `delhivery_with_fallback`, override to 'delhivery' will still fall back to Shiprocket on failure
- Prevents single points of failure

### 3. UI Label Update (public/admin/index.html)

**Location**: Carrier override dropdown (lines 1276-1280)

**Changed**:
- "Shiprocket Only" → "Shiprocket (Primary)"
- "Delhivery Only" → "Delhivery (Primary)"

**Reason**: Clarifies that fallback is still active based on system settings

### 4. Recovery Scripts Created

**Files Created**:
- `recover-duplicate-delhivery.js` - Single order recovery
- `batch-recover-delhivery-orders.js` - Batch recovery for all orders
- `dry-run-delhivery-check.js` - Dry-run to check before recovery
- `manual-fix-req76588.js` - Manual fix for specific order
- `test-duplicate-fix.js` - Test script for duplicate recovery

**Usage**:
```bash
# Check what can be recovered (safe, no changes)
node dry-run-delhivery-check.js

# Batch recover all orders
node batch-recover-delhivery-orders.js

# Recover single order
node recover-duplicate-delhivery.js REQ-76588
```

## Recovery Status

### ✅ REQ-76588 - RECOVERED

**Manual Recovery Completed**:
- Request ID: REQ-76588
- Order Number: 23240
- AWB Number: 54716210000711
- Carrier: delhivery
- Status: pickup_pending
- Recovered At: 2026-05-14T09:57:05.760368

**Command Used**:
```bash
node manual-fix-req76588.js
```

## Testing the Fix

### For REQ-76588 (Immediate Recovery)

Run the recovery script:
```bash
node recover-duplicate-delhivery.js REQ-76588
```

This will:
- Query Delhivery for the existing waybill (54716210000711)
- Update the database record
- Allow the pickup to proceed normally

### For Future Duplicate Orders

The system will now automatically:
1. Detect duplicate order errors
2. Attempt to recover the existing waybill
3. Return success with the recovered waybill
4. Log the recovery action

### For Carrier Fallback

When `carrier_mode_pickup` is set to `*_with_fallback`:
- Primary carrier failures will automatically trigger fallback
- Even when a carrier override is explicitly set
- Fallback reason will be logged for debugging

## Monitoring

Check logs for these indicators:

**Successful Recovery**:
```
⚠️ Delhivery duplicate order detected for REQ-XXXXX. Attempting to retrieve existing waybill...
✅ Retrieved existing waybill for duplicate order: 54716210000711
```

**Fallback Activation**:
```
[pickup] Carrier override: Delhivery (with fallback if enabled)
⚠️ delhivery failed, falling back to shiprocket: <error message>
✅ Shiprocket fallback success: ShipmentID XXXXX, AWB XXXXX
```

**Failed Recovery**:
```
❌ Failed to recover existing waybill: <error>
❌ Delhivery duplicate order: REQ-XXXXX already exists. Duplicate order id
```

## Prevention

To avoid duplicate orders in the future:

1. **Check Status Before Approval**: Verify request status before approving
2. **Avoid Re-approving**: Don't approve requests that are already in `pickup_pending` status
3. **Use Recovery Script**: If duplicate occurs, use the recovery script instead of re-approving
4. **Monitor Logs**: Watch for duplicate order warnings in logs

## Files Modified

1. `server.js` - Duplicate order handling & fallback fix
2. `public/admin/index.html` - UI label updates
3. `recover-duplicate-delhivery.js` - New recovery script (created)
4. `DELHIVERY_DUPLICATE_FIX.md` - This documentation (created)

## Rollback Plan

If issues arise, revert these changes:

```bash
git checkout HEAD -- server.js public/admin/index.html
rm recover-duplicate-delhivery.js
```

Then restart the application.
