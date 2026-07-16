-- Seed template_id settings for abandoned cart cron jobs
-- Run this in Supabase SQL Editor

INSERT INTO marketing_settings (key, value, description, category) VALUES
('abandoned_cart_first_template_id', '""', 'Template for 1st reminder (1hr after abandonment)', 'abandoned_cart'),
('abandoned_cart_second_template_id', '""', 'Template for 2nd reminder (24hr after 1st)', 'abandoned_cart'),
('abandoned_cart_final_template_id', '""', 'Template for final reminder (72hr after 2nd)', 'abandoned_cart'),
('abandoned_cart_first_reminder_enabled', '"true"', 'Enable first reminder (1hr after abandonment)', 'abandoned_cart'),
('abandoned_cart_second_reminder_enabled', '"true"', 'Enable second reminder (24hr after 1st)', 'abandoned_cart'),
('abandoned_cart_final_reminder_enabled', '"true"', 'Enable final reminder (72hr after 2nd)', 'abandoned_cart')
ON CONFLICT (key) DO NOTHING;
