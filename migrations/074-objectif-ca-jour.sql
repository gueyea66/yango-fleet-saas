-- ════════════════════════════════════════════════════════════
-- 074 — Objectif de CA par jour et par chauffeur (Performance)
-- ════════════════════════════════════════════════════════════
-- Sert les codes couleur de Performance : journée atteinte (≥ objectif),
-- proche (≥ 80 %), sous (< 80 %). 40 000 XOF par défaut, réglable par
-- tenant depuis l'écran Tendances (admin du tenant uniquement, via l'API
-- service-role qui filtre tenant_id).
-- Idempotent. Sans cette migration, l'app utilise 40 000 XOF en lecture et
-- refuse l'enregistrement avec un message explicite.

ALTER TABLE fleet.remuneration_config
  ADD COLUMN IF NOT EXISTS objectif_ca_jour NUMERIC DEFAULT 40000
  CHECK (objectif_ca_jour IS NULL OR (objectif_ca_jour >= 1000 AND objectif_ca_jour <= 10000000));

COMMENT ON COLUMN fleet.remuneration_config.objectif_ca_jour IS
  'Objectif de CA (brut + bonus + hors Yango) par jour et par chauffeur, en devise du tenant. Codes couleur de Performance.';
