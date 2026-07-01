-- ============================================================
-- MIGRATION 023 — TABLE IMPORT_BATCHES
-- Import d'historique CSV : upload admin → vérification admin → injection superadmin
-- À exécuter dans Supabase Dashboard > SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS fleet.import_batches (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  created_by          UUID        NOT NULL,

  -- Statut du workflow
  -- pending_admin_review → admin_confirmed → injected | rejected
  status              TEXT        NOT NULL DEFAULT 'pending_admin_review'
                      CHECK (status IN ('pending_admin_review','admin_confirmed','injected','rejected')),

  -- Statistiques du fichier parsé
  row_count           INTEGER     DEFAULT 0,
  valid_count         INTEGER     DEFAULT 0,
  error_count         INTEGER     DEFAULT 0,
  duplicate_count     INTEGER     DEFAULT 0,

  -- Résumé métier (plage de dates, chauffeurs)
  date_from           DATE,
  date_to             DATE,
  drivers_found       TEXT[]      DEFAULT '{}',

  -- Données parsées et erreurs (stockées en JSONB pour flexibilité)
  parsed_rows         JSONB       DEFAULT '[]',
  validation_errors   JSONB       DEFAULT '[]',

  -- Notes admin lors de la confirmation
  admin_notes         TEXT,
  admin_confirmed_at  TIMESTAMPTZ,

  -- Injection superadmin
  injected_at         TIMESTAMPTZ,
  injected_by         UUID,
  injected_count      INTEGER     DEFAULT 0,

  -- Rejet superadmin
  rejected_at         TIMESTAMPTZ,
  reject_reason       TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour lookup par tenant + statut
CREATE INDEX IF NOT EXISTS idx_import_batches_tenant_status
  ON fleet.import_batches(tenant_id, status, created_at DESC);

-- Index superadmin : tous les imports en attente toutes flottes
CREATE INDEX IF NOT EXISTS idx_import_batches_status
  ON fleet.import_batches(status, created_at DESC);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION fleet.update_import_batches_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_import_batches_updated_at ON fleet.import_batches;
CREATE TRIGGER trg_import_batches_updated_at
  BEFORE UPDATE ON fleet.import_batches
  FOR EACH ROW EXECUTE FUNCTION fleet.update_import_batches_updated_at();

-- RLS : un admin ne voit que les imports de son tenant
ALTER TABLE fleet.import_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "import_batches: tenant only" ON fleet.import_batches;
CREATE POLICY "import_batches: tenant only" ON fleet.import_batches
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

COMMENT ON TABLE fleet.import_batches IS 'Batches d''import historique CSV — workflow admin (upload+verify) → superadmin (inject)';
COMMENT ON COLUMN fleet.import_batches.parsed_rows IS 'Array de { row, date, driver_id, driver_name, ca_brut, km, rides, fuel_cost, notes, is_duplicate }';
COMMENT ON COLUMN fleet.import_batches.validation_errors IS 'Array de { row, field, message }';
