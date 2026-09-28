-- ============================================================
-- MIGRATION 062 — SEGMENTATION DE FLOTTE (interne / partenaire)
--
-- Idempotente. Purement structurelle : deux colonnes nouvelles et une
-- contrainte assouplie. AUCUNE ligne n'est lue, modifiée ni supprimée.
--
-- Un parc Yango n'appartient pas forcément à un seul propriétaire. Chez NMK,
-- un même parc contient 8 véhicules à lui et 5 véhicules de tiers — dont deux
-- de M3A Solutions, hébergés chez lui contre 3 % du brut. Sans distinction en
-- base, le compte de résultat du client additionne les recettes de voitures
-- qui ne sont pas les siennes, et personne ne peut recouper quoi que ce soit.
--
--   • `fleet_segment` — 'interne' (le véhicule appartient à l'exploitant) ou
--     'partenaire' (il appartient à un tiers qui le confie au parc). Défaut
--     'interne' : c'est le cas de tous les véhicules déjà en base, dont ceux
--     de M3A dans son propre espace.
--   • `owner_name` — le propriétaire, en colonne. Il n'existait qu'en texte
--     libre dans `notes` (« Propriétaire : … »), donc illisible pour un filtre
--     ou un agrégat.
--
-- `driver_id` redevient nullable, et c'est le cœur du correctif : la colonne
-- était NOT NULL, donc **enregistrer un véhicule sans chauffeur échouait** —
-- or NMK en compte cinq (voitures à l'arrêt, ou en attente d'affectation).
-- Le ON DELETE CASCADE passe à SET NULL dans le même mouvement : un parc où
-- les chauffeurs tournent à ~12 %/mois ne peut pas perdre une voiture parce
-- que son conducteur a quitté l'entreprise.
--
-- Pas de reprise automatique de `owner_name` depuis `notes` : `fleet.vehicles`
-- est protégée par `guard_vehicles`, qui n'ouvre l'écriture qu'au service_role
-- ou à un gestionnaire connecté. Une migration n'est ni l'un ni l'autre, et
-- lui prêter ce rôle le temps d'un UPDATE affaiblirait le garde pour un
-- confort. Les six véhicules déjà en base gardent donc leur `notes` intacte et
-- prennent leur propriétaire au prochain enregistrement depuis l'application —
-- qui, lui, passe bien par le service_role.
-- ============================================================

/* ── 1. Les deux colonnes de segmentation ──────────────── */

ALTER TABLE fleet.vehicles
  ADD COLUMN IF NOT EXISTS fleet_segment TEXT NOT NULL DEFAULT 'interne',
  ADD COLUMN IF NOT EXISTS owner_name    TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_fleet_segment_check'
  ) THEN
    ALTER TABLE fleet.vehicles
      ADD CONSTRAINT vehicles_fleet_segment_check
      CHECK (fleet_segment IN ('interne', 'partenaire'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_segment
  ON fleet.vehicles(tenant_id, fleet_segment);

COMMENT ON COLUMN fleet.vehicles.fleet_segment IS
  'interne = véhicule de l''exploitant ; partenaire = véhicule d''un tiers hébergé dans le parc.';
COMMENT ON COLUMN fleet.vehicles.owner_name IS
  'Propriétaire du véhicule. Renseigné par la mise en service et par l''onglet Flotte.';

/* ── 2. Un véhicule peut ne pas avoir de chauffeur ─────── */

ALTER TABLE fleet.vehicles ALTER COLUMN driver_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vehicles_driver_id_fkey'
      AND confdeltype = 'c'          -- 'c' = CASCADE, ce qu'on ne veut plus
  ) THEN
    ALTER TABLE fleet.vehicles DROP CONSTRAINT vehicles_driver_id_fkey;
    ALTER TABLE fleet.vehicles
      ADD CONSTRAINT vehicles_driver_id_fkey
      FOREIGN KEY (driver_id) REFERENCES fleet.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;
