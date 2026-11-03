-- ============================================================================
-- Website Support Tickets System — Database Migration
-- Idempotent: can be executed multiple times without errors or data loss.
-- Safe for pre-existing WhatsApp bot tables and queries.
-- ============================================================================

-- 1A. Extend support_tickets (additive, every statement idempotent)
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS reason VARCHAR(50);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS reason_label VARCHAR(100);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sub VARCHAR(80);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS sub_label VARCHAR(200);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS other_text TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS preference VARCHAR(30);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS contact_via VARCHAR(20) DEFAULT 'whatsapp';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS new_address TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(10) DEFAULT 'normal';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS team VARCHAR(30);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS assigned_to VARCHAR(100);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMP;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS last_customer_at TIMESTAMP;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS last_agent_at TIMESTAMP;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_type VARCHAR(50);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_label VARCHAR(200);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_at TIMESTAMP;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_by VARCHAR(100);
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS csat INTEGER;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS reopen_count INTEGER DEFAULT 0;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS thread JSONB DEFAULT '[]'::jsonb;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS notes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS has_images BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tickets_channel  ON support_tickets(channel);
CREATE INDEX IF NOT EXISTS idx_tickets_reason   ON support_tickets(reason) WHERE reason IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_team     ON support_tickets(team) WHERE team IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_priority ON support_tickets(priority) WHERE priority = 'high';
CREATE INDEX IF NOT EXISTS idx_tickets_phone    ON support_tickets(customer_phone);

-- 1B. Cached Shopify orders
CREATE TABLE IF NOT EXISTS support_order_cache (
  order_id        VARCHAR(100) PRIMARY KEY,
  customer_phone  VARCHAR(20) NOT NULL,
  customer_name   VARCHAR(255),
  customer_email  VARCHAR(255),
  order_json      JSONB NOT NULL,
  stage           VARCHAR(30),
  payment         VARCHAR(20),
  courier         VARCHAR(50),
  awb             VARCHAR(100),
  address         TEXT,
  total           DECIMAL(10,2),
  placed_at       TIMESTAMP,
  delivered_at    TIMESTAMP,
  synced_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  replaced_by     VARCHAR(100),
  replacements    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_order_cache_phone ON support_order_cache(customer_phone);

-- 1C. Phone whitelist that gates the customer tab
CREATE TABLE IF NOT EXISTS support_whitelist (
  id          SERIAL PRIMARY KEY,
  phone       VARCHAR(20) UNIQUE NOT NULL,
  added_by    VARCHAR(100),
  note        TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 1D. Admin-configurable settings
CREATE TABLE IF NOT EXISTS support_settings (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO support_settings (key, value) VALUES
('sla', '{"high_hours": 4, "normal_hours": 12}'),
('teams', '{"chat":"Chat support","calling":"Calling team","instagram":"Instagram support","logistics":"Logistics & labels","returns":"Returns & QC","escalation":"Refunds & escalations"}'),
('canned_responses', '[
  {"key":"paylink","label":"Send payment link","text":"Here is a secure link to pay {amount} online for order #{order}: [paste link]\\n\\nOnce paid, your order becomes prepaid.","mode":"ask"},
  {"key":"video","label":"Ask for unboxing video","text":"Please share a clear unboxing video of the parcel along with photos of the product and the shipping label. You can paste a Google Drive or WhatsApp link here.","mode":"ask"},
  {"key":"address","label":"Ask for full address","text":"Please share your complete address with house number, landmark and PIN code.","mode":"ask"},
  {"key":"courier","label":"Raised with courier","text":"We have raised this with {courier} for AWB {awb}. We will update you here within 24 hours.","mode":"reply"},
  {"key":"policy","label":"Store credit policy","text":"Returns at Offcomfrt are settled as store credit, issued as a code titled with your order number ({order}). It can be used on any product at offcomfrt.com.","mode":"reply"},
  {"key":"shipped","label":"Already shipped","text":"Order #{order} has already left our warehouse, so it cannot be changed now. Once delivered, you can request an exchange or return for store credit within 7 days.","mode":"reply"}
]'),
('resolution_templates', '{
  "information_shared":"We have shared the information you asked for about order #{order}.",
  "order_updated":"Your order #{order} has been updated as requested.",
  "address_updated":"Your delivery address for order #{order} has been updated.",
  "order_cancelled":"Order #{order} has been cancelled as requested.",
  "converted_prepaid":"Payment received. Order #{order} is now prepaid.",
  "new_order":"We have created a new order for you. You will get the details on WhatsApp shortly.",
  "pickup_scheduled":"Your reverse pickup for order #{order} is scheduled with Delhivery. Please keep the product unused, with tags, in its original packet.",
  "exchange_dispatched":"Your exchange for order #{order} has been dispatched. Tracking details will follow on WhatsApp.",
  "reshipped":"We have reshipped order #{order}. You will get the new tracking details on WhatsApp shortly.",
  "store_credit_issued":"We have issued store credit for order #{order}. Your code is titled {order} and can be applied at checkout on offcomfrt.com.",
  "courier_escalated":"We took this up with {courier} (AWB {awb}) and it is now resolved.",
  "request_declined":"We are unable to approve this request for order #{order}. {reason}",
  "claim_not_verified":"We checked the order, packing and courier records for #{order} and could not verify this issue. If you have more details, reopen the ticket within 7 days.",
  "no_response":"We are closing this as we did not hear back. You can reopen it within 7 days."
}'),
('cost_config', '{"fwd_ship":75,"rto_ship":75,"reverse_pickup":90,"packing":20,"cod_fee":35,"rto_rate_cod":0.25,"rto_rate_prepaid":0.05,"high_value":2500,"return_window_days":7,"dnr_report_days":3}')
ON CONFLICT (key) DO NOTHING;

-- 1E. Ticket attachments
CREATE TABLE IF NOT EXISTS ticket_attachments (
  id          SERIAL PRIMARY KEY,
  ticket_id   INTEGER REFERENCES support_tickets(id) ON DELETE CASCADE,
  image_url   TEXT NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_attachments_ticket ON ticket_attachments(ticket_id);
