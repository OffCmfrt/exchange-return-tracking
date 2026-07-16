-- ============================================================================
-- Marketing Dashboard: Audit Log
-- Complete audit trail for all marketing actions and changes
-- ============================================================================

CREATE TABLE IF NOT EXISTS marketing_audit_log (
    id BIGSERIAL PRIMARY KEY,
    
    -- Action details
    action TEXT NOT NULL,
    -- Actions: created, updated, deleted, launched, paused, cancelled, synced, 
    --          login, export, settings_changed, template_submitted, coupon_generated
    entity_type TEXT NOT NULL,
    -- Entity types: campaign, template, coupon, customer, customer_segment,
    --               abandoned_cart, setting, analytics
    entity_id BIGINT,
    entity_name TEXT,
    
    -- Actor
    actor TEXT NOT NULL DEFAULT 'admin',
    actor_type TEXT DEFAULT 'admin',
    -- actor_type: admin, system, cron
    
    -- Change details
    previous_values JSONB DEFAULT '{}',
    new_values JSONB DEFAULT '{}',
    changed_fields TEXT[] DEFAULT '{}',
    details JSONB DEFAULT '{}',
    -- Additional context: {reason: '...', notes: '...'}
    
    -- Request context
    ip_address TEXT,
    user_agent TEXT,
    request_id TEXT,
    
    -- Result
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for audit queries
CREATE INDEX IF NOT EXISTS idx_mal_entity ON marketing_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_mal_action ON marketing_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_mal_actor ON marketing_audit_log(actor);
CREATE INDEX IF NOT EXISTS idx_mal_created ON marketing_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mal_entity_type ON marketing_audit_log(entity_type);
CREATE INDEX IF NOT EXISTS idx_mal_success ON marketing_audit_log(success);

-- Partitioning suggestion for large datasets (commented out - apply manually if needed)
-- Consider partitioning marketing_audit_log by created_at (monthly) once table exceeds 1M rows
