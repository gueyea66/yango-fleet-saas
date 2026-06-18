-- Migration : status sur expenses + table action_logs
-- À exécuter dans Supabase SQL Editor (projet yango-fleet-saas)

-- 1. Colonne status sur expenses (cause du crash "Could not find 'status' column")
ALTER TABLE fleet.expenses ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'submitted';
-- Marquer les anciennes dépenses comme approuvées (elles étaient comptées avant)
UPDATE fleet.expenses SET status = 'approved' WHERE status = 'submitted' AND created_at < NOW() - INTERVAL '1 day';

-- 2. Table de log des actions
CREATE TABLE IF NOT EXISTS fleet.action_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  actor_id    UUID,
  actor_role  TEXT,                    -- 'admin' | 'driver'
  entity_type TEXT        NOT NULL,    -- 'daily_report' | 'expense'
  entity_id   UUID        NOT NULL,
  action      TEXT        NOT NULL,    -- 'submitted' | 'approved' | 'rejected' | 'edited'
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_action_logs_entity   ON fleet.action_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_tenant   ON fleet.action_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_created  ON fleet.action_logs(created_at DESC);

-- 3. Index pour filtrage par status sur expenses
CREATE INDEX IF NOT EXISTS idx_expenses_status ON fleet.expenses(status);
