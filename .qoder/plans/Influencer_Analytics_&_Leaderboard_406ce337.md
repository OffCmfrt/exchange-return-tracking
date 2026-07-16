# Influencer Analytics & Leaderboard

## Task 1 — Database Schema

Create `supabase_migration_influencer_analytics.sql` with two new tables.

### `influencer_product_shipments`
Manually added by admin — products sent to an influencer.
| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `influencer_id` | INT FK → `influencers(id)` | ON DELETE CASCADE |
| `product_title` | TEXT | Free-form, admin types it |
| `product_image_url` | TEXT nullable | |
| `shopify_product_id` | BIGINT nullable | Optional link |
| `sent_at` | DATE NOT NULL | |
| `reel_due_date` | DATE NOT NULL | |
| `reel_status` | TEXT | `pending` / `received` / `overdue` |
| `reel_url` | TEXT nullable | Pasted by influencer or admin |
| `reel_received_at` | TIMESTAMPTZ nullable | |
| `notes` | TEXT nullable | |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

Indexes: `(influencer_id, sent_at DESC)`, `(reel_status, reel_due_date)`.

### `influencer_payouts`
One row per influencer per calendar month.
| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | |
| `influencer_id` | INT FK | |
| `month` | TEXT | Format `YYYY-MM` |
| `orders_count` | INT | |
| `revenue_amount` | NUMERIC(12,2) | |
| `commission_rate` | NUMERIC(5,2) | Snapshot at generation time |
| `amount_due` | NUMERIC(12,2) | `revenue * commission_rate / 100` |
| `status` | TEXT | `pending` / `paid` |
| `paid_at` | TIMESTAMPTZ nullable | |
| `notes` | TEXT nullable | |

Unique constraint on `(influencer_id, month)`. Index on `(influencer_id, month DESC)` and `(status)`.

---

## Task 2 — Backend API (`server.js`)

Admin routes use existing `authenticateAdmin`. Influencer routes validate `link_token` like existing `/api/influencer/stats/:token`.

### 2.1 Shipments (admin CRUD)
```
POST   /api/influencer-admin/shipments/:influencerId    — create
GET    /api/influencer-admin/shipments/:influencerId    — list
PATCH  /api/influencer-admin/shipments/:shipmentId      — update (mark received, edit, attach URL)
DELETE /api/influencer-admin/shipments/:shipmentId      — remove
```

### 2.2 Payouts (admin)
```
POST   /api/influencer-admin/payouts/generate          — body: {month: 'YYYY-MM'}
GET    /api/influencer-admin/payouts/:influencerId      — list newest first
PATCH  /api/influencer-admin/payouts/:payoutId          — toggle paid/pending, sets paid_at
```
`generate` aggregates `influencer_orders` grouped by `influencer_id` for the given month, computes `amount_due`, and upserts — skipping any rows already `paid`.

Helper: `async function generatePayoutsForMonth(month)` in `server.js`.

### 2.3 Analytics aggregate (shared shape)
```
GET /api/influencer-admin/analytics/:influencerId?range=30d|90d|6m|all
GET /api/influencer/analytics/:token?range=...
```
Both return the same JSON shape:
```json
{
  "influencer": { "id", "name", "referral_code", "commission_rate" },
  "summary": { "totalRevenue", "totalOrders", "aov", "estimatedEarnings", "commissionRate" },
  "monthly": [{ "month": "2026-04", "orders": 12, "revenue": 18000, "commission": 1800 }],
  "shipments": { "total", "pending", "received", "overdue", "items": [...] },
  "payouts": { "totalPaid", "totalPending", "items": [...] }
}
```
`monthly` is computed via `date_trunc('month', order_created_at)` on `influencer_orders`.
`overdue` is computed at read time: `reel_due_date < CURRENT_DATE AND reel_status = 'pending'`.

### 2.4 Leaderboard
```
GET /api/influencer-admin/leaderboard?range=30d|90d|all&limit=10
GET /api/influencer/leaderboard/:token?range=...&limit=10
```
Returns `[{ rank, id, name, referral_code, revenue, orders, current_user }]` sorted by revenue desc. `current_user: true` flag set only on the influencer-token route for the caller's own row.

### 2.5 Influencer self-submit reel
```
PATCH /api/influencer/shipments/:token/:shipmentId  — paste reel URL
GET   /api/influencer/shipments/:token              — read-only list
GET   /api/influencer/payouts/:token                — read-only list
```
Influencer can only set `reel_url`; admin can override any field.

---

## Task 3 — Admin UI (`public/page.influencer-admin.liquid`)

### 3.1 Extend the existing stats modal ([viewInfluencerStats](file:///c:/Users/SARVESH/Desktop/OFFcomfrt/exchange-return-tracking-main/public/page.influencer-admin.liquid#L1606))
Convert the modal to a 3-tab layout: **Overview** | **Shipments & Reels** | **Payouts**.

- **Overview tab** — Keep existing stat cards. Add a plain CSS monthly bar chart (no library) using `monthly[]` data from the analytics endpoint.
- **Shipments & Reels tab** — Table: `Product | Sent Date | Due Date | Status badge | Reel URL | Actions`. "Add Shipment" button opens a sub-form (product title, optional image URL, sent date, due date, notes). Row actions: Mark Received (prompts for URL), Edit, Delete.
- **Payouts tab** — Table: `Month | Orders | Revenue | Commission % | Amount Due | Status | Action`. Paid/Unpaid toggle button per row (calls PATCH). "Generate Payouts for Month" button (date picker → calls `payouts/generate`).

### 3.2 Leaderboard widget on the main page
New card above the influencer table: **Top Performers**. Range selector (30d / 90d / All). Columns: Rank, Name, Code, Revenue, Orders. Calls `/api/influencer-admin/leaderboard`.

---

## Task 4 — Influencer Portal UI (`public/page.influencer-portal.liquid`)

Three new sections below the existing stat cards:

### 4.1 My Shipments & Reels
Card-list view: product name, sent date, due date, status badge, reel URL. If `reel_status = 'pending'`, show an inline text input + "Submit Reel" button → PATCH `/api/influencer/shipments/:token/:shipmentId`.

### 4.2 My Payouts
Read-only table: `Month | Orders | Revenue | Commission | Amount Due | Status (paid/pending badge)`.

### 4.3 Leaderboard
Same card layout as admin leaderboard; current influencer's row highlighted. Full names visible.

---

## Task 5 — Admin Dashboard (`page.admin-dashboard (1).liquid`)

Add a compact **Top Influencers** leaderboard widget (top 10, revenue + orders) calling `/api/influencer-admin/leaderboard`. Single card, no modal.

---

## Task 6 — Docs & Validation

- Update `INFLUENCER_SHOPIFY_SYNC.md` with new endpoints and SQL migration instructions.
- Smoke test checklist: add shipment → appears in portal → influencer submits reel URL → admin sees `received` badge → generate payouts for current month → toggle Paid → verify leaderboard reflects correct ranking.

---

## Out of Scope (for now)
- Automated email reminders for overdue reels
- CSV bulk payout export
- Charting library (plain CSS bars used instead)
- Influencer self-onboarding of shipments
