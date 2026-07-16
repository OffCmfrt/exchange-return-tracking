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

---

# Influencer Analytics & Leaderboard

## What's New

Detailed analytics view for each influencer (accessible to both admin and influencer) + a leaderboard ranked by sales.

## Features

### 1. Product Shipments & Reel Tracking
- Admin manually adds products sent to an influencer with a due date for reel submission
- Influencer can submit their reel URL from the portal
- Admin can mark reels as "Received" and attach URLs
- Status badges: Pending, Received, Overdue (auto-computed when due date passes)

### 2. Monthly Commission Payouts
- One row per influencer per calendar month
- Auto-calculated from `influencer_orders`: `amount_due = revenue * commission_rate / 100`
- Admin clicks "Generate Payouts" for a given month (YYYY-MM)
- Paid/Unpaid toggle per row with timestamp tracking

### 3. Analytics Dashboard (3-Tab Modal)
- **Overview**: Revenue, orders, AOV, estimated earnings + monthly bar chart + recent conversions
- **Shipments & Reels**: Table of all products sent, due dates, reel status, actions
- **Payouts**: Monthly payout history with paid/unpaid toggle

### 4. Leaderboard
- Top 10 influencers ranked by revenue
- Range selector: 30 Days / 90 Days / All Time
- Visible on: Admin Influencer Page, Influencer Portal, Admin Dashboard
- Full names visible to everyone
- Influencer portal highlights the current user's own row

## Setup Instructions

### 1. Run Database Migration
Open your Supabase dashboard → SQL Editor → Run this file:
```
supabase_migration_influencer_analytics.sql
```

This creates 2 new tables:
- `influencer_product_shipments` — tracks products sent to influencers and reel status
- `influencer_payouts` — monthly commission payout ledger

### 2. Deploy to Render
Push to GitHub — Render will auto-deploy the new API routes.

### 3. Test It
1. Go to https://offcomfrt.in/pages/influencer-admin
2. Click "View" on any influencer
3. You'll see 3 tabs: Overview, Shipments & Reels, Payouts
4. Add a shipment → Switch to Shipments tab → see it appear
5. Click "Generate Payouts" → enter current month (e.g., 2026-05)
6. Toggle Paid/Unpaid on any payout row
7. Check the leaderboard widget above the ambassador table

## New API Endpoints

### Admin Routes (require `authenticateAdmin`)
```
POST   /api/influencer-admin/shipments/:influencerId     — Create shipment
GET    /api/influencer-admin/shipments/:influencerId     — List shipments
PATCH  /api/influencer-admin/shipments/:shipmentId       — Update shipment
DELETE /api/influencer-admin/shipments/:shipmentId       — Delete shipment

POST   /api/influencer-admin/payouts/generate            — Generate payouts for month (body: {month: 'YYYY-MM'})
GET    /api/influencer-admin/payouts/:influencerId        — List payouts
PATCH  /api/influencer-admin/payouts/:payoutId            — Toggle paid/pending (body: {status: 'paid'|'pending'})

GET    /api/influencer-admin/analytics/:influencerId      — Full analytics (summary, monthly, shipments, payouts)
GET    /api/influencer-admin/leaderboard                  — Top 10 influencers by revenue
```

### Influencer Routes (validate `link_token`)
```
PATCH  /api/influencer/shipments/:token/:shipmentId       — Submit reel URL (body: {reelUrl})
GET    /api/influencer/shipments/:token                   — List own shipments
GET    /api/influencer/payouts/:token                     — List own payouts
GET    /api/influencer/analytics/:token                   — Full analytics
GET    /api/influencer/leaderboard/:token                 — Leaderboard (highlights own row)
```

## Analytics Response Shape
```json
{
  "influencer": { "id", "name", "referral_code", "commission_rate" },
  "summary": { "totalRevenue", "totalOrders", "aov", "estimatedEarnings", "commissionRate" },
  "monthly": [{ "month": "2026-04", "orders": 12, "revenue": 18000, "commission": 1800 }],
  "shipments": { "total", "pending", "received", "overdue", "items": [...] },
  "payouts": { "totalPaid", "totalPending", "items": [...] }
}
```

## Troubleshooting

### Shipments not appearing?
1. Verify you ran `supabase_migration_influencer_analytics.sql`
2. Check Supabase → `influencer_product_shipments` table exists
3. Check browser console for API errors

### Payouts showing zero?
1. Ensure `influencer_orders` table has data for the selected month
2. Check influencer's `commission_rate` is set
3. Generate payouts for a month that actually has orders

### Leaderboard empty?
1. Check `influencer_orders` table has attributed orders
2. Verify the date range has data (try "All" instead of "30D")
