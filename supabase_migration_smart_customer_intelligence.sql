-- Add smart intelligence columns to marketing_customers
-- health_score: RFM-based score 0-100
-- churn_risk: low/medium/high/critical

ALTER TABLE marketing_customers
ADD COLUMN IF NOT EXISTS health_score INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS churn_risk TEXT DEFAULT 'low';

-- Add index for churn risk filtering
CREATE INDEX IF NOT EXISTS idx_marketing_customers_churn_risk ON marketing_customers(churn_risk);
CREATE INDEX IF NOT EXISTS idx_marketing_customers_health_score ON marketing_customers(health_score);
