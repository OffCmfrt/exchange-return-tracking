# Shopify Discount Code Auto-Sync Feature

## What's New

When you add or edit an ambassador in the Influencer Admin Portal, the discount code is now **automatically created and synced with Shopify**. No more manual creation in Shopify admin!

## Features

### 1. Auto-Create on Add
- When you add a new ambassador, a Shopify discount code is automatically created
- If Shopify creation fails, the ambassador is rolled back (not created)

### 2. Auto-Update on Edit
- Change the referral code? Shopify updates automatically
- Change the discount percentage? Shopify updates automatically
- Change the usage limit? Shopify updates automatically

### 3. Auto-Disable on Remove
- When you remove an ambassador, their Shopify discount code is disabled (not deleted, to preserve history)

### 4. Usage Limit Control
- Set a maximum number of uses for each discount code
- Leave blank for unlimited usage
- Change anytime via the Edit modal

## Setup Instructions

### 1. Run Database Migration
Open your Supabase dashboard → SQL Editor → Run this file:
```
supabase_migration_influencer_discounts.sql
```

This adds 4 new columns to the `influencers` table:
- `discount_value` - Customer discount percentage
- `usage_limit` - Max uses (null = unlimited)
- `shopify_price_rule_id` - Shopify Price Rule ID
- `shopify_discount_code_id` - Shopify Discount Code ID

### 2. Deploy to Render
The new code will automatically deploy to Render when you push to GitHub.

### 3. Test It
1. Go to https://offcomfrt.in/pages/influencer-admin
2. Add a new ambassador with a discount code (e.g., `TEST10`)
3. Check your Shopify admin → Discounts → You should see "Influencer: TEST10"
4. The code should work at checkout!

## New Fields in Admin Portal

### Add/Edit Modal Now Includes:
1. **Customer Discount (%)** - What percentage off the customer gets (defaults to commission rate)
2. **Usage Limit** - Max number of times the code can be used (blank = unlimited)

### Admin Table Now Shows:
- **Discount %** column - The customer discount value
- **Usage Limit** column - Max uses or "Unlimited"

## API Changes

### POST `/api/influencer-admin/add`
New optional fields in request body:
```json
{
  "name": "John Doe",
  "referralCode": "JOHN10",
  "commissionRate": 10,
  "discountValue": 10,      // NEW: customer discount %
  "usageLimit": 50,         // NEW: max uses (or "" for unlimited)
  "phone": "9876543210"
}
```

### PATCH `/api/influencer-admin/update/:id`
Same new fields supported for updates.

## Backwards Compatibility

Existing influencers without Shopify IDs will be automatically backfilled when you edit them for the first time after this update.

## Error Handling

- If Shopify API is unavailable during creation, the ambassador is not created (rollback)
- If Shopify API fails during update, the Supabase update still succeeds (Shopify sync is best-effort)
- All errors are logged to Render console for debugging

## Shopify API Permissions Required

Make sure your Shopify access token has these permissions:
- `write_price_rules` - Create/update/disable discount codes
- `read_price_rules` - Read existing discount codes

If you get permission errors, regenerate your Shopify access token with the correct scopes.

## Troubleshooting

### Discount code not creating in Shopify?
1. Check Render logs for error messages
2. Verify your `SHOPIFY_ACCESS_TOKEN` environment variable is set correctly
3. Ensure your Shopify token has `write_price_rules` permission

### Usage limit not working?
1. Make sure you ran the database migration
2. Check that `usage_limit` column exists in Supabase `influencers` table
3. Verify the value is being sent in the API request

### Old ambassadors not showing usage limit?
Edit and save them once - this will backfill the Shopify discount code and sync the data.
