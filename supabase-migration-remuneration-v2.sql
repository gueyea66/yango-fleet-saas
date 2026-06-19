-- Migration : remuneration_config v2 — modèles flexibles
-- À exécuter dans Supabase SQL Editor (fleet schema)

ALTER TABLE fleet.remuneration_config
  ADD COLUMN IF NOT EXISTS comm_yango    NUMERIC NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS comm_partner  NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS salary_tiers  JSONB   NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS target_net    NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daily_rent    NUMERIC NOT NULL DEFAULT 0;

-- Mettre à jour le modèle existant M3A avec les vraies valeurs
UPDATE fleet.remuneration_config SET
  model         = 'tiered',
  comm_yango    = 15,
  comm_partner  = 0.75,
  base_amount   = 200000,
  salary_tiers  = '[
    {"min_net": 0,       "total_salary": 200000, "label": "Base"},
    {"min_net": 1000000, "total_salary": 230000, "label": "Palier 1"},
    {"min_net": 1150000, "total_salary": 260000, "label": "Palier 2"},
    {"min_net": 1300000, "total_salary": 300000, "label": "Palier 3"}
  ]',
  target_net    = 1300000,
  daily_rent    = 0
WHERE tenant_id = (SELECT id FROM fleet.tenants WHERE slug = 'm3a');
