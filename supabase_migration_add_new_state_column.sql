-- Add new_state column to requests table for complete shipping address
ALTER TABLE requests 
ADD COLUMN IF NOT EXISTS new_state TEXT;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_requests_new_state ON requests(new_state);

-- Add comment for documentation
COMMENT ON COLUMN requests.new_state IS 'State field for shipping address in exchange requests';
