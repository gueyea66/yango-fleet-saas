-- Migration 035 — 2026-08-10
-- Mode d'interface par tenant : 'full' (défaut, UI actuelle intacte) | 'simple'
-- (vue épurée pour propriétaires non initiés : Accueil / Pilotage / Équipe,
-- le reste derrière une bascule « Mode avancé »). Additive et idempotente —
-- le défaut 'full' = comportement historique exact → zéro régression.

ALTER TABLE fleet.tenant_settings
  ADD COLUMN IF NOT EXISTS ui_mode text NOT NULL DEFAULT 'full';
