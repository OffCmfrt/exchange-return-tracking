# Gokwik Abandoned Cart Integration Guide

Complete integration of Gokwik checkout abandoned cart data into your marketing dashboard with WhatsApp recovery automation.

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Setup Instructions](#setup-instructions)
4. [Webhook Configuration](#webhook-configuration)
5. [Testing](#testing)
6. [Dashboard Usage](#dashboard-usage)
7. [Troubleshooting](#troubleshooting)

---

## Overview

This integration enables automatic tracking of abandoned carts from Gokwik checkout (both V1 modal and V2 Shopify native) into your marketing dashboard, with automated WhatsApp recovery messages.

### Key Features
- **Real-time Tracking**: Webhook-based instant cart tracking
- **Source Differentiation**: Distinguish between Gokwik and Shopify carts
- **Version Tracking**: Track V1 (modal) vs V2 (Shopify native) checkouts
- **Automated Recovery**: WhatsApp reminders at 1hr, 24hr, and 72hr intervals
- **Analytics**: Source-specific recovery rates and revenue tracking
- **Duplicate Prevention**: Unique checkout_id prevents duplicate tracking

---

## Architecture

### Data Flow

```
Gokwik Checkout → Webhook → Your Server → Supabase → Marketing Dashboard
                                              ↓
                                    WhatsApp Recovery (1hr/24hr/72hr)
```

### Components

1. **Database Schema** (`supabase_migration_gokwik_abandoned_cart.sql`)
   - Adds Gokwik-specific columns to `marketing_abandoned_carts`
   - Tracks checkout_source, checkout_version, payment_method
   - Unique index on `gokwik_checkout_id`

2. **Webhook Endpoint** (`server.js` line ~10758)
   - `POST /api/webhooks/gokwik/abandoned-cart`
   - HMAC SHA256 signature verification
   - Duplicate prevention via `gokwik_checkout_id`

3. **DB Helpers** (`config/marketing-db-helpers.js`)
   - `createAbandonedCart()` - Handles Gokwik fields
   - `getAbandonedCarts()` - Source filtering
   - `getAbandonedCartStats()` - Source-specific stats

4. **Frontend Dashboard** (`public/admin/marketing/`)
   - Source filter dropdown
   - Source breakdown display
   - Source icons in cart list

5. **Cron Job** (`server.js` line ~10965)
   - Processes all carts (Gokwik + Shopify)
   - Sends WhatsApp reminders
   - Source-specific logging

---

## Setup Instructions

### Step 1: Run Database Migration

Execute the migration SQL in your Supabase SQL editor:

```bash
# File: supabase_migration_gokwik_abandoned_cart.sql
```

**What it does:**
- Adds `gokwik_checkout_id`, `checkout_version`, `checkout_source`, `payment_method`, `gokwik_customer_phone_verified` columns
- Creates indexes for performance
- Adds unique constraint on `gokwik_checkout_id`

### Step 2: Configure Environment Variables

Add to your `.env` file:

```env
# Gokwik Webhook Configuration
GOKWIK_WEBHOOK_SECRET=your_actual_secret_here
GOKWIK_CHECKOUT_VERSION=v1
```

**Important:**
- Replace `your_actual_secret_here` with the secret provided by Gokwik
- Set `GOKWIK_CHECKOUT_VERSION` to `v1` (modal) or `v2` (Shopify native)

### Step 3: Deploy Server

Deploy your updated server to production:

```bash
git add .
git commit -m "feat: Add Gokwik abandoned cart integration"
git push origin main
```

### Step 4: Configure Gokwik Webhook

Contact Gokwik Merchant Integration team with:

**Webhook URL:**
```
https://exchange-return-tracking.onrender.com/api/webhooks/gokwik/abandoned-cart
```

**Request:**
- Add webhook trigger for abandoned cart events
- Confirm webhook secret (must match `GOKWIK_WEBHOOK_SECRET`)
- Ask about payload structure and signature method

**Expected Payload Structure:**
```json
{
  "checkout_id": "gokwik_checkout_xxx",
  "customer": {
    "phone": "+91XXXXXXXXXX",
    "email": "customer@example.com",
    "name": "Customer Name",
    "phone_verified": true
  },
  "cart": {
    "items": [...],
    "total_value": 1500,
    "currency": "INR"
  },
  "checkout_url": "https://checkout.gokwik.co/...",
  "created_at": "2026-06-16T10:00:00Z",
  "payment_method": "COD/UPI/Card",
  "checkout_version": "v1"
}
```

---

## Webhook Configuration

### Signature Verification

The webhook uses HMAC SHA256 signature verification:

**Header:** `X-Gokwik-Signature` or `X-Gokwik-Webhook-Signature`

**Verification Process:**
```javascript
const hmac = crypto.createHmac('sha256', GOKWIK_WEBHOOK_SECRET);
const digest = hmac.update(payload).digest('hex');
// Compare with received signature
```

### Webhook Endpoint

**URL:** `POST /api/webhooks/gokwik/abandoned-cart`

**Authentication:** None (signature-based verification)

**Response:**
- `200 OK` - Cart tracked successfully
- `401 Unauthorized` - Invalid signature
- `400 Bad Request` - Missing checkout_id
- `500 Internal Server Error` - Configuration error

---

## Testing

### Automated Test Script

Run the test script to validate integration:

```bash
node test-gokwik-webhook.js
```

**What it tests:**
1. ✅ Valid webhook payload processing
2. ✅ Duplicate prevention (same checkout_id)
3. ✅ Invalid signature rejection
4. ✅ Database insertion

### Manual Testing with Postman

**Request:**
```http
POST /api/webhooks/gokwik/abandoned-cart HTTP/1.1
Host: exchange-return-tracking.onrender.com
Content-Type: application/json
X-Gokwik-Signature: <generated_signature>

{
  "checkout_id": "test_123",
  "customer": {
    "phone": "+919876543210",
    "email": "test@example.com",
    "name": "Test User"
  },
  "cart": {
    "items": [],
    "total_value": 1000,
    "currency": "INR"
  },
  "checkout_url": "https://checkout.gokwik.co/test",
  "checkout_version": "v1"
}
```

**Generate Signature:**
```javascript
const crypto = require('crypto');
const payload = { /* your payload */ };
const secret = process.env.GOKWIK_WEBHOOK_SECRET;
const signature = crypto.createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');
```

### Verify in Dashboard

After successful webhook:
1. Go to Marketing Dashboard → Abandoned Carts
2. Check "Source" filter shows "Gokwik"
3. Verify cart shows "Gokwik" icon and "V1" badge
4. Check source breakdown: "Gokwik: X | Shopify: Y"
5. Test "Send Reminder" button

---

## Dashboard Usage

### Source Filter

Use the "Source" dropdown to filter carts:
- **All Sources**: Show all carts
- **Gokwik**: Show only Gokwik checkout carts
- **Shopify**: Show only Shopify checkout carts

### Source Breakdown

View source-specific stats in the card header:
```
Gokwik: 45 (12 recovered) | Shopify: 32 (8 recovered)
```

### Cart List Columns

New "Source" column shows:
- 🛒 **Gokwik** (orange icon) - Gokwik checkout
- 🏪 **Shopify** (green icon) - Shopify checkout
- Version badge (V1/V2) for Gokwik carts

### Analytics

Stats cards show:
- Total carts (all sources)
- Recovered count
- Revenue recovered
- Recovery rate

Source-specific breakdown available in `bySource` stats object.

---

## Troubleshooting

### Webhook Not Receiving Events

**Check:**
1. ✅ Webhook URL is correct: `https://exchange-return-tracking.onrender.com/api/webhooks/gokwik/abandoned-cart`
2. ✅ Gokwik team has configured the webhook in their dashboard
3. ✅ Server is deployed and running
4. ✅ Check server logs for `[Gokwik Webhook]` entries

### Invalid Signature Errors

**Solutions:**
1. ✅ Verify `GOKWIK_WEBHOOK_SECRET` matches the secret provided by Gokwik
2. ✅ Check signature header name: `X-Gokwik-Signature` or `X-Gokwik-Webhook-Signature`
3. ✅ Ensure payload is not modified before signature verification

### Carts Not Appearing in Dashboard

**Check:**
1. ✅ Database migration ran successfully (check columns exist)
2. ✅ `checkout_source` column is set to 'gokwik' for Gokwik carts
3. ✅ Frontend is loading latest `dashboard.js`
4. ✅ Hard refresh browser (Ctrl+F5)

### WhatsApp Reminders Not Sending

**Check:**
1. ✅ Cart has `customer_phone` field
2. ✅ `auto_recovery_enabled` is true
3. ✅ Cron job is running (check logs for `[Marketing Cron]`)
4. ✅ WhatsApp template `abandoned_cart_reminder` is approved

### Duplicate Carts

**Prevention:**
- Unique index on `gokwik_checkout_id` prevents duplicates
- Webhook checks for existing `gokwik_checkout_id` before inserting
- If duplicate detected, returns existing cart ID

---

## API Reference

### Get Abandoned Carts

```http
GET /api/admin/marketing/abandoned-carts?source=gokwik&status=pending
```

**Parameters:**
- `source`: 'gokwik' | 'shopify' (optional)
- `status`: Cart status filter (optional)
- `page`: Page number (optional)

### Get Abandoned Cart Stats

```http
GET /api/admin/marketing/abandoned-carts/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "total": 100,
    "recoveredCount": 20,
    "recoveredRevenue": 15000,
    "recoveryRate": 20.00,
    "bySource": {
      "gokwik": {
        "total": 60,
        "recovered": 12,
        "revenue": 9000,
        "recoveryRate": 20.00
      },
      "shopify": {
        "total": 40,
        "recovered": 8,
        "revenue": 6000,
        "recoveryRate": 20.00
      }
    }
  }
}
```

---

## Files Modified

### Backend
- `server.js` - Webhook endpoint, signature verification, cron job updates
- `config/marketing-db-helpers.js` - Gokwik field handling, source filtering

### Frontend
- `public/admin/marketing/index.html` - Source filter, source column
- `public/admin/marketing/dashboard.js` - Source display, stats breakdown

### Database
- `supabase_migration_gokwik_abandoned_cart.sql` - Schema migration

### Configuration
- `.env` - Gokwik environment variables

### Testing
- `test-gokwik-webhook.js` - Webhook test script

---

## Support

For issues or questions:
1. Check server logs for `[Gokwik Webhook]` entries
2. Verify database columns exist
3. Test with `test-gokwik-webhook.js`
4. Contact Gokwik Merchant Integration team for webhook configuration

---

## Changelog

### v1.0.0 (2026-06-16)
- Initial Gokwik integration
- Webhook endpoint with signature verification
- Source-specific filtering and analytics
- Automated WhatsApp recovery
- Dashboard UI updates
