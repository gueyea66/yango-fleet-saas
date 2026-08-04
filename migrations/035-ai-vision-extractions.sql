-- Migration 035 — 2026-08-04
-- Extraction vision des déclarations chauffeur (spec Panthéon 04/08/2026).
-- 100% ADDITIVE : aucun ALTER sur les tables métier ni sur les tables ai_
-- existantes (033/034). Deux nouvelles tables préfixées ai_ dans le schéma
-- fleet. RLS alignée sur fleet.current_tenant_id(). Idempotente.
--
-- Kill-switch : réutilise les 3 étages EXISTANTS (env AI_LAYER_ENABLED,
-- fleet.ai_settings.enabled défaut FALSE, fleet.ai_config.rollout_stage).
-- Déployer cette migration ne change RIEN au comportement de l'app.

-- ── 1. fleet.ai_extractions — extractions vision proposées + validées ──
-- Sensibilité HAUTE (données financières chauffeur) : policies driver_own
-- + admin_tenant, 4 scénarios RLS couverts par les tests.
CREATE TABLE IF NOT EXISTS fleet.ai_extractions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  driver_id              UUID NOT NULL REFERENCES fleet.profiles(id) ON DELETE CASCADE,
  date_ref               DATE NOT NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','completed','failed','validated')),
  model_used             TEXT NOT NULL,
  proposed_values        JSONB NOT NULL,   -- {end_odometer, yango_gross, yango_bonus, solde_yango, yango_trip_count} — null = non lu
  field_level_confidence JSONB NOT NULL,   -- mêmes clés, scores [0,1]
  validated_values       JSONB,            -- valeurs finales validées par le chauffeur (feedback loop précision)
  correction_delta       JSONB,            -- {champ: {proposed, validated}} — mesure de la précision réelle
  coherence_alerts       JSONB,            -- [{field, type, message}] — alertes déterministes (jamais LLM)
  fallback_triggered     BOOLEAN NOT NULL DEFAULT FALSE,
  extraction_duration_ms INTEGER,
  source_type            TEXT CHECK (source_type IN
                           ('yango_pro_screenshot','odometer_photo','mixed','unknown')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  validated_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ai_extractions_tenant_driver
  ON fleet.ai_extractions (tenant_id, driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_extractions_date
  ON fleet.ai_extractions (tenant_id, date_ref);
-- Quota mensuel : COUNT par tenant sur le mois courant
CREATE INDEX IF NOT EXISTS idx_ai_extractions_tenant_created
  ON fleet.ai_extractions (tenant_id, created_at);

-- ── 2. fleet.ai_uploads_ref — images sources d'une extraction ─────────
-- Rattache des fichiers Storage uploadés AVANT la création du rapport,
-- sans toucher fleet.uploads (ref_id y suppose un rapport existant).
CREATE TABLE IF NOT EXISTS fleet.ai_uploads_ref (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  driver_id     UUID NOT NULL REFERENCES fleet.profiles(id) ON DELETE CASCADE,
  extraction_id UUID REFERENCES fleet.ai_extractions(id) ON DELETE SET NULL,
  date_ref      DATE NOT NULL,
  storage_path  TEXT NOT NULL,   -- chemin bucket kyc-documents (privé, signed URL only)
  file_size     INTEGER,
  mime_type     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_uploads_ref_extraction
  ON fleet.ai_uploads_ref (extraction_id);
CREATE INDEX IF NOT EXISTS idx_ai_uploads_ref_tenant_driver
  ON fleet.ai_uploads_ref (tenant_id, driver_id, date_ref);

-- ── 3. RLS — pattern existant fleet.current_tenant_id() ───────────────
ALTER TABLE fleet.ai_extractions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.ai_uploads_ref ENABLE ROW LEVEL SECURITY;

-- Chauffeur : uniquement ses propres extractions, dans son tenant
DROP POLICY IF EXISTS ai_extractions_driver_own ON fleet.ai_extractions;
CREATE POLICY ai_extractions_driver_own ON fleet.ai_extractions
  FOR SELECT USING (
    tenant_id = fleet.current_tenant_id()
    AND driver_id = auth.uid()
  );

-- Admin : toutes les extractions de son tenant
DROP POLICY IF EXISTS ai_extractions_admin_tenant ON fleet.ai_extractions;
CREATE POLICY ai_extractions_admin_tenant ON fleet.ai_extractions
  FOR SELECT USING (
    tenant_id = fleet.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM fleet.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS ai_uploads_ref_driver_own ON fleet.ai_uploads_ref;
CREATE POLICY ai_uploads_ref_driver_own ON fleet.ai_uploads_ref
  FOR SELECT USING (
    tenant_id = fleet.current_tenant_id()
    AND driver_id = auth.uid()
  );

DROP POLICY IF EXISTS ai_uploads_ref_admin_tenant ON fleet.ai_uploads_ref;
CREATE POLICY ai_uploads_ref_admin_tenant ON fleet.ai_uploads_ref
  FOR SELECT USING (
    tenant_id = fleet.current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM fleet.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Note : les INSERT/UPDATE passent exclusivement par le service_role
-- (routes /api/ai/*, guards + kill-switch), qui bypasse la RLS.
-- Aucune policy INSERT/UPDATE côté client — c'est voulu.
