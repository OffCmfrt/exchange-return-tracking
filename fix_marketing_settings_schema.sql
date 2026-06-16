-- ============================================================================
-- Fix marketing_settings table: Add missing columns
-- Run this in Supabase SQL Editor if you get "column does not exist" errors
-- ============================================================================

-- Add missing columns (IF NOT EXISTS is not supported for ALTER TABLE, so we use DO blocks)
DO $$
BEGIN
    -- Add value column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_settings' AND column_name = 'value') THEN
        ALTER TABLE marketing_settings ADD COLUMN value JSONB NOT NULL DEFAULT '{}';
    END IF;

    -- Add description column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_settings' AND column_name = 'description') THEN
        ALTER TABLE marketing_settings ADD COLUMN description TEXT;
    END IF;

    -- Add category column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_settings' AND column_name = 'category') THEN
        ALTER TABLE marketing_settings ADD COLUMN category TEXT DEFAULT 'general';
    END IF;

    -- Add is_secret column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_settings' AND column_name = 'is_secret') THEN
        ALTER TABLE marketing_settings ADD COLUMN is_secret BOOLEAN DEFAULT false;
    END IF;

    -- Add updated_by column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_settings' AND column_name = 'updated_by') THEN
        ALTER TABLE marketing_settings ADD COLUMN updated_by TEXT DEFAULT 'admin';
    END IF;

    -- Add updated_at column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_settings' AND column_name = 'updated_at') THEN
        ALTER TABLE marketing_settings ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
    END IF;

    -- Add created_at column if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'marketing_settings' AND column_name = 'created_at') THEN
        ALTER TABLE marketing_settings ADD COLUMN created_at TIMESTAMPTZ DEFAULT now();
    END IF;
END $$;

-- Create indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_ms_key ON marketing_settings(key);
CREATE INDEX IF NOT EXISTS idx_ms_category ON marketing_settings(category);

-- Insert default settings if they don't exist
INSERT INTO marketing_settings (key, value, description, category) VALUES
    ('marketing_enabled', '"true"', 'Master switch for all marketing features', 'general'),
    ('customer_sync_enabled', '"true"', 'Enable automatic customer sync from Shopify', 'general'),
    ('customer_sync_interval_hours', '"6"', 'Hours between automatic customer syncs', 'general'),
    
    ('whatsapp_enabled', '"false"', 'Enable WhatsApp messaging for marketing', 'whatsapp'),
    ('whatsapp_daily_message_limit', '"1000"', 'Daily message sending limit', 'whatsapp'),
    ('whatsapp_send_window_start', '"09:00"', 'Start of daily sending window (HH:MM)', 'whatsapp'),
    ('whatsapp_send_window_end', '"21:00"', 'End of daily sending window (HH:MM)', 'whatsapp'),
    ('whatsapp_batch_size', '"50"', 'Messages per batch during campaign send', 'whatsapp'),
    ('whatsapp_batch_delay_ms', '"2000"', 'Delay between batches in milliseconds', 'whatsapp'),
    
    ('campaign_default_language', '"en"', 'Default language for new templates', 'campaigns'),
    ('campaign_max_recipients', '"10000"', 'Maximum recipients per campaign', 'campaigns'),
    ('campaign_require_approval', '"true"', 'Require admin approval before sending', 'campaigns'),
    
    ('coupon_auto_sync_shopify', '"true"', 'Automatically sync new coupons to Shopify', 'coupons'),
    ('coupon_default_usage_limit', '"100"', 'Default usage limit for new coupons', 'coupons'),
    
    ('abandoned_cart_enabled', '"true"', 'Enable abandoned cart tracking', 'abandoned_cart'),
    ('abandoned_cart_auto_recovery', '"true"', 'Enable automatic recovery messages', 'abandoned_cart'),
    ('abandoned_cart_first_reminder_hours', '"1"', 'Hours after abandonment for first reminder', 'abandoned_cart'),
    ('abandoned_cart_second_reminder_hours', '"24"', 'Hours after first reminder for second reminder', 'abandoned_cart'),
    ('abandoned_cart_final_reminder_hours', '"72"', 'Hours after second reminder for final reminder', 'abandoned_cart'),
    ('abandoned_cart_expiry_days', '"7"', 'Days before cart entry expires', 'abandoned_cart'),
    ('abandoned_cart_recovery_coupon_enabled', '"false"', 'Auto-generate recovery coupons', 'abandoned_cart'),
    ('abandoned_cart_recovery_coupon_discount', '"10"', 'Recovery coupon discount percentage', 'abandoned_cart'),
    
    ('analytics_aggregation_enabled', '"true"', 'Enable daily analytics aggregation', 'analytics'),
    ('analytics_retention_days', '"365"', 'Days to retain daily analytics data', 'analytics')
ON CONFLICT (key) DO NOTHING;
