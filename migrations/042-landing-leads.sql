-- Migration 042 — 2026-08-19
-- Table des contacts entrants depuis la landing page publique m3afleet.com
-- (formulaire "Demander une démonstration"). 100% additive, hors périmètre
-- multi-tenant : ce sont des prospects de M3A Group, pas des données d'un
-- tenant existant. Écritures exclusivement via service_role (route
-- /api/public/leads, rate-limitée) — aucune policy INSERT/UPDATE côté
-- client, RLS activée sans policy = deny-all pour la clé anon.

CREATE TABLE IF NOT EXISTS fleet.leads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  company      TEXT,
  phone        TEXT,
  email        TEXT,
  fleet_size   TEXT,
  message      TEXT,
  source       TEXT NOT NULL DEFAULT 'landing_m3afleet',
  ip           TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_created_at ON fleet.leads (created_at DESC);

ALTER TABLE fleet.leads ENABLE ROW LEVEL SECURITY;
-- Aucune policy : lecture/écriture réservées au service_role (dashboard
-- Supabase ou route API interne), la clé anon n'a accès à rien.
