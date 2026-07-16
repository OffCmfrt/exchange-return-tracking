-- ============================================================================
-- Marketing Dashboard: Customer Intelligence
-- Syncs customer data from Shopify orders for segmentation and targeting
-- ============================================================================

-- Marketing customers table - synced from Shopify
CREATE TABLE IF NOT EXISTS marketing_customers (
    id BIGSERIAL PRIMARY KEY,
    shopify_customer_id BIGINT UNIQUE,
    first_name TEXT,
    last_name TEXT,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    
    -- Order metrics
    total_orders INT DEFAULT 0,
    total_spent DECIMAL(12,2) DEFAULT 0,
    average_order_value DECIMAL(12,2) DEFAULT 0,
    last_order_date TIMESTAMPTZ,
    first_order_date TIMESTAMPTZ,
    
    -- Shopify fields
    tags TEXT[] DEFAULT '{}',
    location TEXT,
    accepts_marketing BOOLEAN DEFAULT false,
    verified_email BOOLEAN DEFAULT false,
    
    -- Segmentation
    segment TEXT DEFAULT 'general',
    lifetime_value_tier TEXT DEFAULT 'bronze',
    
    -- Custom fields
    notes TEXT,
    custom_attributes JSONB DEFAULT '{}',
    
    -- Sync tracking
    last_synced_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Marketing customer orders - denormalized order history for quick analytics
CREATE TABLE IF NOT EXISTS marketing_customer_orders (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT REFERENCES marketing_customers(id) ON DELETE CASCADE,
    shopify_order_id BIGINT UNIQUE,
    order_name TEXT NOT NULL,
    total_price DECIMAL(12,2) DEFAULT 0,
    subtotal_price DECIMAL(12,2) DEFAULT 0,
    total_discount DECIMAL(12,2) DEFAULT 0,
    currency TEXT DEFAULT 'INR',
    financial_status TEXT,
    fulfillment_status TEXT,
    cancelled_at TIMESTAMPTZ,
    line_items JSONB DEFAULT '[]',
    discount_codes JSONB DEFAULT '[]',
    order_created_at TIMESTAMPTZ,
    synced_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Customer segments - reusable segment definitions
CREATE TABLE IF NOT EXISTS marketing_customer_segments (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    rules JSONB NOT NULL DEFAULT '{}',
    customer_count INT DEFAULT 0,
    is_auto BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mc_email ON marketing_customers(email);
CREATE INDEX IF NOT EXISTS idx_mc_segment ON marketing_customers(segment);
CREATE INDEX IF NOT EXISTS idx_mc_tier ON marketing_customers(lifetime_value_tier);
CREATE INDEX IF NOT EXISTS idx_mc_shopify_id ON marketing_customers(shopify_customer_id);
CREATE INDEX IF NOT EXISTS idx_mc_phone ON marketing_customers(phone);
CREATE INDEX IF NOT EXISTS idx_mc_total_spent ON marketing_customers(total_spent DESC);
CREATE INDEX IF NOT EXISTS idx_mc_last_order ON marketing_customers(last_order_date DESC);

CREATE INDEX IF NOT EXISTS idx_mco_customer ON marketing_customer_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_mco_shopify_order ON marketing_customer_orders(shopify_order_id);
CREATE INDEX IF NOT EXISTS idx_mco_created ON marketing_customer_orders(order_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcs_name ON marketing_customer_segments(name);
CREATE INDEX IF NOT EXISTS idx_mcs_active ON marketing_customer_segments(is_active);

-- Insert default segments
INSERT INTO marketing_customer_segments (name, description, rules, is_auto)
VALUES 
    ('VIP', 'Customers with total spent > 10000 or 5+ orders', '{"or": [{"field": "total_spent", "operator": "gt", "value": 10000}, {"field": "total_orders", "operator": "gte", "value": 5}]}', true),
    ('At Risk', 'No order in last 90 days', '{"field": "last_order_date", "operator": "lt", "value": "90_days_ago"}', true),
    ('New', 'First order within last 30 days', '{"field": "first_order_date", "operator": "gt", "value": "30_days_ago"}', true),
    ('General', 'Default segment for all customers', '{}', true)
ON CONFLICT (name) DO NOTHING;
