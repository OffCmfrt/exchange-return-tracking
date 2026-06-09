-- ============================================================================
-- Marketing Dashboard: Message Templates
-- WhatsApp/Meta message templates for campaigns and automated messaging
-- ============================================================================

CREATE TABLE IF NOT EXISTS marketing_templates (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'marketing',
    -- Categories: marketing, utility, authentication, service
    language TEXT DEFAULT 'en',
    status TEXT DEFAULT 'draft',
    -- Status: draft, pending_approval, approved, rejected, disabled
    
    -- Template content
    header TEXT,
    header_type TEXT DEFAULT 'text',
    -- header_type: text, image, video, document
    body TEXT NOT NULL,
    footer TEXT,
    
    -- Interactive elements
    buttons JSONB DEFAULT '[]',
    -- buttons: [{type: 'PHONE_NUMBER'|'URL'|'QUICK_REPLY', text: '...', url: '...', phone_number: '...'}]
    
    -- Variable placeholders
    variables JSONB DEFAULT '[]',
    -- variables: [{name: '1', type: 'text', example: 'John'}, {name: '2', type: 'currency', example: '500'}]
    
    -- Meta integration
    meta_template_id TEXT,
    meta_status TEXT DEFAULT 'PENDING',
    -- Meta statuses: PENDING, APPROVED, REJECTED, PAUSED, DISABLED
    meta_rejection_reason TEXT,
    meta_last_synced_at TIMESTAMPTZ,
    
    -- Usage tracking
    usage_count INT DEFAULT 0,
    last_used_at TIMESTAMPTZ,
    
    -- Management
    is_active BOOLEAN DEFAULT true,
    created_by TEXT DEFAULT 'admin',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Template media assets (for image/video/document headers)
CREATE TABLE IF NOT EXISTS marketing_template_media (
    id BIGSERIAL PRIMARY KEY,
    template_id BIGINT REFERENCES marketing_templates(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL,
    -- media_type: image, video, document
    media_url TEXT NOT NULL,
    mime_type TEXT,
    file_size INT,
    meta_handle_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mt_name ON marketing_templates(name);
CREATE INDEX IF NOT EXISTS idx_mt_category ON marketing_templates(category);
CREATE INDEX IF NOT EXISTS idx_mt_status ON marketing_templates(status);
CREATE INDEX IF NOT EXISTS idx_mt_meta_status ON marketing_templates(meta_status);
CREATE INDEX IF NOT EXISTS idx_mt_active ON marketing_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_mt_language ON marketing_templates(language);

CREATE INDEX IF NOT EXISTS idx_mtm_template ON marketing_template_media(template_id);
