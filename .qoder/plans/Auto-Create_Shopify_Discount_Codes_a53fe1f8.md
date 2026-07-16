# Auto-Create Shopify Discount Codes for Influencers

## Problem
Currently, when an admin adds a new ambassador in the influencer admin portal (`/pages/influencer-admin`), they manually type a **Shopify Discount Code** (e.g., `RAHUL10`) but must separately create that same code inside the Shopify admin. This is manual, error-prone, and often leads to mismatched or missing codes.

## Solution
When an ambassador is **created**, **updated**, or **removed** via the backend API, automatically sync the corresponding discount code to Shopify using the Shopify Admin API.

---

## Task 1: Update Influencer Admin Modal to Capture Discount Value

**File:** `public/page.influencer-admin.liquid`

Add a new field "**Customer Discount (%)**" to the "Add New Ambassador" modal, separate from the commission rate. This controls what percentage off the customer gets at checkout.

- Default value: same as commission rate (10%)
- Placeholder: e.g. `10`
- Range: 0–100

Also add the same field to the **Edit Modal** so existing influencers can have their discount value updated.

**Snippet location (Add Modal):**
```
<div class="ia-form-row">
  <div class="ia-form-group">
    <label for="addCode">Shopify Discount Code</label>
    <input type="text" id="addCode" ...>
  </div>
  <div class="ia-form-group">
    <label for="addCommission">Commission Rate (%)</label>
    <input type="number" id="addCommission" ...>
  </div>
</div>
<!-- NEW FIELD HERE -->
```

---

## Task 2: Update Backend `createInfluencer` to Accept `discountValue`

**File:** `config/db-helpers.js`

Update `createInfluencer` to accept and store a `discountValue` field in the `influencers` table (add column if not present).

```javascript
async function createInfluencer(influencerData) {
    const { data, error } = await supabase
        .from('influencers')
        .insert([{
            name: influencerData.name,
            referral_code: influencerData.referralCode,
            link_token: influencerData.linkToken,
            commission_rate: influencerData.commissionRate ?? 10.00,
            discount_value: influencerData.discountValue ?? influencerData.commissionRate ?? 10.00,
            phone: influencerData.phone,
            is_active: true
        }])
        ...
}
```

Also update `updateInfluencer` to allow updating `discount_value`.

---

## Task 3: Add Shopify Discount Code Helper Functions

**File:** `server.js`

Create reusable helpers that wrap the Shopify Admin API for Price Rules + Discount Codes:

1. `createShopifyDiscountCode(code, percentage, title)`
   - Creates a Price Rule (entire order, percentage off, no minimum purchase, no usage limit)
   - Attaches the discount code to that Price Rule
   - Returns the Price Rule ID

2. `updateShopifyDiscountCode(priceRuleId, newCode, newPercentage)`
   - Updates the existing Price Rule (if code or percentage changed)
   - If code changed, creates a new Discount Code under the same Price Rule and removes the old one (or creates a new Price Rule entirely)

3. `disableShopifyDiscountCode(priceRuleId)`
   - Sets `ends_at` to now, effectively disabling the code

Shopify API endpoints used:
- `POST /admin/api/2024-01/price_rules.json`
- `POST /admin/api/2024-01/price_rules/{id}/discount_codes.json`
- `PUT /admin/api/2024-01/price_rules/{id}.json`

---

## Task 4: Auto-Create on Influencer Add

**File:** `server.js` — endpoint `/api/influencer-admin/add`

After successfully creating the influencer in Supabase, call `createShopifyDiscountCode` with:
- `code`: the `referralCode`
- `percentage`: the `discountValue` (or `commissionRate` as fallback)

**Error handling strategy:**
- If Shopify creation fails, **roll back** the Supabase insert (delete the newly created influencer) and return `500` with a clear message: `"Failed to create Shopify discount code: {error}"`
- Store the returned `price_rule_id` in the `influencers` table (add `shopify_price_rule_id` column)

---

## Task 5: Auto-Update on Influencer Edit

**File:** `server.js` — endpoint `/api/influencer-admin/update/:id`

When `referralCode` or `discountValue` changes:
- Fetch the existing influencer to get `shopify_price_rule_id`
- If `shopify_price_rule_id` exists → call `updateShopifyDiscountCode`
- If it does not exist → call `createShopifyDiscountCode` (backfill for older influencers)

---

## Task 6: Auto-Disable on Influencer Remove

**File:** `server.js` — endpoint `/api/influencer-admin/remove/:id`

Before deleting from Supabase:
- If `shopify_price_rule_id` exists → call `disableShopifyDiscountCode`
- Then proceed with `deleteInfluencer`

---

## Task 7: Database Migration

Add the following new columns to the `influencers` Supabase table:

```sql
ALTER TABLE influencers
ADD COLUMN IF NOT EXISTS discount_value NUMERIC DEFAULT 10.00,
ADD COLUMN IF NOT EXISTS shopify_price_rule_id TEXT;
```

---

## Task 8: Frontend Sync — Update Admin Table & JS

**File:** `public/page.influencer-admin.liquid`

- Send `discountValue` in the `POST /api/influencer-admin/add` and `PATCH /api/influencer-admin/update/:id` payloads
- Optionally display the discount value in the table for quick reference

---

## Assumptions & Defaults
- **Discount type**: Percentage off entire order (most common for influencer codes)
- **Discount value**: Defaults to match the commission rate (10% → 10% off), but admin can override
- **Usage limits**: Unlimited usage, no minimum order value
- **Active dates**: Starts immediately, never expires (unless influencer is removed)

If you want a fixed-amount discount (e.g., flat ₹100 off) instead of percentage, or different rules (minimum purchase, usage limits), let me know and the plan can be adjusted before implementation.
