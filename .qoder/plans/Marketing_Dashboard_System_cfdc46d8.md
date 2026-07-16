# Marketing Dashboard System (Premium Edition)

## Task 1: Supabase Database Migrations
Create 8 new migration files for a complete marketing data layer:

### 1.1 `supabase_migration_marketing_customers.sql`
- Table: `marketing_customers` with premium columns:
  - Core: id (bigserial PK), shopify_customer_id (bigint UNIQUE), email, phone, first_name, last_name, full_address (text), city, state, country, pincode
  - Purchase metrics: total_orders (int), total_spent (numeric), avg_order_value (numeric), first_order_date, last_order_date, days_between_orders (numeric), purchase_frequency_score (int 1-10)
  - Engagement: accepts_marketing (bool), accepts_sms (bool), whatsapp_opt_in (bool), email_open_rate (numeric), last_campaign_interaction
  - Segmentation: customer_segment (text: vip/repeat/new/lapsed/at_risk), lifetime_value_ltv (numeric), churn_risk_score (int 0-100), preferred_category (text)
  - Metadata: tags (text[]), notes (text), shopify_state (text: enabled/disabled/declined/invited), verified_email (bool), created_at_shopify, synced_at, updated_at
- Indexes: email, phone, shopify_customer_id, total_orders DESC, last_order_date DESC, customer_segment, state, churn_risk_score, accepts_marketing
- Composite index: (customer_segment, last_order_date) for segment queries

### 1.2 `supabase_migration_marketing_campaigns.sql`
- Table: `marketing_campaigns` with premium columns:
  - Core: id (bigserial PK), campaign_name (text), campaign_type (text: coupon/whatsapp/abandoned_cart/mixed), description (text)
  - Targeting: audience_filter (jsonb - complex AND/OR conditions), excluded_customer_ids (bigint[]), recipient_count (int)
  - Content: template_id (FK nullable), coupon_id (FK nullable), message_variants (jsonb - for A/B testing), personalization_vars (jsonb)
  - Delivery: status (text: draft/scheduled/running/paused/completed/cancelled), delivery_mode (text: instant/scheduled/drip), drip_interval_minutes (int), max_messages_per_hour (int default 50)
  - Metrics: sent_count (int), delivered_count (int), failed_count (int), read_count (int), clicked_count (int), converted_count (int), revenue_attributed (numeric), total_cost (numeric)
  - A/B Testing: is_ab_test (bool), variant_a_recipients (int), variant_b_recipients (int), variant_a_metrics (jsonb), variant_b_metrics (jsonb), winning_variant (text)
  - Scheduling: scheduled_at (timestamptz), started_at, completed_at, timezone (text default 'Asia/Kolkata')
  - Meta: created_by (text), created_at, updated_at, notes (text)
- Indexes: status, campaign_type, scheduled_at, created_at DESC, created_by

### 1.3 `supabase_migration_marketing_templates.sql`
- Table: `marketing_templates` with premium columns:
  - Core: id (bigserial PK), name (text UNIQUE), description (text), type (text: whatsapp/email/both), category (text: marketing/utility/authentication/cart_recovery/order_confirmation/feedback)
  - WhatsApp: meta_template_name (text), meta_template_id (text), meta_template_status (text: draft/pending/approved/rejected/rejected_permanently), meta_rejection_reason (text), meta_namespace (text), meta_quality_score (text: green/yellow/red/unknown)
  - Content: language (text default 'en'), header_type (text: text/image/video/document/none), header_content (text), body (text with {{variables}}), footer (text), buttons (jsonb array)
  - Variables: variable_definitions (jsonb - each with name, type, required, default, sample_value), preview_text (text - rendered with sample data)
  - Performance: usage_count (int), last_used_at, avg_read_rate (numeric), avg_conversion_rate (numeric)
  - Versioning: version (int default 1), previous_version_id (bigint self-referencing), is_latest (bool default true)
  - Meta: created_at, updated_at, created_by (text)
- Indexes: type, category, meta_template_status, usage_count DESC, name

