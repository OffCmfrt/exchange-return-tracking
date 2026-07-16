-- ============================================================================
-- Marketing Dashboard: Analytics
-- Aggregated metrics for campaign performance, ROI, and channel analysis
-- ============================================================================

-- Daily analytics snapshots
CREATE TABLE IF NOT EXISTS marketing_analytics_daily (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    
    -- Customer metrics
    new_customers INT DEFAULT 0,
    returning_customers INT DEFAULT 0,
    total_customers INT DEFAULT 0,
    
    -- Campaign metrics
    campaigns_sent INT DEFAULT 0,
    campaigns_delivered INT DEFAULT 0,
    campaigns_read INT DEFAULT 0,
    campaigns_replied INT DEFAULT 0,
    campaigns_failed INT DEFAULT 0,
    
    -- Revenue metrics
    total_revenue DECIMAL(14,2) DEFAULT 0,
    marketing_attributed_revenue DECIMAL(14,2) DEFAULT 0,
    campaign_revenue DECIMAL(14,2) DEFAULT 0,
    coupon_revenue DECIMAL(14,2) DEFAULT 0,
    cart_recovery_revenue DECIMAL(14,2) DEFAULT 0,
    
    -- Cost metrics
    total_spend DECIMAL(14,2) DEFAULT 0,
    messaging_cost DECIMAL(14,2) DEFAULT 0,
    discount_cost DECIMAL(14,2) DEFAULT 0,
    
    -- Cart recovery metrics
    carts_abandoned INT DEFAULT 0,
    carts_recovered INT DEFAULT 0,
    recovery_rate DECIMAL(5,2) DEFAULT 0,
    
    -- Coupon metrics
    coupons_issued INT DEFAULT 0,
    coupons_redeemed INT DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(date)
);

-- Campaign-level analytics (aggregated per campaign on completion)
CREATE TABLE IF NOT EXISTS marketing_analytics_campaigns (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    
    -- Delivery stats
    total_recipients INT DEFAULT 0,
    delivered INT DEFAULT 0,
    read INT DEFAULT 0,
    replied INT DEFAULT 0,
    failed INT DEFAULT 0,
    delivery_rate DECIMAL(5,2) DEFAULT 0,
    read_rate DECIMAL(5,2) DEFAULT 0,
    reply_rate DECIMAL(5,2) DEFAULT 0,
    
    -- Conversion stats
    conversions INT DEFAULT 0,
    conversion_rate DECIMAL(5,2) DEFAULT 0,
    conversion_value DECIMAL(14,2) DEFAULT 0,
    
    -- Cost stats
    total_cost DECIMAL(14,2) DEFAULT 0,
    cost_per_delivery DECIMAL(8,4) DEFAULT 0,
    cost_per_conversion DECIMAL(8,2) DEFAULT 0,
    
    -- ROI
    roi DECIMAL(8,2) DEFAULT 0,
    roas DECIMAL(8,2) DEFAULT 0,
    
    -- Breakdown by time
    peak_delivery_hour INT,
    average_time_to_read INT,
    -- In minutes
    
    computed_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(campaign_id)
);

-- Channel performance analytics
CREATE TABLE IF NOT EXISTS marketing_analytics_channels (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    channel TEXT NOT NULL,
    -- Channel: whatsapp, sms, email
    
    messages_sent INT DEFAULT 0,
    messages_delivered INT DEFAULT 0,
    messages_read INT DEFAULT 0,
    messages_replied INT DEFAULT 0,
    messages_failed INT DEFAULT 0,
    
    cost DECIMAL(12,2) DEFAULT 0,
    revenue_attributed DECIMAL(14,2) DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(date, channel)
);

-- Customer segment analytics
CREATE TABLE IF NOT EXISTS marketing_analytics_segments (
    id BIGSERIAL PRIMARY KEY,
    date DATE NOT NULL,
    segment TEXT NOT NULL,
    
    customer_count INT DEFAULT 0,
    orders_count INT DEFAULT 0,
    revenue DECIMAL(14,2) DEFAULT 0,
    average_order_value DECIMAL(12,2) DEFAULT 0,
    repeat_purchase_rate DECIMAL(5,2) DEFAULT 0,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(date, segment)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mad_date ON marketing_analytics_daily(date);

CREATE INDEX IF NOT EXISTS idx_mac_campaign ON marketing_analytics_campaigns(campaign_id);

CREATE INDEX IF NOT EXISTS idx_mach_date ON marketing_analytics_channels(date);
CREATE INDEX IF NOT EXISTS idx_mach_channel ON marketing_analytics_channels(channel);

CREATE INDEX IF NOT EXISTS idx_maseg_date ON marketing_analytics_segments(date);
CREATE INDEX IF NOT EXISTS idx_maseg_segment ON marketing_analytics_segments(segment);
