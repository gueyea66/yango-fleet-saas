-- ============================================================
-- RESTAURATION DU KIA K3 SUPPRIMÉ PAR CASCADE
-- (bug corrigé par migrations/045-fix-suppression-chauffeur-supprime-vehicule.sql)
--
-- À exécuter dans Supabase Dashboard > SQL Editor, APRÈS la migration 045.
--
-- Le véhicule a été effacé physiquement par le FK ON DELETE CASCADE au moment
-- de la suppression de son chauffeur : la ligne n'existe plus en base, il n'y
-- a donc rien à « réactiver ». Ce script la recrée.
--
-- 3 chemins, dans l'ordre de préférence :
--   A) restauration depuis la corbeille (suppressions POSTÉRIEURES à la 045)
--   B) restauration depuis un backup Supabase (données d'origine exactes)
--   C) recréation de la fiche (à utiliser si A et B sont indisponibles)
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- A) DEPUIS LA CORBEILLE — le cas normal à partir de maintenant
-- ────────────────────────────────────────────────────────────
-- Voir ce qui est récupérable :
--   SELECT plate, deleted_at, data->>'make' AS make, data->>'model' AS model
--     FROM fleet.vehicles_archive ORDER BY deleted_at DESC;
-- Restaurer :
--   SELECT fleet.restore_vehicle('LA-PLAQUE');
--
-- ⚠️ Le Kia K3 a été supprimé AVANT la mise en place de la corbeille : il n'y
-- sera pas. Ce chemin couvre toutes les suppressions futures.


-- ────────────────────────────────────────────────────────────
-- B) DEPUIS UN BACKUP SUPABASE — restitue les données exactes
--    (VIN, kilométrage, dates d'assurance / visite technique)
-- ────────────────────────────────────────────────────────────
-- Dashboard > Database > Backups : restaurer le point le plus récent
-- ANTÉRIEUR à la suppression du chauffeur, sur une branche / un projet de
-- restauration, puis y lire la ligne :
--
--   SELECT * FROM fleet.vehicles WHERE upper(model) LIKE '%K3%';
--
-- et rejouer l'INSERT du bloc C ci-dessous avec ces valeurs réelles.


-- ────────────────────────────────────────────────────────────
-- C) RECRÉATION DE LA FICHE
--    Renseigner la plaque (seule valeur obligatoire), compléter le reste
--    si connu, puis exécuter. Idempotent : ne crée rien si la plaque existe
--    déjà pour ce tenant.
-- ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_plate    TEXT := 'À_REMPLACER_PAR_LA_PLAQUE';  -- ⬅️ SEULE VALEUR OBLIGATOIRE
  v_tenant   UUID;
  v_make     TEXT := 'Kia';
  v_model    TEXT := 'K3';
  v_year     INT  := NULL;   -- ex: 2019
  v_color    TEXT := NULL;   -- ex: 'Gris'
  v_mileage  INT  := 0;
  v_vin      TEXT := NULL;
  v_new_id   UUID;
BEGIN
  IF v_plate = 'À_REMPLACER_PAR_LA_PLAQUE' THEN
    RAISE EXCEPTION 'Renseigne v_plate (plaque du Kia K3) avant d''exécuter ce script.';
  END IF;

  -- Tenant : unique en mono-tenant, sinon renseigner l'UUID en dur ci-dessous.
  SELECT id INTO v_tenant FROM fleet.tenants ORDER BY created_at LIMIT 1;
  IF (SELECT count(*) FROM fleet.tenants) > 1 THEN
    RAISE EXCEPTION 'Plusieurs tenants : remplace la ligne SELECT par le bon UUID de tenant.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM fleet.vehicles
     WHERE tenant_id = v_tenant AND upper(plate) = upper(v_plate)
  ) THEN
    RAISE NOTICE 'Véhicule % déjà présent — rien à faire.', v_plate;
    RETURN;
  END IF;

  INSERT INTO fleet.vehicles (tenant_id, plate, make, model, year, color, mileage, vin, status, driver_id)
  VALUES (v_tenant, upper(v_plate), v_make, v_model, v_year, v_color, v_mileage, v_vin, 'active', NULL)
  RETURNING id INTO v_new_id;

  RAISE NOTICE 'Kia K3 restauré (id=%, plaque=%), non assigné. Réassigne-le depuis Admin > Véhicules.', v_new_id, v_plate;
END $$;
