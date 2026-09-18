-- ============================================================
-- MIGRATION 058 — TRAJET ENCORE EN COURS
--
-- Idempotente. ADDITIVE.
--
-- Avec un recalcul toutes les heures, la plupart des calculs tombent pendant
-- qu'un véhicule roule : son trajet n'a pas d'arrivée. Sans marque, l'écran
-- afficherait « arrivé à 14h32 » alors que le camion est sur la route, et un
-- gestionnaire prendrait une décision sur une arrivée qui n'a pas eu lieu.
--
-- Pour un trajet en cours, l'heure et le lieu de fin sont ceux du DERNIER
-- POINT CONNU. L'écran doit le dire explicitement.
-- ============================================================

ALTER TABLE fleet.telematics_trips
  ADD COLUMN IF NOT EXISTS en_cours BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN fleet.telematics_trips.en_cours IS
  'Trajet non terminé au moment du calcul : la fin est le dernier point connu, pas une arrivée.';

CREATE INDEX IF NOT EXISTS idx_telematics_trips_en_cours
  ON fleet.telematics_trips(tenant_id, vehicle_id) WHERE en_cours;
