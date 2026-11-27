-- ============================================================================
-- Add the WhatsApp template name to the requests table
--
-- Motivation: the admin Request Details modal reports that a WhatsApp template
-- was sent (whatsapp_sent / whatsapp_message_id / whatsapp_sent_at) but never
-- recorded *which* template it was, so the UI could not display it.
--
-- whatsapp_template_name stores the Meta-approved template name used for the
-- most recent successful template send on that request:
--   'return_exchange_approved'  approval + handover-video instructions
--   'self_ship_required'        unserviceable pincode, customer must self-ship
--   'return_approved_discount'  compensation coupon + message
--   'store_credit_issued'       store-credit compensation message
-- NULL means no template send has been recorded for that row (every row that
-- predates this migration, plus free-form non-template notifications).
--
-- Additive only: no existing column is altered or dropped, no row is updated,
-- no data is backfilled or deleted. A nullable column with no DEFAULT is a
-- metadata-only change in Postgres - the table is never rewritten.
-- Safe to re-run.
-- ============================================================================
--
-- ⚠️  RUN THIS IN THE CORRECT PROJECT.
-- It must be the Supabase project this app's SUPABASE_URL points at - the one
-- that already holds public.requests with whatsapp_sent / whatsapp_message_id.
-- It is NOT the whatsappbot / Shoppers Hub project (SHOPPERHUB_DB_URL); that
-- database has no requests table and running this there fails with
-- "ERROR: 42P01: relation "requests" does not exist" and changes nothing.
--
-- STEP 0 - Preflight. Run this alone first. It must return a row with
-- table_schema = 'public' before you continue.
--
--   SELECT table_schema, table_name
--   FROM information_schema.tables
--   WHERE table_name = 'requests';
--
-- ============================================================================

-- Guard: abort with a clear message if this is the wrong database, so the
-- script can never half-run and so the reason is obvious in the Results pane.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'requests'
    ) THEN
        RAISE EXCEPTION
            'ABORTED: public.requests does not exist in this project. Switch the '
            'Supabase dashboard to the project referenced by the app SUPABASE_URL '
            '(the one whose public.requests already has whatsapp_sent) and re-run. '
            'Nothing was changed.';
    END IF;

    -- Same project sanity check: the sibling WhatsApp tracking columns that this
    -- feature builds on must already be present.
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'requests'
          AND column_name = 'whatsapp_sent'
    ) THEN
        RAISE EXCEPTION
            'ABORTED: public.requests exists but has no whatsapp_sent column, so '
            'this is not the return/exchange app database. Nothing was changed.';
    END IF;
END $$;

-- Fail fast rather than queue behind live traffic if the table is busy.
-- ADD COLUMN without a DEFAULT is metadata-only, so this window is milliseconds.
SET lock_timeout = '5s';

ALTER TABLE public.requests
ADD COLUMN IF NOT EXISTS whatsapp_template_name TEXT;

RESET lock_timeout;

COMMENT ON COLUMN public.requests.whatsapp_template_name IS
    'Meta WhatsApp template name used for the most recent successful template send '
    '(return_exchange_approved | self_ship_required | return_approved_discount | '
    'store_credit_issued). NULL = no template send recorded.';

-- ---------------------------------------------------------------------------
-- VERIFY 1 - the column now exists (must return exactly one row:
-- whatsapp_template_name | text | YES)
-- ---------------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'requests'
  AND column_name = 'whatsapp_template_name';

-- ---------------------------------------------------------------------------
-- VERIFY 2 - nothing went missing. Row counts must be unchanged from before
-- the run and total_rows > 0. rows_with_template will be 0 until new sends
-- happen; that is expected (history is intentionally left NULL).
-- ---------------------------------------------------------------------------
SELECT
    count(*)                                                        AS total_rows,
    count(*) FILTER (WHERE whatsapp_sent)                           AS rows_whatsapp_sent,
    count(*) FILTER (WHERE whatsapp_message_id IS NOT NULL)         AS rows_with_message_id,
    count(whatsapp_template_name)                                   AS rows_with_template_name
FROM public.requests;
