-- Migration 026 — 2026-07-02
-- Colonnes pour : commissions par chauffeur, service supplémentaire,
-- solde initial, prorata salaire, taux Yango par véhicule.
-- Voir docs/SPEC-CALCULS.md. Idempotente.

-- ── Taux commission & rému par chauffeur ──────────────────────
ALTER TABLE fleet.profiles
  ADD COLUMN IF NOT EXISTS comm_yango     NUMERIC,   -- % Yango (null → fallback véhicule/tenant)
  ADD COLUMN IF NOT EXISTS comm_partner   NUMERIC,   -- % partenaire (null → fallback)
  ADD COLUMN IF NOT EXISTS hire_date      DATE,      -- date d'entrée (prorata salaire)
  ADD COLUMN IF NOT EXISTS solde_initial  NUMERIC;   -- solde wallet de départ

-- ── Taux Yango par véhicule (partner_rate existe déjà) ────────
ALTER TABLE fleet.vehicles
  ADD COLUMN IF NOT EXISTS yango_rate     NUMERIC;   -- % Yango par véhicule (défaut/prévision)

-- ── Charge de commission Yango additionnelle, saisie ──────────
ALTER TABLE fleet.daily_reports
  ADD COLUMN IF NOT EXISTS service_supplementaire NUMERIC NOT NULL DEFAULT 0;

-- vehicle_id existe déjà sur daily_reports (rappel : à renseigner systématiquement).
