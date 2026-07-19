-- Migration 029 — 2026-07-19
-- Activation/désactivation des chauffeurs.
-- Un chauffeur désactivé ne peut plus se connecter, mais TOUTE sa production
-- passée (rapports, dépenses, paiements) reste intacte et visible.
-- Idempotente.

ALTER TABLE fleet.profiles
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_active
  ON fleet.profiles(tenant_id, active);
