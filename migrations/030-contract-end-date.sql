-- Migration 030 — 2026-07-20
-- Date de fin de contrat par chauffeur : la masse salariale est calculée au
-- prorata des jours actifs dans le mois ([hire_date → contract_end_date] ∩ mois).
-- Idempotente.

ALTER TABLE fleet.profiles
  ADD COLUMN IF NOT EXISTS contract_end_date DATE;
