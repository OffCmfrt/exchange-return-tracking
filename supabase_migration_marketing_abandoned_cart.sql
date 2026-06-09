-- ============================================================================
-- Marketing Dashboard: Abandoned Cart Recovery
-- Track abandoned carts and automate WhatsApp recovery messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS marketing_abandoned_carts (
    id BIGSERIAL PRIMARY KEY,
    
    -- Customer identification
    customer_email TEXT,
    customer_phone TEXT,
    customer_name TEXT,
    shopify_customer_id BIGINT,
    anonymous_id TEXT,
    -- Browser/session identifier for pre-login carts
    
    -- Cart data
    cart_token TEXT NOT NULL,
    checkout_id TEXT,
    checkout_url TEXT,
    cart_value DECIMAL(12,2) DEFAULT 0,
    cart_total_weight DECIMAL(10,2) DEFAULT 0,
    currency TEXT DEFAULT 'INR',
    items JSONB DEFAULT '[]',
    -- items: [{product_id, variant_id, title, quantity, price, image_url, variant_title}]
    
    -- Recovery tracking
    recovery_status TEXT DEFAULT 'pending',
    -- Status: pending, reminder_scheduled, first_reminder_sent, second_reminder_sent, 
    --          final_reminder_sent, recovered, expired, unsubscribed
    
    -- Message tracking
    first_reminder_at TIMESTAMPTZ,
    second_reminder_at TIMESTAMPTZ,
    final_reminder_at TIMESTAMPTZ,
    reminder_count INT DEFAULT 0,
    last_reminder_at TIMESTAMPTZ,
    message_template_id BIGINT REFERENCES marketing_templates(id),
    
    -- Recovery result
    recovered_at TIMESTAMPTZ,
    recovered_order_id TEXT,
    recovered_order_name TEXT,
    recovered_amount DECIMAL(12,2),
    recovery_channel TEXT,
    -- Channel: whatsapp, email, direct
    
    -- Shopify checkout data
    shopify_checkout_id TEXT,
    abandoned_checkout_url TEXT,
    
    -- Configuration
    auto_recovery_enabled BOOLEAN DEFAULT true,
    reminder_schedule JSONB DEFAULT '[
        {"delay_hours": 1, "template": "cart_reminder_1"},
        {"delay_hours": 24, "template": "cart_reminder_2"},
        {"delay_hours": 72, "template": "cart_reminder_final"}
    ]',
    
    -- Metadata
    source TEXT,
    -- Source: storefront, checkout, api
    user_agent TEXT,
    ip_country TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days')
);

-- Abandoned cart recovery coupons (auto-generated per cart if configured)
CREATE TABLE IF NOT EXISTS marketing_cart_recovery_coupons (
    id BIGSERIAL PRIMARY KEY,
    cart_id BIGINT REFERENCES marketing_abandoned_carts(id) ON DELETE CASCADE,
    coupon_code TEXT NOT NULL UNIQUE,
    discount_type TEXT DEFAULT 'percentage',
    discount_value DECIMAL(12,2) DEFAULT 10.00,
    min_purchase_amount DECIMAL(12,2),
    max_discount_amount DECIMAL(12,2),
    expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '48 hours'),
    is_used BOOLEAN DEFAULT false,
    used_at TIMESTAMPTZ,
    shopify_discount_code_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for abandoned carts
CREATE INDEX IF NOT EXISTS idx_mac_token ON marketing_abandoned_carts(cart_token);
CREATE INDEX IF NOT EXISTS idx_mac_status ON marketing_abandoned_carts(recovery_status);
CREATE INDEX IF NOT EXISTS idx_mac_email ON marketing_abandoned_carts(customer_email);
CREATE INDEX IF NOT EXISTS idx_mac_phone ON marketing_abandoned_carts(customer_phone);
CREATE INDEX IF NOT EXISTS idx_mac_created ON marketing_abandoned_carts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mac_expires ON marketing_abandoned_carts(expires_at);
CREATE INDEX IF NOT EXISTS idx_mac_auto ON marketing_abandoned_carts(auto_recovery_enabled);
CREATE INDEX IF NOT EXISTS idx_mac_reminder ON marketing_abandoned_carts(last_reminder_at);
CREATE INDEX IF NOT EXISTS idx_mac_shopify_customer ON marketing_abandoned_carts(shopify_customer_id);

-- Indexes for recovery coupons
CREATE INDEX IF NOT EXISTS idx_mrcc_cart ON marketing_cart_recovery_coupons(cart_id);
CREATE INDEX IF NOT EXISTS idx_mrcc_code ON marketing_cart_recovery_coupons(coupon_code);
CREATE INDEX IF NOT EXISTS idx_mrcc_used ON marketing_cart_recovery_coupons(is_used);
CREATE INDEX IF NOT EXISTS idx_mrcc_expires ON marketing_cart_recovery_coupons(expires_at);
