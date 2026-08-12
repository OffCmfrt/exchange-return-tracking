-- Migration: store COD charges on return/exchange requests
-- COD orders carry a "COD Charges" shipping line (e.g. ₹99) which the customer
-- pays on delivery. It must count toward the amount actually paid, so the admin
-- panel and compensation coupon values reflect the true paid amount.
-- Run in the Supabase SQL editor.

ALTER TABLE requests
ADD COLUMN IF NOT EXISTS cod_charges numeric DEFAULT 0;
