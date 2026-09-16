-- ============================================================
-- MIGRATION 052 — LES GARDES NE DOIVENT PAS ENFERMER L'ADMINISTRATEUR
--
-- Idempotente.
--
-- Constaté en conditions réelles le 16/09/2026 : les gardes des 049/051
-- n'autorisent que `service_role`. Or le SQL Editor du dashboard (et l'API de
-- gestion) s'exécutent en tant que `postgres`. Conséquence : plus aucune
-- maintenance possible — ni purge de rétention, ni correction d'un calcul
-- erroné, ni retrait de données de démonstration, y compris pour le
-- propriétaire de la base.
--
-- Règle corrigée : le propriétaire de la base est autorisé au même titre que
-- le serveur de calcul. Cela ne change RIEN pour les utilisateurs de
-- l'application — chauffeurs et administrateurs passent par la clé anon et
-- restent bloqués exactement comme avant.
-- ============================================================

CREATE OR REPLACE FUNCTION fleet.is_db_owner()
RETURNS boolean LANGUAGE sql STABLE
SET search_path = ''
AS $$ SELECT session_user IN ('postgres', 'supabase_admin') $$;

-- ── Positions : réécriture interdite à tous, suppression pour maintenance ──
CREATE OR REPLACE FUNCTION fleet.guard_telematics_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'telematics_positions : une position ne se réécrit jamais';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF fleet.is_trusted_server() OR fleet.is_db_owner() THEN
      RETURN OLD;  -- rétention, ou retrait de données de démonstration
    END IF;
    RAISE EXCEPTION 'telematics_positions : suppression réservée au serveur';
  END IF;

  RETURN NEW;
END $$;

-- ── Données dérivées : produites par le calcul, réparables par l'admin ────
CREATE OR REPLACE FUNCTION fleet.guard_telematics_derived()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() OR fleet.is_db_owner() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'donnée dérivée : écriture réservée au serveur de calcul';
END $$;
