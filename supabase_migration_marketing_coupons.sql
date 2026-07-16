-- ============================================================================
-- Marketing Dashboard: Coupon Management
-- Create, manage, and sync discount coupons with Shopify
-- ============================================================================

CREATE TABLE IF NOT EXISTS marketing_coupons (
    id BIGSERIAL PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT,
    description TEXT,
    
    -- Discount configuration
    discount_type TEXT NOT NULL DEFAULT 'percentage',
    -- Types: percentage, fixed_amount, free_shipping
    discount_value DECIMAL(12,2) NOT NULL,
    min_purchase_amount DECIMAL(12,2) DEFAULT 0,
    max_discount_amount DECIMAL(12,2),
    applies_to TEXT DEFAULT 'all',
    -- applies_to: all, specific_products, specific_collections
    
    -- Usage limits
    usage_limit INT,
    used_count INT DEFAULT 0,
    usage_limit_per_customer INT DEFAULT 1,
    
    -- Targeting
    applicable_products TEXT[] DEFAULT '{}',
    applicable_collections TEXT[] DEFAULT '{}',
    segment_target TEXT,
    -- Target customer segment (null = all customers)
    campaign_id BIGINT REFERENCES marketing_campaigns(id),
    
    -- Shopify integration
    shopify_price_rule_id TEXT,
    shopify_discount_code_id TEXT,
    shopify_sync_status TEXT DEFAULT 'pending',
    -- Status: pending, synced, failed, deleted
    shopify_sync_error TEXT,
    shopify_synced_at TIMESTAMPTZ,
    
    -- Validity period
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    is_deleted BOOLEAN DEFAULT false,
    
    -- Tracking
    total_revenue_generated DECIMAL(12,2) DEFAULT 0,
    total_orders_uses INT DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    
    -- Management
    created_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Coupon usage log - track each individual use
CREATE TABLE IF NOT EXISTS marketing_coupon_usage (
    id BIGSERIAL PRIMARY KEY,
    coupon_id BIGINT REFERENCES marketing_coupons(id) ON DELETE CASCADE,
    shopify_order_id BIGINT,
    order_name TEXT,
    customer_email TEXT,
    customer_id BIGINT REFERENCES marketing_customers(id),
    discount_amount DECIMAL(12,2) DEFAULT 0,
    order_total DECIMAL(12,2) DEFAULT 0,
    used_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for coupons
CREATE INDEX IF NOT EXISTS idx_mcp_code ON marketing_coupons(code);
CREATE INDEX IF NOT EXISTS idx_mcp_active ON marketing_coupons(is_active);
CREATE INDEX IF NOT EXISTS idx_mcp_deleted ON marketing_coupons(is_deleted);
CREATE INDEX IF NOT EXISTS idx_mcp_type ON marketing_coupons(discount_type);
CREATE INDEX IF NOT EXISTS idx_mcp_campaign ON marketing_coupons(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mcp_shopify_sync ON marketing_coupons(shopify_sync_status);
CREATE INDEX IF NOT EXISTS idx_mcp_expires ON marketing_coupons(expires_at);
CREATE INDEX IF NOT EXISTS idx_mcp_segment ON marketing_coupons(segment_target);

-- Indexes for usage log
CREATE INDEX IF NOT EXISTS idx_mcpu_coupon ON marketing_coupon_usage(coupon_id);
CREATE INDEX IF NOT EXISTS idx_mcpu_order ON marketing_coupon_usage(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_mcpu_customer ON marketing_coupon_usage(customer_id);
CREATE INDEX IF NOT EXISTS idx_mcpu_email ON marketing_coupon_usage(customer_email);
CREATE INDEX IF NOT EXISTS idx_mcpu_used ON marketing_coupon_usage(used_at DESC);
