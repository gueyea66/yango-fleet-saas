-- ============================================================
-- MIGRATION 078 — SEGMENT (INTERNE / EXTERNE) CHOISI PAR CHAUFFEUR
--
-- Idempotente. Demande d'Abdou (04/10/2026) : « me permettre de choisir sur
-- l'admin qui est interne ou pas ».
--
-- Jusqu'ici le segment d'un chauffeur venait du véhicule : celui de la
-- déclaration, sinon celui qui lui est affecté, sinon « interne ». Un
-- chauffeur externe sans véhicule affecté (Badiane, Daouda Ngom chez NMK)
-- était donc classé interne dans les filtres.
--
-- profiles.fleet_segment :
--   NULL         → déduit du véhicule (comportement actuel, inchangé)
--   'interne'    → chauffeur de la flotte interne, quel que soit le véhicule
--   'partenaire' → chauffeur externe, quel que soit le véhicule
-- Le choix explicite l'emporte sur le véhicule dans les filtres, le menu
-- Performance et les rapports.
-- ============================================================

ALTER TABLE fleet.profiles ADD COLUMN IF NOT EXISTS fleet_segment TEXT;

ALTER TABLE fleet.profiles DROP CONSTRAINT IF EXISTS profiles_fleet_segment_check;
ALTER TABLE fleet.profiles ADD CONSTRAINT profiles_fleet_segment_check
  CHECK (fleet_segment IS NULL OR fleet_segment IN ('interne', 'partenaire'));

COMMENT ON COLUMN fleet.profiles.fleet_segment IS
  'Segment choisi par le gestionnaire : interne | partenaire. NULL = déduit du véhicule.';

-- Un chauffeur ne choisit pas son segment : réservé au gestionnaire et au serveur.
CREATE OR REPLACE FUNCTION fleet.guard_profile_segment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.fleet_segment IS DISTINCT FROM OLD.fleet_segment
     AND NOT (fleet.is_console_ou_serveur() OR fleet.is_admin()) THEN
    RAISE EXCEPTION 'RLS: segment du chauffeur — modification réservée au gestionnaire';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_profile_segment_upd ON fleet.profiles;
CREATE TRIGGER guard_profile_segment_upd BEFORE UPDATE OF fleet_segment ON fleet.profiles
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_profile_segment();

-- Contrôle
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'fleet' AND table_name = 'profiles' AND column_name = 'fleet_segment') AS colonne,
  (SELECT count(*) FROM pg_trigger
    WHERE tgrelid = 'fleet.profiles'::regclass AND tgname = 'guard_profile_segment_upd') AS garde;