### 1.4 `supabase_migration_marketing_coupons.sql`
- Table: `marketing_coupons` with premium columns:
  - Core: id (bigserial PK), batch_id (text - groups bulk-generated codes), coupon_code (text UNIQUE), coupon_prefix (text)
  - Discount: discount_type (text: percentage/fixed_amount/free_shipping/buy_x_get_y), discount_value (numeric), minimum_order_amount (numeric), applies_to (text: all/collections/products), target_ids (bigint[])
  - Limits: usage_limit (int), usage_limit_per_customer (int default 1), used_count (int default 0), unique_usage_count (int default 0)
  - Shopify: shopify_price_rule_id (text), shopify_discount_code_id (text), synced_to_shopify (bool)
  - Lifecycle: campaign_id (bigint FK nullable), expires_at (timestamptz), is_active (bool default true), is_expired (bool default false)
  - Performance: revenue_generated (numeric), orders_with_coupon (int), avg_discount_used (numeric)
  - Meta: created_at, updated_at, created_by (text), notes (text)
- Indexes: coupon_code, batch_id, campaign_id, is_active, expires_at, used_count DESC

### 1.5 `supabase_migration_abandoned_carts.sql`
- Table: `abandoned_carts` with premium columns:
  - Core: id (bigserial PK), shopify_checkout_id (bigint UNIQUE), checkout_token (text), customer_id (bigint FK to marketing_customers nullable)
  - Customer: customer_email, customer_phone, customer_name, customer_location (text)
  - Cart: cart_items (jsonb - itemized with product_id, title, variant, quantity, price, image_url), item_count (int), total_price (numeric), currency (text default 'INR'), discount_applied (numeric), shipping_cost (numeric)
  - Recovery: checkout_url (text), abandoned_at (timestamptz), last_reminded_at, reminder_count (int default 0), max_reminders (int default 3), reminder_interval_hours (int default 24)
  - Status: status (text: open/recovering/recovered/expired/ignored), recovered_order_id (bigint nullable), recovered_order_name (text), recovered_amount (numeric), recovery_source (text: auto_reminder/manual_campaign)
  - Campaign: campaign_id (bigint FK nullable - which campaign recovered it)
  - Meta: synced_at, created_at, updated_at
- Indexes: shopify_checkout_id, customer_email, status, abandoned_at DESC, total_price DESC, reminder_count
- Composite: (status, abandoned_at) for active cart queries

### 1.6 `supabase_migration_marketing_audit_log.sql`
- Table: `marketing_audit_log` for complete activity tracking:
  - id (bigserial PK), action (text: campaign_created/campaign_sent/coupon_created/coupon_deactivated/template_created/message_sent/customer_sync/cart_recovered/bulk_operation/settings_changed)
  - entity_type (text), entity_id (bigint), details (jsonb - full snapshot of what changed), performed_by (text), ip_address (text), created_at (timestamptz)
- Indexes: action, entity_type, performed_by, created_at DESC

### 1.7 `supabase_migration_marketing_settings.sql`
- Table: `marketing_settings` for configurable behavior:
  - id (bigserial PK), setting_key (text UNIQUE), setting_value (jsonb), description (text), updated_at, updated_by (text)
- Default rows: auto_cart_recovery_enabled, max_reminders_per_cart, reminder_interval_hours, default_sender_name, rate_limit_per_hour, campaign_approval_required

