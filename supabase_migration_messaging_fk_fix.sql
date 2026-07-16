-- Migration: Add Foreign Key to influencer_messages
-- Created: 2026-06-02
-- Purpose: Fix PGRST200 error - Add FK relationship between influencer_messages and influencers
-- Issue: Supabase PostgREST cannot find relationship for table joins

-- Check if foreign key constraint exists before adding it
DO $$ 
BEGIN
  -- Check if constraint doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fk_influencer_messages_sender'
  ) THEN
    -- Add foreign key constraint on sender_id
    -- This allows Supabase to automatically infer the relationship for JOIN queries
    ALTER TABLE influencer_messages
      ADD CONSTRAINT fk_influencer_messages_sender
      FOREIGN KEY (sender_id)
      REFERENCES influencers(id)
      ON DELETE SET NULL;
    
    RAISE NOTICE '✅ Foreign key constraint added successfully';
  ELSE
    RAISE NOTICE '⚠️  Foreign key constraint already exists, skipping';
  END IF;
END $$;

-- Verify the constraint was added
SELECT 
  conname AS constraint_name,
  conrelid::regclass AS table_name,
  confrelid::regclass AS references_table
FROM pg_constraint
WHERE conname = 'fk_influencer_messages_sender';
