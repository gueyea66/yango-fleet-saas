-- ============================================================
-- MIGRATION 022 — TABLE AUDIT_LOGS
-- Traçabilité de toutes les actions sensibles.
-- À exécuter dans Supabase Dashboard > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS fleet.audit_logs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  user_id       UUID        REFERENCES fleet.profiles(id) ON DELETE SET NULL,
  action        TEXT        NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  changes       JSONB,
  ip_address    TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour les requêtes de consultation
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_date
  ON fleet.audit_logs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user
  ON fleet.audit_logs(user_id, created_at DESC);

-- RLS : chaque tenant ne voit que ses propres logs
ALTER TABLE fleet.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_logs: tenant only" ON fleet.audit_logs;

CREATE POLICY "audit_logs: tenant only" ON fleet.audit_logs
  FOR SELECT USING (tenant_id = fleet.current_tenant_id());

-- Commentaires
COMMENT ON TABLE fleet.audit_logs IS 'Journal des actions sensibles (création chauffeur, paiements, modifications config)';
COMMENT ON COLUMN fleet.audit_logs.action IS 'Ex: driver.create, driver.delete, payment.create, config.update';
COMMENT ON COLUMN fleet.audit_logs.changes IS 'Diff avant/après au format { before: {}, after: {} }';
