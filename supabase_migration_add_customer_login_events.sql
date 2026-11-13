-- Customer login events (storefront phone-OTP logins)
-- Written by POST /api/auth/otp/send and /api/auth/otp/verify in server.js,
-- read by GET /api/internal/login-stats (support desk "Logins" card).
CREATE TABLE IF NOT EXISTS customer_login_events (
  id BIGSERIAL PRIMARY KEY,
  phone VARCHAR(20) NOT NULL,       -- normalized digits (10 or 12 leading-91), no +/spaces
  event_type VARCHAR(20) NOT NULL,  -- 'otp_sent' | 'login' | 'login_failed'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The stats endpoint always scans a recent time window, newest first.
CREATE INDEX IF NOT EXISTS idx_customer_login_events_created ON customer_login_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_login_events_phone ON customer_login_events (phone, created_at DESC);

ALTER TABLE customer_login_events ENABLE ROW LEVEL SECURITY;

-- The service_role key (used by this app's Supabase client) bypasses RLS, so
-- enabling RLS with no policies blocks anon/authenticated reads of phones.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'customer_login_events' AND policyname = 'Service role full access') THEN
    CREATE POLICY "Service role full access" ON customer_login_events
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

COMMENT ON TABLE customer_login_events IS 'Storefront OTP login audit: otp_sent / login / login_failed per phone, for the support desk login-activity card';
