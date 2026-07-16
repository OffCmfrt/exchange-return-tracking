# Reel Due Date NOT NULL Constraint Fix

## Issue
When creating a shipment from inventory, the system throws a database error:

```
null value in column "reel_due_date" of relation "influencer_product_shipments" violates not-null constraint
```

## Root Cause
- The database schema defines `reel_due_date` as `NOT NULL`
- The application code (backend and frontend) treats `reel_due_date` as **optional**
- When admins create inventory-based shipments without specifying a reel due date, the code passes `null`, violating the constraint

## Solution
Run the SQL migration to drop the `NOT NULL` constraint:

**File**: `supabase_migration_make_reel_due_date_optional.sql`

**SQL Command**:
```sql
ALTER TABLE influencer_product_shipments 
ALTER COLUMN reel_due_date DROP NOT NULL;
```

## Steps to Fix

1. **Open Supabase Dashboard**
   - Go to your Supabase project
   - Navigate to SQL Editor

2. **Run the Migration**
   - Copy the contents of `supabase_migration_make_reel_due_date_optional.sql`
   - Execute the SQL in the SQL Editor

3. **Verify the Fix**
   - The migration includes a verification query (commented out)
   - Run it to confirm `is_nullable = 'YES'` for `reel_due_date`

4. **Test the Feature**
   - Try creating a shipment from inventory without setting a reel due date
   - It should now work without errors

## Business Context
- **Inventory-based shipments**: Products sent to influencers from available stock
- **Reel due date**: Optional for shipments that don't require content creation
- **Monthly target shipments**: Should have reel due dates for tracking purposes
- The UI already shows "(Optional)" label for the reel due date field

## Code References
- **Backend**: `server.js` line 7518, 7573 - treats `reelDueDate` as optional
- **Frontend**: `page.influencer-admin.liquid` line 4985, 5041 - sends null if not provided
- **DB Helper**: `config/db-helpers.js` line 846 - inserts `reel_due_date` as provided
- **Original Schema**: `supabase_migration_influencer_analytics.sql` line 14 - has NOT NULL constraint

## Related Documentation
- `SHIPMENT_CREATION_FIX.md` - Documents that reel due date should be optional
- `BUILD_STATUS.md` - Project overview and feature status

## Impact
- ✅ Allows inventory shipments without requiring reel deadlines
- ✅ No breaking changes to existing functionality
- ✅ Backward compatible (existing records with values remain unchanged)
- ✅ Aligns database schema with application behavior
