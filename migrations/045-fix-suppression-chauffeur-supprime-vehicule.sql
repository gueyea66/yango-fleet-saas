-- Migration 045 — 2026-08-31
-- BUG PROD : supprimer un chauffeur supprimait aussi SON VÉHICULE (constaté
-- sur le Kia K3 : le chauffeur assigné a été supprimé, le véhicule a disparu
-- de l'onglet « Véhicules » sans que personne ne l'ait supprimé).
--
-- Cause : fleet.vehicles.driver_id est un FK vers fleet.profiles(id) déclaré
-- ON DELETE CASCADE (hérité de sql/schema.sql, schéma mono-tenant d'origine).
-- Le véhicule est un ACTIF DE LA FLOTTE, il appartient au tenant — pas au
-- chauffeur. Supprimer le chauffeur ne doit que le désassigner.
-- Même problème sur fleet.daily_reports.vehicle_id : supprimer un véhicule
-- effaçait l'historique financier qui le référence.
--
-- Ce que fait cette migration :
--   1. driver_id devient nullable (un véhicule sans chauffeur est légitime)
--   2. le FK passe en ON DELETE SET NULL → le véhicule survit, désassigné
--   3. daily_reports.vehicle_id passe aussi en ON DELETE SET NULL
--   4. filet de sécurité : toute suppression de véhicule est archivée dans
--      fleet.vehicles_archive (corbeille) + fonction de restauration
--
-- Idempotente : rejouable sans effet de bord.

-- ────────────────────────────────────────────────────────────────
-- 1 + 2. fleet.vehicles.driver_id : nullable + ON DELETE SET NULL
-- ────────────────────────────────────────────────────────────────

ALTER TABLE fleet.vehicles ALTER COLUMN driver_id DROP NOT NULL;

DO $$
DECLARE
  c RECORD;
BEGIN
  -- Le nom de la contrainte varie selon l'historique du projet
  -- (vehicles_driver_id_fkey en général) : on cible par colonne, pas par nom.
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class     rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'fleet'
       AND rel.relname = 'vehicles'
       AND con.contype = 'f'
       AND con.conkey  = ARRAY[(
             SELECT attnum FROM pg_attribute
              WHERE attrelid = rel.oid AND attname = 'driver_id'
           )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE fleet.vehicles DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE fleet.vehicles
  ADD CONSTRAINT vehicles_driver_id_fkey
  FOREIGN KEY (driver_id) REFERENCES fleet.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_driver ON fleet.vehicles(driver_id);

-- ────────────────────────────────────────────────────────────────
-- 3. fleet.daily_reports.vehicle_id : nullable + ON DELETE SET NULL
--    (supprimer un véhicule ne doit jamais effacer les rapports)
-- ────────────────────────────────────────────────────────────────

DO $$
DECLARE
  c RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'fleet' AND table_name = 'daily_reports'
       AND column_name = 'vehicle_id'
  ) THEN
    EXECUTE 'ALTER TABLE fleet.daily_reports ALTER COLUMN vehicle_id DROP NOT NULL';

    FOR c IN
      SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class     rel ON rel.oid = con.conrelid
        JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE nsp.nspname = 'fleet'
         AND rel.relname = 'daily_reports'
         AND con.contype = 'f'
         AND con.conkey  = ARRAY[(
               SELECT attnum FROM pg_attribute
                WHERE attrelid = rel.oid AND attname = 'vehicle_id'
             )]::smallint[]
    LOOP
      EXECUTE format('ALTER TABLE fleet.daily_reports DROP CONSTRAINT %I', c.conname);
    END LOOP;

    EXECUTE 'ALTER TABLE fleet.daily_reports
               ADD CONSTRAINT daily_reports_vehicle_id_fkey
               FOREIGN KEY (vehicle_id) REFERENCES fleet.vehicles(id) ON DELETE SET NULL';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────
-- 4. Corbeille : archivage automatique de tout véhicule supprimé
--    Aucune suppression de véhicule n'est plus définitive.
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS fleet.vehicles_archive (
  archive_id   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_by   UUID,
  vehicle_id   UUID        NOT NULL,
  tenant_id    UUID,
  plate        TEXT,
  data         JSONB       NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vehicles_archive_tenant
  ON fleet.vehicles_archive(tenant_id, deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_vehicles_archive_plate
  ON fleet.vehicles_archive(plate);

ALTER TABLE fleet.vehicles_archive DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION fleet.archive_deleted_vehicle()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fleet, public
AS $$
BEGIN
  INSERT INTO fleet.vehicles_archive (deleted_by, vehicle_id, tenant_id, plate, data)
  VALUES (auth.uid(), OLD.id, OLD.tenant_id, OLD.plate, to_jsonb(OLD));
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  -- L'archivage ne doit jamais bloquer une suppression volontaire.
  INSERT INTO fleet.vehicles_archive (vehicle_id, tenant_id, plate, data)
  VALUES (OLD.id, OLD.tenant_id, OLD.plate, to_jsonb(OLD));
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_archive_deleted_vehicle ON fleet.vehicles;
CREATE TRIGGER trg_archive_deleted_vehicle
  BEFORE DELETE ON fleet.vehicles
  FOR EACH ROW EXECUTE FUNCTION fleet.archive_deleted_vehicle();

-- Restauration : fleet.restore_vehicle('AA-123-BB')
-- Réinsère le véhicule tel qu'il était, désassigné de son chauffeur si
-- celui-ci n'existe plus. Retourne l'id du véhicule restauré.
CREATE OR REPLACE FUNCTION fleet.restore_vehicle(p_plate TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fleet, public
AS $$
DECLARE
  a       fleet.vehicles_archive%ROWTYPE;
  payload JSONB;
BEGIN
  SELECT * INTO a
    FROM fleet.vehicles_archive
   WHERE upper(plate) = upper(p_plate)
   ORDER BY deleted_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aucun véhicule archivé avec la plaque %', p_plate;
  END IF;

  IF EXISTS (SELECT 1 FROM fleet.vehicles WHERE id = a.vehicle_id) THEN
    RETURN a.vehicle_id; -- déjà restauré
  END IF;

  payload := a.data;

  -- Le chauffeur assigné a pu être supprimé entre-temps : on désassigne.
  IF payload->>'driver_id' IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM fleet.profiles WHERE id = (payload->>'driver_id')::uuid)
  THEN
    payload := jsonb_set(payload, '{driver_id}', 'null'::jsonb);
  END IF;

  INSERT INTO fleet.vehicles
  SELECT * FROM jsonb_populate_record(NULL::fleet.vehicles, payload);

  DELETE FROM fleet.vehicles_archive WHERE archive_id = a.archive_id;
  RETURN a.vehicle_id;
END $$;

COMMENT ON TABLE  fleet.vehicles_archive IS 'Corbeille véhicules : toute ligne supprimée de fleet.vehicles y est copiée (trigger). Restauration : SELECT fleet.restore_vehicle(''PLAQUE'');';
COMMENT ON COLUMN fleet.vehicles.driver_id IS 'Chauffeur assigné, NULL si le véhicule est libre. ON DELETE SET NULL : supprimer un chauffeur ne supprime jamais son véhicule (migration 045).';
