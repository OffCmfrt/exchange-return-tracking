-- Add video evidence columns for pickup handover and warehouse unboxing
-- Customer uploads pickup video (showing product + pickup executive)
-- Warehouse uploads unboxing video (showing package condition on receipt)

ALTER TABLE requests ADD COLUMN IF NOT EXISTS pickup_video_url TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS pickup_video_submitted_at TIMESTAMPTZ;

ALTER TABLE requests ADD COLUMN IF NOT EXISTS unboxing_video_url TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS unboxing_video_submitted_at TIMESTAMPTZ;
