-- Migration 003: Salary advances tracking
-- Adds is_deducted flag on payments to track if an advance has been deducted from salary

ALTER TABLE yango.payments ADD COLUMN IF NOT EXISTS is_deducted BOOLEAN DEFAULT false;
ALTER TABLE yango.payments ADD COLUMN IF NOT EXISTS deducted_at DATE;
ALTER TABLE yango.payments ADD COLUMN IF NOT EXISTS deducted_from_payment_id UUID REFERENCES yango.payments(id);

-- Index for fast lookup of pending advances per driver
CREATE INDEX IF NOT EXISTS idx_payments_driver_acompte
  ON yango.payments(driver_id, type, is_deducted)
  WHERE type = 'acompte';
