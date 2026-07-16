-- Migration: Influencer Messaging System
-- Created: 2026-06-01
-- Purpose: Add bidirectional messaging between admin and influencers with broadcast support

-- Create messages table
CREATE TABLE IF NOT EXISTS influencer_messages (
  id BIGSERIAL PRIMARY KEY,
  message_id VARCHAR(50) UNIQUE NOT NULL,
  sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('admin', 'influencer')),
  sender_id BIGINT REFERENCES influencers(id), -- NULL for admin, influencer.id for influencers
  recipient_type VARCHAR(20) NOT NULL CHECK (recipient_type IN ('admin', 'influencer', 'all')),
  recipient_id BIGINT, -- NULL for broadcast (all), influencer.id for specific
  subject VARCHAR(255),
  content TEXT NOT NULL,
  is_broadcast BOOLEAN DEFAULT FALSE,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_messages_sender ON influencer_messages(sender_type, sender_id);
CREATE INDEX idx_messages_recipient ON influencer_messages(recipient_type, recipient_id);
CREATE INDEX idx_messages_created ON influencer_messages(created_at DESC);
CREATE INDEX idx_messages_unread ON influencer_messages(is_read) WHERE is_read = FALSE;

-- Row Level Security
ALTER TABLE influencer_messages ENABLE ROW LEVEL SECURITY;

-- Admin can see all messages (via service role key in API)
-- Note: RLS policies below are for direct Supabase client access
-- API endpoints use service role key which bypasses RLS

-- Allow all operations for service role (used by API)
CREATE POLICY "Service role full access" ON influencer_messages
  FOR ALL USING (true) WITH CHECK (true);

-- For direct client access (if needed in future):
-- Influencers can view their own messages and broadcasts
CREATE POLICY "Influencer view messages" ON influencer_messages
  FOR SELECT
  USING (
    sender_type = 'influencer' OR
    recipient_type = 'influencer' OR
    is_broadcast = true
  );

-- Influencers can insert their own messages
CREATE POLICY "Influencer send messages" ON influencer_messages
  FOR INSERT
  WITH CHECK (sender_type = 'influencer');

-- Add helpful comments
COMMENT ON TABLE influencer_messages IS 'Messaging system for admin-influencer communication';
COMMENT ON COLUMN influencer_messages.sender_type IS 'Type of sender: admin or influencer';
COMMENT ON COLUMN influencer_messages.recipient_type IS 'Type of recipient: admin, influencer, or all (for broadcasts)';
COMMENT ON COLUMN influencer_messages.is_broadcast IS 'Whether this message was sent to all influencers';
