-- Migration 046 — 2026-09-01
-- Section « analyse » du rapport d'activité, produite par un système externe
-- (analyse multi-agents indépendante interfacée avec M3A Fleet).
--
-- Modèle PUSH volontaire : le système externe pousse son analyse quand elle est
-- prête, elle est stockée ici, et la génération du rapport la récupère si elle
-- existe. La génération ne dépend donc jamais de la disponibilité ni du temps de
-- réponse du système externe — un cron mensuel qui appellerait une API tierce en
-- synchrone échouerait au premier timeout.
--
-- Une analyse par (tenant, période, source) : republier écrase la précédente.
-- Idempotente.

CREATE TABLE IF NOT EXISTS fleet.report_analyses (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  date_from    DATE        NOT NULL,
  date_to      DATE        NOT NULL,
  source       TEXT        NOT NULL DEFAULT 'external',
  -- section  : fondue dans le rapport mensuel de la même période
  -- document : page autonome (deep dive, période hors rapport), déposée
  --            parmi les rapports du client
  kind         TEXT        NOT NULL DEFAULT 'section'
                 CHECK (kind IN ('section', 'document')),
  title        TEXT,
  subtitle     TEXT,
  summary      TEXT,
  blocks       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  model        TEXT,
  generated_at TIMESTAMPTZ,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_analyses_period CHECK (date_to >= date_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_report_analysis
  ON fleet.report_analyses(tenant_id, date_from, date_to, source);

CREATE INDEX IF NOT EXISTS idx_report_analyses_tenant
  ON fleet.report_analyses(tenant_id, date_from DESC);

-- Cohérent avec les autres tables métier : accès uniquement via service_role
-- (les routes serveur), jamais depuis le navigateur.
ALTER TABLE fleet.report_analyses DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE  fleet.report_analyses IS 'Analyses externes injectées dans le rapport d''activité. Alimentée par POST /api/integrations/report-analysis.';
COMMENT ON COLUMN fleet.report_analyses.blocks IS 'Blocs structurés (heading|paragraph|bullets|insight|kpis|table). Jamais de HTML brut : le contenu est échappé au rendu.';
COMMENT ON COLUMN fleet.report_analyses.kind IS 'section = injectee dans le rapport mensuel ; document = page autonome deposee dans le bucket des rapports.';
COMMENT ON COLUMN fleet.report_analyses.source IS 'Identifiant du producteur — permet plusieurs analyses distinctes sur une même période.';

-- Rejeu sur une table créée par une version antérieure de cette migration.
ALTER TABLE fleet.report_analyses
  ADD COLUMN IF NOT EXISTS kind     TEXT NOT NULL DEFAULT 'section',
  ADD COLUMN IF NOT EXISTS subtitle TEXT;
