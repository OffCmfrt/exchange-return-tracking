-- Fix Supabase Linter Security Warnings
-- =====================================

-- 1. Fix function_search_path_mutable for update_shipments_updated_at
CREATE OR REPLACE FUNCTION update_shipments_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- 2. Fix function_search_path_mutable for update_payouts_updated_at
CREATE OR REPLACE FUNCTION update_payouts_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- 3. Fix function_search_path_mutable for update_updated_at_column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- 4. Fix rls_policy_always_true on influencer_messages
-- Drop the overly permissive "Service role full access" policy.
-- service_role bypasses RLS by design, so this policy is unnecessary.
DROP POLICY IF EXISTS "Service role full access" ON influencer_messages;
