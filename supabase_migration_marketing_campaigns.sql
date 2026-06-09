-- ============================================================================
-- Marketing Dashboard: Campaign Management
-- Full campaign lifecycle: create, schedule, send, track, analyze
-- ============================================================================

-- Campaigns table
CREATE TABLE IF NOT EXISTS marketing_campaigns (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'bulk',
    -- Types: bulk, segment, scheduled, automated
    status TEXT DEFAULT 'draft',
    -- Status: draft, scheduled, queued, sending, sent, paused, cancelled, failed
    
    -- Template reference
    template_id BIGINT REFERENCES marketing_templates(id),
    
    -- Targeting
    segment_filter JSONB DEFAULT '{}',
    -- segment_filter: {segment: 'VIP', min_spent: 5000, tags: ['repeat']}
    recipient_count INT DEFAULT 0,
    excluded_customers JSONB DEFAULT '[]',
    -- Array of customer IDs to exclude
    
    -- Scheduling
    scheduled_at TIMESTAMPTZ,
    send_window_start TIME,
    -- Respect timezone business hours
    send_window_end TIME,
    timezone TEXT DEFAULT 'Asia/Kolkata',
    
    -- Delivery tracking
    sent_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    sent_count INT DEFAULT 0,
    delivered_count INT DEFAULT 0,
    read_count INT DEFAULT 0,
    replied_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    
    -- Budget and cost
    budget DECIMAL(12,2),
    cost_per_message DECIMAL(8,4),
    total_cost DECIMAL(12,2) DEFAULT 0,
    
    -- Conversion tracking
    conversions INT DEFAULT 0,
    conversion_value DECIMAL(12,2) DEFAULT 0,
    roi DECIMAL(8,2) DEFAULT 0,
    
    -- Management
    created_by TEXT DEFAULT 'admin',
    notes TEXT,
    tags TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Campaign recipients - individual delivery tracking
CREATE TABLE IF NOT EXISTS marketing_campaign_recipients (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    customer_id BIGINT REFERENCES marketing_customers(id),
    phone TEXT NOT NULL,
    customer_name TEXT,
    
    -- Delivery status
    status TEXT DEFAULT 'pending',
    -- Status: pending, queued, sent, delivered, read, replied, failed, bounced
    error_code TEXT,
    error_message TEXT,
    
    -- Meta message tracking
    meta_message_id TEXT,
    meta_conversation_id TEXT,
    meta_pricing_category TEXT,
    
    -- Timestamps
    queued_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    replied_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    
    -- Template variables used for this recipient
    template_variables JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Campaign performance snapshots (taken periodically during send)
CREATE TABLE IF NOT EXISTS marketing_campaign_snapshots (
    id BIGSERIAL PRIMARY KEY,
    campaign_id BIGINT REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
    snapshot_at TIMESTAMPTZ DEFAULT now(),
    sent_count INT DEFAULT 0,
    delivered_count INT DEFAULT 0,
    read_count INT DEFAULT 0,
    replied_count INT DEFAULT 0,
    failed_count INT DEFAULT 0,
    total_cost DECIMAL(12,2) DEFAULT 0
);

-- Indexes for campaigns
CREATE INDEX IF NOT EXISTS idx_mcamp_status ON marketing_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_mcamp_type ON marketing_campaigns(type);
CREATE INDEX IF NOT EXISTS idx_mcamp_scheduled ON marketing_campaigns(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_mcamp_created ON marketing_campaigns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mcamp_template ON marketing_campaigns(template_id);
CREATE INDEX IF NOT EXISTS idx_mcamp_active ON marketing_campaigns(is_active);

-- Indexes for recipients
CREATE INDEX IF NOT EXISTS idx_mcr_campaign ON marketing_campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mcr_customer ON marketing_campaign_recipients(customer_id);
CREATE INDEX IF NOT EXISTS idx_mcr_status ON marketing_campaign_recipients(status);
CREATE INDEX IF NOT EXISTS idx_mcr_phone ON marketing_campaign_recipients(phone);
CREATE INDEX IF NOT EXISTS idx_mcr_meta_msg ON marketing_campaign_recipients(meta_message_id);
CREATE INDEX IF NOT EXISTS idx_mcr_sent ON marketing_campaign_recipients(sent_at);

-- Indexes for snapshots
CREATE INDEX IF NOT EXISTS idx_mcsnap_campaign ON marketing_campaign_snapshots(campaign_id);
CREATE INDEX IF NOT EXISTS idx_mcsnap_at ON marketing_campaign_snapshots(snapshot_at);
