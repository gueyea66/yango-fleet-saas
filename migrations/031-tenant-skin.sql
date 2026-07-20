-- Migration 031 — 2026-07-20
-- Skin par tenant (ambiance des surfaces : midnight | slate | graphite).
-- White-label : l'ACCENT reste primary_color, le skin ne change que les surfaces
-- et le texte (variables CSS --sk-*). Additif et idempotent — aucune perte de données.
-- Le rendu par défaut ('midnight') = valeurs historiques exactes → zéro régression.

ALTER TABLE fleet.tenant_settings
  ADD COLUMN IF NOT EXISTS skin text NOT NULL DEFAULT 'midnight';