### 1.8 `supabase_migration_marketing_message_log.sql`
- Table: `marketing_message_log` for granular delivery tracking:
  - id (bigserial PK), campaign_id (bigint FK), customer_id (bigint FK), wa_message_id (text - Meta's message ID), phone (text), template_name (text), status (text: queued/sent/delivered/read/failed), status_reason (text), delivered_at, read_at, cost (numeric), error_code (text), created_at
- Indexes: campaign_id, customer_id, wa_message_id, status, created_at DESC

## Task 2: Meta WhatsApp API Integration Module
Create `config/meta-whatsapp.js` - enterprise-grade Meta Cloud API client:

### Core Functions
- `sendWhatsAppTemplate(phone, templateName, languageCode, components)` - Send via `POST /{phone_number_id}/messages` with body parameters, header, and button components. Returns wa_message_id for delivery tracking
- `sendBulkTemplates(recipients[])` - Queue-based bulk sender with configurable concurrency (max 20/sec per Meta limits), built-in retry with exponential backoff, returns success/failure per recipient
- `createMetaTemplate(name, category, language, components, allowCategoryChange)` - Submit new template via `POST /{business_id}/message_templates`. Supports header types (TEXT/IMAGE/VIDEO/DOCUMENT), body with {{variables}}, footer, and buttons (QUICK_REPLY/URL/PHONE_NUMBER)
- `listMetaTemplates(filters)` - Fetch all templates via `GET /{business_id}/message_templates` with optional filters by status/name/language. Includes quality_score and rejection_reason
- `getTemplateAnalytics(templateId, startDate, endDate)` - Fetch delivery/read/sent metrics
- `getMessageStatus(waMessageId)` - Poll individual message delivery status via `GET /{phone_number_id}/messages`
- `validatePhoneNumber(phone)` - Validate Indian mobile number format (10 digits, starts with 6-9) and ensure it has WhatsApp
- `deleteMetaTemplate(templateId)` - Delete a template by name

### Premium Features
- **Rate Limiter**: Token bucket algorithm - 20 req/sec to Meta, queue overflow handling
- **Retry Logic**: Exponential backoff (1s, 2s, 4s, 8s, 16s) with jitter, max 5 retries on 429/5xx
- **Connection Pooling**: Keep-alive HTTP agent for Meta API calls
- **Health Check**: `checkMetaConnection()` - Verify credentials and phone number ID validity at startup
- **In-Memory Queue**: For high-volume campaigns, queue messages and process in batches with progress tracking
- **Webhook Handler Placeholder**: Structure for receiving Meta webhook callbacks (message status updates)

### Environment Variables (.env.example additions)
```
META_ACCESS_TOKEN=EAA...
META_PHONE_NUMBER_ID=123456789...
META_BUSINESS_ACCOUNT_ID=987654321...
META_APP_ID=123456789...
META_APP_SECRET=abc123...
META_WEBHOOK_VERIFY_TOKEN=your_verify_token
META_API_VERSION=v21.0
```

## Task 3: Marketing Backend API Endpoints
Add all new routes to `server.js` (inserted before Error Handling section at line 9405). All endpoints use `authenticateAdmin` middleware.

### 3.1 Customer Sync & Intelligence
- `POST /api/marketing/customers/sync` - Full or incremental Shopify customer sync. Fetches `customers.json?limit=250` with cursor pagination. For each customer: (a) enriches with total_orders/total_spent via `orders.json?customer_id=X&status=any`, (b) computes LTV, churn_risk_score, purchase_frequency_score, (c) assigns segment (VIP/Repeat/New/Lapsed/At-Risk), (d) upserts to marketing_customers. Returns sync summary: new/updated/failed counts
- `GET /api/marketing/customers` - Paginated list. Query params: page, limit, search (name/email/phone), min_orders, max_orders, segment, state, accepts_marketing, churn_risk_min, churn_risk_max, sort_by (orders/date/spent/ltv), sort_dir. Returns { customers, total, page, totalPages, segment_counts }
- `GET /api/marketing/customers/:id` - Full customer profile: all fields + last 20 order summaries fetched from Shopify, campaign interaction history, messages received stats
- `GET /api/marketing/customers/segments/stats` - Segment analytics: count per segment, avg LTV per segment, avg orders per segment, churn distribution pie data
- `GET /api/marketing/customers/export` - Export filtered customers as CSV (streaming response with Content-Disposition)
- `PUT /api/marketing/customers/:id/notes` - Update customer notes/tags
- Helper: `computeCustomerMetrics(customerId, orders)` - Calculates LTV using `total_spent * avg_margin`, churn_risk by `days_since_last_order / avg_days_between_orders`, purchase_frequency by `total_orders / months_since_first_order`

### 3.2 Campaign Management (Advanced)
- `POST /api/marketing/campaigns` - Create campaign. Body: name, type, description, audience_filter (complex JSON with AND/OR/nested conditions like: { operator: 'AND', conditions: [{ field: 'segment', op: 'in', value: ['vip','repeat'] }, { field: 'last_order_date', op: 'gt', value: '2026-01-01' }] }), template_id, coupon_id, delivery_mode, scheduled_at, drip_interval_minutes, max_messages_per_hour, is_ab_test, message_variants. Validates audience_filter, resolves target count, returns preview of matching customers
- `GET /api/marketing/campaigns` - List campaigns (paginated). Filters: status, type, date_range, created_by. Each campaign includes computed ROI (revenue_attributed / total_cost)
- `GET /api/marketing/campaigns/:id` - Full campaign details with A/B variant comparison, message delivery funnel (sent -> delivered -> read -> clicked -> converted), timeline of sends
- `POST /api/marketing/campaigns/:id/execute` - Execute campaign: (a) resolves audience from saved filter, (b) for A/B: random split recipients, (c) queues messages via Meta bulk sender with rate limiting, (d) creates audit log entry, (e) updates campaign status to running
- `POST /api/marketing/campaigns/:id/pause` / `resume` - Pause/resume running campaigns
- `POST /api/marketing/campaigns/:id/cancel` - Cancel scheduled or running campaign, mark queued messages as cancelled
- `POST /api/marketing/campaigns/:id/clone` - Clone campaign as draft with all settings
- `GET /api/marketing/campaigns/:id/preview` - Preview first message with sample customer data (no actual send)
- `GET /api/marketing/campaigns/:id/audience-count` - Count matching customers for given filter without creating campaign

### 3.3 Coupon Management (Advanced)
- `POST /api/marketing/coupons` - Create single coupon: generates Shopify price rule + discount code, saves to marketing_coupons. Returns coupon details with shopify IDs
- `POST /api/marketing/coupons/bulk` - Bulk generate: prefix + count + discount config. Creates Shopify price rule once, then bulk-creates discount codes via `POST price_rules/{id}/batch`. Each code saved individually. Supports sequential (PREFIX001, PREFIX002) or random alphanumeric codes
- `GET /api/marketing/coupons` - List coupons. Filters: batch_id, campaign_id, is_active, discount_type, date_range. Each coupon shows usage stats
- `GET /api/marketing/coupons/batches` - List coupon batches with aggregate stats (total created, used, revenue)
- `GET /api/marketing/coupons/:id/usage` - Orders using this coupon fetched via Shopify `orders.json?discount_code=X`
- `POST /api/marketing/coupons/:id/deactivate` - Expire Shopify price rule immediately
- `POST /api/marketing/coupons/:id/reactivate` - Re-enable expired price rule
- `GET /api/marketing/coupons/:id/performance` - Time-series usage (orders per day), revenue chart data

### 3.4 Template Management (Advanced)
- `GET /api/marketing/templates` - List with filters: type, category, meta_status, search. Sorted by usage_count DESC
- `GET /api/marketing/templates/:id` - Full template with version history
- `POST /api/marketing/templates` - Create template with variable validation (ensure all {{vars}} in body are defined in variable_definitions)
- `PUT /api/marketing/templates/:id` - Update creates new version (old version marked is_latest=false), previous_version_id set
- `DELETE /api/marketing/templates/:id` - Soft-delete (mark inactive, keep for audit)
- `POST /api/marketing/templates/:id/submit-meta` - Submit to Meta: validate template meets Meta requirements, call createMetaTemplate, store meta_template_id and status
- `POST /api/marketing/templates/:id/sync-meta-status` - Poll Meta for latest template approval status and quality score
- `GET /api/marketing/meta-templates` - List all Meta-side templates (synced from Meta API)
- `POST /api/marketing/templates/:id/preview` - Render template with sample data, return preview text

### 3.5 Abandoned Carts (Advanced)
- `GET /api/marketing/abandoned-carts` - List with filters: status, min_value, max_value, age_hours, search by email/phone. Sort by abandoned_at, total_price. Returns with recovery_rate stats
- `POST /api/marketing/abandoned-carts/sync` - Manual trigger: poll Shopify `checkouts.json?status=open&limit=250` via 2024-01 REST API, upsert to abandoned_carts, link to marketing_customers by email, compute cart metrics
- `POST /api/marketing/abandoned-carts/:id/recover` - Send cart recovery WhatsApp template to specific cart owner using personalized message (customer name, items summary, checkout URL), update reminder_count and last_reminded_at
- `POST /api/marketing/abandoned-carts/bulk-recover` - Filter carts by criteria and send recovery to all matching
- `POST /api/marketing/abandoned-carts/:id/ignore` - Mark cart as ignored (don't auto-remind)
- `GET /api/marketing/abandoned-carts/stats` - Recovery funnel: total abandoned -> reminded -> recovered, recovery rate %, revenue recovered, avg cart value, time-to-recovery
- `GET /api/marketing/abandoned-carts/auto-settings` / `PUT` - Get/set auto-recovery settings (enabled, max_reminders, interval)

### 3.6 Analytics & Reporting
- `GET /api/marketing/stats` - Executive dashboard: total_customers, active_customers_30d, new_customers_30d, churn_rate, avg_ltv, total_campaigns, campaigns_this_month, total_messages_sent, delivery_rate, read_rate, conversion_rate, coupons_active, coupons_redeemed, abandoned_carts_open, recovered_this_month, recovery_rate, total_revenue_influenced, roi_percentage
- `GET /api/marketing/stats/time-series` - Daily/weekly/monthly data: messages_sent, deliveries, reads, conversions, revenue over time (for charts)
- `GET /api/marketing/stats/segments` - Campaign performance by customer segment
- `GET /api/marketing/stats/templates` - Template performance ranking (by read rate, conversion rate)
- `GET /api/marketing/stats/roi` - Campaign ROI breakdown: cost vs revenue attributed per campaign

### 3.7 Direct Actions
- `POST /api/marketing/send-message` - Send WhatsApp template to specific customer(s). Body: { customer_ids: [], template_id, variables_override }. Validates each phone, sends individually, logs to message_log
- `POST /api/marketing/preview-recipients` - Given audience_filter, return sample of 5 matching customers (for preview before campaign creation)

### 3.8 Settings & Audit
- `GET /api/marketing/settings` - Get all marketing settings
- `PUT /api/marketing/settings/:key` - Update a setting
- `GET /api/marketing/audit-log` - Paginated audit trail with filters (action, entity_type, performed_by, date_range)

### 3.9 Webhook Receiver (Meta Callbacks)
- `GET /api/marketing/webhook/meta` - Meta webhook verification (hub.mode, hub.verify_token, hub.challenge)
- `POST /api/marketing/webhook/meta` - Receive message status updates: parse Meta webhook payload (delivered/read/failed events), update message_log status, increment campaign metrics

## Task 4: Marketing Dashboard Frontend (Premium UI/UX)
Create 5 files under `public/admin/marketing/` with enterprise-grade design:

### 4.1 `index.html` - Main Dashboard (~900 lines)
Premium dark-theme inspired by Stripe/Vercel design language:
- **Sidebar Navigation**: Collapsible (240px/64px), OFFCOMFRT logo, 8 nav items with SVG icons (Dashboard, Customers, Campaigns, Abandoned Carts, Templates, Coupons, Analytics, Settings), active state indicator, bottom sync status dot, theme toggle
- **Dashboard View**: 6 animated KPI cards (glass-morphism: backdrop-blur, subtle border) with micro sparklines + change %, 2 Chart.js charts (campaign performance line chart, segment doughnut chart), recent activity feed timeline, quick actions panel
- **Customers View**: Smart filter bar (debounced search + segment/state/orders/churn dropdowns), virtualized data table with sortable columns (name, email, phone, orders, LTV, churn risk gauge, segment badge), bulk selection bar, customer detail slide-over panel with order history and campaign interactions, CSV export modal
- **Campaigns View**: 5-step creation wizard (Audience Builder with AND/OR conditions and live count -> Template selector with variable picker and live preview -> A/B test toggle -> Schedule with drip options -> Review & Confirm), campaign list table with progress bars (sent/delivered/read/converted), campaign detail with delivery funnel visualization and A/B comparison
- **Abandoned Carts View**: Stats banner (open carts, value at risk, recovery rate, revenue recovered), cart table with product image previews, relative timestamps, reminder counts, detail modal with full cart contents and checkout URL, auto-recovery config panel, recovery analytics mini-chart
- **Templates View**: Card grid with Meta approval status dots, full-screen editor (left: form fields + variable definitions table, right: iPhone-frame live preview), version history, Submit to Meta with validation warnings and status polling, template performance mini-stats
- **Coupons View**: Generator form (discount type selector, value, limits, expiration, product targeting, code pattern + count, live preview of first 5 codes), active coupons table with usage progress bars, coupon batches tab, usage detail with time-series chart
- **Analytics View**: Executive dashboard with date range selector, 8 KPI cards, 2x2 charts grid (messages over time, campaign comparison, segment growth, recovery funnel), leaderboard tables (top templates, top campaigns by ROI, top customers by LTV)
- **Settings View**: Marketing config form, paginated audit log table with filters, Meta connection health status indicator
- **Command Palette**: Ctrl+K modal with search + quick actions + navigation

### 4.2 `styles.css` - Premium Styles (~800 lines)
- CSS custom properties design system: `--bg-primary: #000000`, `--bg-surface: #0a0a0a`, `--bg-elevated: #141414`, `--border-default: #1f1f1f`, `--text-primary: #ffffff`, `--text-secondary: #888888`, `--accent-green: #22c55e`, `--accent-red: #ef4444`, `--accent-amber: #f59e0b`, `--accent-purple: #8b5cf6`
- Glass morphism `.glass-card` class: rgba background, backdrop-filter blur(12px), subtle border
- Typography: Inter variable font, scale from 0.625rem to 2.5rem, letter-spacing adjustments
- Animations: fadeIn, slideUp, scaleIn, pulse, shimmer (skeleton loader), all 0.2-0.4s cubic-bezier
- Reusable components: `.btn` (primary/secondary/ghost/danger), `.badge` (status pills with dot), `.progress-bar`, `.modal-overlay` + `.modal`, `.toast-container`, `.data-table`, `.filter-bar`, `.slide-over`, `.command-palette`, `.sidebar`, `.wizard-steps`, `.chart-container`
- Responsive breakpoints: 768px (tablet nav), 1024px (desktop), 1440px (max-width centered)
- `.theme-light` class for optional light mode

### 4.3 `dashboard.js` - Core Engine (~1500 lines)
- `MarketingApp` class: init, auth check (reuse admin JWT), theme detection, sidebar state, command palette
- Hash-based SPA router with lazy view rendering and lifecycle methods
- `MarketingAPI` module: centralized fetch wrapper, 401 redirect, 429 retry with backoff, request deduplication, 5-min response cache
- View Controllers (class per view): DashboardView (KPIs with countUp, charts init), CustomersView (debounced search, filters, virtual scroll via IntersectionObserver, selection), CampaignsView (wizard stepper with validation, A/B setup, progress polling), AbandonedCartsView (30s auto-refresh, recovery actions), TemplatesView (editor with live preview, Meta submission), CouponsView (generator, batch creation), AnalyticsView (Chart.js instances, date filter), SettingsView (audit log)
- UI Utilities: Toast (stacking, auto-dismiss), Modal (focus trap, escape), DataTable (sortable/paginated with skeleton), Charts (Chart.js dark theme wrapper), ExportCSV, countUp animation
- Keyboard shortcuts: Ctrl+K (palette), Ctrl+S (save), Esc (close), Ctrl+Enter (execute)

### 4.4 `chart-init.js` - Chart Configuration (~200 lines)
- Chart.js dark theme defaults, factory functions: createTimeSeriesChart, createDoughnutChart, createBarChart, createFunnelChart, createSparkline, responsive resize handler

### 4.5 `utils.js` - Shared Utilities (~150 lines)
- formatCurrency, formatDate (relative + absolute), formatNumber (1.2K style), debounce/throttle, classNames, escapeHtml, copyToClipboard, parseAudienceFilter, renderTemplatePreview, getSegmentColor, getStatusColor

## Task 5: Server Route & Background Jobs
### 5.1 Add `/admin/marketing` route in `server.js`
Serve `public/admin/marketing/index.html` with matching CSP headers to existing `/admin` route

### 5.2 Background Jobs (node-cron) in `server.js`
- `*/15 * * * *` - Abandoned cart sync: poll Shopify `checkouts.json?status=open&limit=250`, upsert to DB, auto-send first reminder to carts >1h old with 0 reminders, update campaign metrics for recovered carts
- `0 */6 * * *` - Incremental customer sync (by updated_at, last 6 hours)
- `0 1 * * *` - Daily full customer sync + segment recalculation + LTV/churn scores update
- `*/5 * * * *` - Campaign execution check: find scheduled campaigns due now, execute in batches with rate limiting, update status
- `*/10 * * * *` - Message status sync: for messages sent in last 24h without final status, poll Meta API for delivery/read updates
- `0 */2 * * *` - Coupon usage sync: update used_count and revenue_generated for active coupons from Shopify orders

### 5.3 Add to `.env.example`
```
# Meta WhatsApp Cloud API
META_ACCESS_TOKEN=EAA...
META_PHONE_NUMBER_ID=123456789...
META_BUSINESS_ACCOUNT_ID=987654321...
META_APP_ID=123456789...
META_APP_SECRET=abc123...
META_WEBHOOK_VERIFY_TOKEN=your_verify_token
META_API_VERSION=v21.0
```

## Task 6: Execution Order & Verification
Execute in order: (1) Migrations, (2) Meta module, (3) Backend endpoints, (4) Frontend files, (5) Server routes + cron, (6) Integration testing

### 6.1 After each migration: Verify SQL syntax and table creation in Supabase dashboard
### 6.2 After Meta module: Test `checkMetaConnection()` returns valid status
### 6.3 After backend endpoints: Test each endpoint with curl/Postman for correct JSON responses
### 6.4 After frontend: Open /admin/marketing, verify login flow, check all views render, test campaign wizard, test bulk coupon generation
### 6.5 After cron setup: Monitor background job logs for successful syncs
### 6.6 Smoke test: Create campaign for 5 test customers, verify WhatsApp delivery, check analytics update