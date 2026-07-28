-- Migration 033 — 2026-07-28
-- Couche IA V3 (AI Fleet OS) — 100% ADDITIVE.
-- Aucun ALTER sur les tables métier existantes. Tables préfixées ai_ dans le
-- schéma fleet. RLS alignée sur le pattern existant (fleet.current_tenant_id(),
-- cf. supabase-rls-tenant-isolation.sql). Idempotente.
--
-- Kill-switch : fleet.ai_settings.enabled (défaut FALSE → déployer cette
-- migration ne change RIEN au comportement de l'app tant que le superadmin
-- n'active pas la couche). L'env var AI_LAYER_ENABLED reste un master-off.

-- ── 0. Réglage global (une seule ligne) ──────────────────────────────
CREATE TABLE IF NOT EXISTS fleet.ai_settings (
  id          SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO fleet.ai_settings (id, enabled) VALUES (1, FALSE)
ON CONFLICT (id) DO NOTHING;

-- ── 1. Config par tenant ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet.ai_config (
  tenant_id          UUID PRIMARY KEY REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  rollout_stage      TEXT NOT NULL DEFAULT 'shadow'
                       CHECK (rollout_stage IN ('disabled','shadow','dogfood','general')),
  thresholds         JSONB NOT NULL DEFAULT '{
    "net_operationnel_delta_pct": -5,
    "carburant_km_delta_pct": 15,
    "taux_soumission_min_pct": 80
  }'::jsonb,
  llm_model_override TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Insights KPI ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet.ai_insights (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  kpi_name                TEXT NOT NULL
                            CHECK (kpi_name IN ('net_operationnel','carburant_km','taux_soumission')),
  period_start            DATE NOT NULL,
  period_end              DATE NOT NULL,
  current_value           NUMERIC NOT NULL,
  previous_value          NUMERIC NOT NULL,
  delta_value             NUMERIC NOT NULL,
  delta_pct               NUMERIC,                -- null si previous_value = 0
  causes                  JSONB NOT NULL DEFAULT '[]'::jsonb, -- KpiCause[]
  narrative_fr            TEXT,                   -- null si dégradé (LLM down)
  -- Métadonnées de fiabilité — ÉCRITURE UNIQUE (trigger de protection ci-dessous)
  computed_at             TIMESTAMPTZ NOT NULL,
  data_freshness_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score        NUMERIC(4,3) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  calculation_source      JSONB NOT NULL,         -- {function, version, params_hash}
  status                  TEXT NOT NULL DEFAULT 'unread'
                            CHECK (status IN ('unread','read','degraded')),
  expires_at              TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_tenant_kpi
  ON fleet.ai_insights (tenant_id, kpi_name, created_at DESC);

-- Un insight par tenant/KPI/période (relance batch = pas de doublon)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_insights_tenant_kpi_period
  ON fleet.ai_insights (tenant_id, kpi_name, period_start, period_end);

-- ── 3. Recommandations ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet.ai_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  driver_id       UUID REFERENCES fleet.profiles(id) ON DELETE SET NULL,
  rule_id         TEXT NOT NULL
                    CHECK (rule_id IN ('palier_a_risque','carburant_derive',
                                       'rapport_manquant','avance_solde_gonflee')),
  priority        TEXT NOT NULL CHECK (priority IN ('HIGH','MEDIUM','LOW')),
  impact_fcfa     BIGINT NOT NULL,
  title_fr        TEXT NOT NULL CHECK (char_length(title_fr) <= 200),
  detail_fr       TEXT,
  action_context  JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','expired','acted_on','ignored')),
  acted_at        TIMESTAMPTZ,
  computed_at     TIMESTAMPTZ NOT NULL,
  calculation_source JSONB NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_reco_tenant_status
  ON fleet.ai_recommendations (tenant_id, status, priority, created_at DESC);

-- Déduplication : une seule reco ACTIVE par tenant/chauffeur/règle/jour.
-- (index unique d'expression — une contrainte UNIQUE n'accepte pas d'expression)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_reco_active_per_day
  ON fleet.ai_recommendations (tenant_id, COALESCE(driver_id, tenant_id), rule_id, ((created_at AT TIME ZONE 'UTC')::date))
  WHERE status = 'active';

-- ── 4. Briefings quotidiens ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet.ai_briefings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  briefing_date           DATE NOT NULL,
  content_json            JSONB NOT NULL,   -- {narrative_fr|null, kpis[], chauffeurs[], projections{}, degraded_message_fr|null}
  status                  TEXT NOT NULL DEFAULT 'complete'
                            CHECK (status IN ('complete','degraded')),
  -- Écriture unique (sauf has_newer_data)
  computed_at             TIMESTAMPTZ NOT NULL,
  data_freshness_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence_score        NUMERIC(4,3) NOT NULL CHECK (confidence_score BETWEEN 0 AND 1),
  calculation_source      JSONB NOT NULL,
  has_newer_data          BOOLEAN NOT NULL DEFAULT FALSE,
  push_summary            TEXT CHECK (char_length(push_summary) <= 140),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_briefing_per_day
  ON fleet.ai_briefings (tenant_id, briefing_date);

CREATE INDEX IF NOT EXISTS idx_ai_briefings_tenant_date
  ON fleet.ai_briefings (tenant_id, briefing_date DESC);

-- ── 5. Protection écriture unique (trigger, pas de OLD. en policy RLS) ─
CREATE OR REPLACE FUNCTION fleet.ai_protect_write_once()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'ai_insights' THEN
    IF NEW.computed_at IS DISTINCT FROM OLD.computed_at
       OR NEW.causes IS DISTINCT FROM OLD.causes
       OR NEW.narrative_fr IS DISTINCT FROM OLD.narrative_fr
       OR NEW.confidence_score IS DISTINCT FROM OLD.confidence_score
       OR NEW.calculation_source IS DISTINCT FROM OLD.calculation_source
       OR NEW.data_freshness_snapshot IS DISTINCT FROM OLD.data_freshness_snapshot THEN
      RAISE EXCEPTION 'ai_insights: colonnes en écriture unique (seul status est modifiable)';
    END IF;
  ELSIF TG_TABLE_NAME = 'ai_briefings' THEN
    IF NEW.content_json IS DISTINCT FROM OLD.content_json
       OR NEW.computed_at IS DISTINCT FROM OLD.computed_at
       OR NEW.confidence_score IS DISTINCT FROM OLD.confidence_score
       OR NEW.calculation_source IS DISTINCT FROM OLD.calculation_source
       OR NEW.data_freshness_snapshot IS DISTINCT FROM OLD.data_freshness_snapshot THEN
      RAISE EXCEPTION 'ai_briefings: colonnes en écriture unique (seul has_newer_data/status est modifiable)';
    END IF;
  ELSIF TG_TABLE_NAME = 'ai_recommendations' THEN
    IF NEW.impact_fcfa IS DISTINCT FROM OLD.impact_fcfa
       OR NEW.computed_at IS DISTINCT FROM OLD.computed_at
       OR NEW.calculation_source IS DISTINCT FROM OLD.calculation_source THEN
      RAISE EXCEPTION 'ai_recommendations: colonnes en écriture unique (seul status/acted_at est modifiable)';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ai_insights_write_once ON fleet.ai_insights;
CREATE TRIGGER trg_ai_insights_write_once
  BEFORE UPDATE ON fleet.ai_insights
  FOR EACH ROW EXECUTE FUNCTION fleet.ai_protect_write_once();

DROP TRIGGER IF EXISTS trg_ai_briefings_write_once ON fleet.ai_briefings;
CREATE TRIGGER trg_ai_briefings_write_once
  BEFORE UPDATE ON fleet.ai_briefings
  FOR EACH ROW EXECUTE FUNCTION fleet.ai_protect_write_once();

DROP TRIGGER IF EXISTS trg_ai_reco_write_once ON fleet.ai_recommendations;
CREATE TRIGGER trg_ai_reco_write_once
  BEFORE UPDATE ON fleet.ai_recommendations
  FOR EACH ROW EXECUTE FUNCTION fleet.ai_protect_write_once();

-- ── 6. RLS — pattern existant fleet.current_tenant_id() ──────────────
ALTER TABLE fleet.ai_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.ai_config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.ai_insights        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.ai_briefings       ENABLE ROW LEVEL SECURITY;

-- ai_settings : aucune policy → invisible côté client (service_role uniquement)

DROP POLICY IF EXISTS ai_config_tenant_read ON fleet.ai_config;
CREATE POLICY ai_config_tenant_read ON fleet.ai_config
  FOR SELECT USING (tenant_id = fleet.current_tenant_id());

DROP POLICY IF EXISTS ai_insights_tenant_read ON fleet.ai_insights;
CREATE POLICY ai_insights_tenant_read ON fleet.ai_insights
  FOR SELECT USING (tenant_id = fleet.current_tenant_id());

DROP POLICY IF EXISTS ai_insights_tenant_status ON fleet.ai_insights;
CREATE POLICY ai_insights_tenant_status ON fleet.ai_insights
  FOR UPDATE USING (tenant_id = fleet.current_tenant_id())
  WITH CHECK (tenant_id = fleet.current_tenant_id());

DROP POLICY IF EXISTS ai_reco_tenant_read ON fleet.ai_recommendations;
CREATE POLICY ai_reco_tenant_read ON fleet.ai_recommendations
  FOR SELECT USING (tenant_id = fleet.current_tenant_id());

DROP POLICY IF EXISTS ai_reco_tenant_status ON fleet.ai_recommendations;
CREATE POLICY ai_reco_tenant_status ON fleet.ai_recommendations
  FOR UPDATE USING (tenant_id = fleet.current_tenant_id())
  WITH CHECK (tenant_id = fleet.current_tenant_id()
              AND status IN ('acted_on','ignored'));

DROP POLICY IF EXISTS ai_briefings_tenant_read ON fleet.ai_briefings;
CREATE POLICY ai_briefings_tenant_read ON fleet.ai_briefings
  FOR SELECT USING (tenant_id = fleet.current_tenant_id());

-- Note : les INSERT passent exclusivement par le service_role (batch serveur),
-- qui bypasse la RLS. Aucune policy INSERT côté client — c'est voulu.
