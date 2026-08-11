-- Migration 038 — 2026-08-11
-- Libellé de plateforme par tenant : le mot « Yango » affiché dans l'UI
-- (Brut Yango, Solde Yango, Hors Yango…) devient configurable — indispensable
-- pour les prospects hors VTC (transport pur, logistique/TMS).
-- Additive et idempotente : défaut 'Yango' = affichage historique exact.
-- Ne touche QUE l'affichage : colonnes DB et catégories stockées inchangées.

ALTER TABLE fleet.tenant_settings
  ADD COLUMN IF NOT EXISTS platform_label text NOT NULL DEFAULT 'Yango';
