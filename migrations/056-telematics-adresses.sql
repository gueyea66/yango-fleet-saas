-- ============================================================
-- MIGRATION 056 — LIEUX DE DÉPART ET D'ARRIVÉE DES TRAJETS
--
-- Idempotente. ADDITIVE.
--
-- Un trajet « 07:03 → 09:13, 124 km » ne se lit pas : il faut savoir d'où à
-- où. Les coordonnées ne sont pas une réponse pour un gestionnaire.
--
-- Deux origines possibles pour une adresse :
--   • l'export du fournisseur, qui la fournit déjà (SinoTrack la donne) ;
--   • le géocodage inverse des coordonnées de début et de fin.
-- `address_source` dit laquelle, pour qu'une adresse approximative ne soit
-- jamais prise pour une donnée du boîtier.
--
-- Le cache est indispensable : sans lui, chaque affichage d'un trajet
-- relancerait un appel réseau, et les fournisseurs de géocodage limitent
-- strictement le débit. Les coordonnées y sont arrondies à 4 décimales
-- (environ 11 m), ce qui regroupe les arrêts répétés au même endroit.
-- ============================================================

ALTER TABLE fleet.telematics_trips
  ADD COLUMN IF NOT EXISTS start_address  TEXT,
  ADD COLUMN IF NOT EXISTS end_address    TEXT,
  ADD COLUMN IF NOT EXISTS address_source TEXT;

COMMENT ON COLUMN fleet.telematics_trips.address_source IS
  'import = fourni par la plateforme d''origine · nominatim = géocodage inverse OpenStreetMap';

CREATE TABLE IF NOT EXISTS fleet.geocode_cache (
  lat        NUMERIC(8,4) NOT NULL,
  lon        NUMERIC(9,4) NOT NULL,
  label      TEXT NOT NULL,
  provider   TEXT NOT NULL,
  raw        JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lat, lon)
);

COMMENT ON TABLE fleet.geocode_cache IS
  'Adresses déjà résolues, partagées par tous les tenants : un carrefour de Dakar
   est le même pour tout le monde, et les fournisseurs limitent le débit.';

-- Aucune donnée client ici (ni tenant, ni véhicule) : pas de RLS par tenant.
-- Lecture serveur uniquement — les écrans reçoivent les adresses déjà jointes.
ALTER TABLE fleet.geocode_cache ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON fleet.geocode_cache TO service_role;
