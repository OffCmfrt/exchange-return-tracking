-- ============================================================================
-- INFLUENCER APPLICATIONS & PAYOUTS MIGRATION
-- ----------------------------------------------------------------------------
-- Adds self-signup application fields + payout ledger to support the public
-- /api/influencer/apply flow and the admin approve/reject + payout drawer.
-- ============================================================================

-- 1) Application status state machine on influencers
ALTER TABLE influencers
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS email TEXT,
    ADD COLUMN IF NOT EXISTS instagram_handle TEXT,
    ADD COLUMN IF NOT EXISTS youtube_handle TEXT,
    ADD COLUMN IF NOT EXISTS follower_count INTEGER,
    ADD COLUMN IF NOT EXISTS niche TEXT,
    ADD COLUMN IF NOT EXISTS city TEXT,
    ADD COLUMN IF NOT EXISTS why_join TEXT,
    ADD COLUMN IF NOT EXISTS payout_upi TEXT,
    ADD COLUMN IF NOT EXISTS payout_notes TEXT,
    ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Constrain status values
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'influencers_status_check'
    ) THEN
        ALTER TABLE influencers
            ADD CONSTRAINT influencers_status_check
            CHECK (status IN ('pending', 'active', 'suspended', 'rejected'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_influencers_status ON influencers(status);
CREATE INDEX IF NOT EXISTS idx_influencers_email ON influencers(LOWER(email));

-- 2) Influencer payouts ledger
CREATE TABLE IF NOT EXISTS influencer_payouts (
    id BIGSERIAL PRIMARY KEY,
    influencer_id INTEGER NOT NULL REFERENCES influencers(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'INR',
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'cancelled')),
    paid_at TIMESTAMPTZ,
    reference TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payouts_influencer ON influencer_payouts(influencer_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON influencer_payouts(status);
CREATE INDEX IF NOT EXISTS idx_payouts_period ON influencer_payouts(period_end DESC);
