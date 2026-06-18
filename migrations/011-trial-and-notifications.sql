-- ============================================================
-- YANGO FLEET SAAS — Trial period + notification tracking
-- Run ONCE in Supabase SQL Editor
-- ============================================================

-- Add trial / expiry / notification columns
ALTER TABLE fleet.tenants ADD COLUMN IF NOT EXISTS trial_ends_at    TIMESTAMPTZ DEFAULT (now() + interval '30 days');
ALTER TABLE fleet.tenants ADD COLUMN IF NOT EXISTS plan_expires_at  TIMESTAMPTZ;
ALTER TABLE fleet.tenants ADD COLUMN IF NOT EXISTS notifications_sent JSONB DEFAULT '{}';

-- Set existing tenants to 30-day trial from today
UPDATE fleet.tenants SET trial_ends_at = now() + interval '30 days' WHERE trial_ends_at IS NULL;

-- Notification log table (audit trail per tenant)
CREATE TABLE IF NOT EXISTS fleet.notification_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  horizon     TEXT NOT NULL,   -- '14d' | '7d' | '3d' | '1d' | 'expired'
  channel     TEXT NOT NULL DEFAULT 'in_app',  -- 'in_app' | 'email' | 'sms'
  sent_at     TIMESTAMPTZ DEFAULT now(),
  message     TEXT
);

ALTER TABLE fleet.notification_log DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON fleet.notification_log TO anon, authenticated;
