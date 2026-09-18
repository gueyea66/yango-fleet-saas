-- ============================================================
-- MIGRATION 059 — PROFIL D'USAGE DU VÉHICULE
--
-- Idempotente. ADDITIVE.
--
-- Deux exploitations que tout oppose lisent les mêmes positions.
--
-- Une exploitation de MISSION — Gécamines, un camion qui part chargé et
-- revient — se pilote au trajet : d'où à où, en combien de temps, à quelle
-- vitesse. Le trajet EST l'unité de travail.
--
-- Une exploitation URBAINE — un VTC, un taxi — ne se pilote pas ainsi. Une
-- journée de taxi n'est pas une suite de missions : c'est une amplitude de
-- service ponctuée de trente arrêts clients. Compter les trajets n'y apprend
-- rien ; ce qui se pilote, ce sont les kilomètres de la journée, les heures en
-- service, le temps mort et la recette au kilomètre.
--
-- Le moteur d'inférence, lui, ne change pas : mêmes positions, mêmes trajets,
-- mêmes kilomètres. Seule LA LECTURE change. C'est délibéré — un chiffre ne
-- doit jamais dépendre de la manière dont on le regarde.
-- ============================================================

ALTER TABLE fleet.telematics_devices
  ADD COLUMN IF NOT EXISTS usage_profile TEXT NOT NULL DEFAULT 'mission';

-- Contrainte ajoutée à part : `ADD CONSTRAINT IF NOT EXISTS` n'existe pas sur
-- les contraintes de table, et une migration doit pouvoir être rejouée.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'telematics_devices_usage_profile_check'
  ) THEN
    ALTER TABLE fleet.telematics_devices
      ADD CONSTRAINT telematics_devices_usage_profile_check
      CHECK (usage_profile IN ('mission', 'urbain'));
  END IF;
END $$;

COMMENT ON COLUMN fleet.telematics_devices.usage_profile IS
  'Comment ce véhicule est exploité : mission (A→B, le trajet est l''unité) ou urbain (VTC/taxi, la journée de service est l''unité). Ne change aucun calcul, seulement la lecture.';
