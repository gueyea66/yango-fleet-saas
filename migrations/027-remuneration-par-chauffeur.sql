-- Migration 027 — 2026-07-02
-- Modèle de rémunération et salaire de base réglables PAR CHAUFFEUR.
-- La grille de paliers, la commission % et le bonus restent au niveau tenant.
-- Null → repli sur remuneration_config du tenant. Idempotente.

ALTER TABLE fleet.profiles
  ADD COLUMN IF NOT EXISTS salary_model TEXT,     -- fixed | tiered | percent | hybrid | location (null → tenant)
  ADD COLUMN IF NOT EXISTS base_amount  NUMERIC;  -- salaire de base mensuel du chauffeur (null → tenant)
