-- Migration 062 — drapeau refonte UI v2
-- Même modèle que 037-ui-mode.sql : additive et idempotente.
-- Défaut false = UI actuelle strictement inchangée pour tous les tenants.
-- Aucune ligne existante n'est modifiée, aucune colonne supprimée ou renommée.

ALTER TABLE fleet.tenant_settings
  ADD COLUMN IF NOT EXISTS ui_v2 boolean NOT NULL DEFAULT false;

-- Activation (à faire à la main, tenant par tenant, APRÈS QA) :
--   UPDATE fleet.tenant_settings SET ui_v2 = true WHERE tenant_id = '<id>';
-- Retour arrière instantané :
--   UPDATE fleet.tenant_settings SET ui_v2 = false WHERE tenant_id = '<id>';
