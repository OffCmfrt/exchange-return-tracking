-- Add WhatsApp template tracking columns to requests table
-- This allows us to track whether WhatsApp templates were sent successfully

ALTER TABLE requests
ADD COLUMN IF NOT EXISTS whatsapp_sent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT,
ADD COLUMN IF NOT EXISTS whatsapp_sent_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS whatsapp_error TEXT;

-- Add index for faster queries on WhatsApp status
CREATE INDEX IF NOT EXISTS idx_requests_whatsapp_sent ON requests(whatsapp_sent);
