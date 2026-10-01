-- ============================================================
-- MIGRATION 073 — FLEETROOM ↔ DÉCLARATIONS CHAUFFEUR EN COURS
--
-- Idempotente. Complète la 072 sur deux cas de double déclaration :
--
-- 1. Import Fleetroom APRÈS une déclaration chauffeur non encore validée
--    (brouillon / soumise) : la 072 ne regardait que les déclarations
--    approuvées et créait une 2e déclaration approuvée à côté. Désormais
--    toute déclaration non rejetée compte : écart consigné, rien créé.
--
-- 2. Validation d'une déclaration chauffeur APRÈS l'import Fleetroom du même
--    jour : l'index uq_daily_reports_one_approved_per_day faisait échouer la
--    validation. Désormais la validation humaine passe, la déclaration
--    Fleetroom du jour est retirée (le brut reste dans yango_*, rien n'est
--    perdu) et l'écart est consigné dans fleetroom_conflicts. « Prendre
--    Yango » dans l'onglet Import Fleetroom rétablit la version Fleetroom.
-- ============================================================

-- ── 1. fleetroom_rebuild : toute déclaration non rejetée compte ──
DO $$
DECLARE src TEXT;
BEGIN
  SELECT pg_get_functiondef('fleet.fleetroom_rebuild(uuid,date,date)'::regprocedure) INTO src;
  -- écarts : déclaration chauffeur existante quel que soit son statut (hors rejet)
  src := replace(src,
    $a$AND d.status = 'approved' AND COALESCE(d.source, '') <> 'fleetroom'$a$,
    $a$AND d.status <> 'rejected' AND COALESCE(d.source, '') <> 'fleetroom'$a$);
  -- création : seulement si aucune déclaration non rejetée n'existe ce jour-là
  src := replace(src,
    $a$AND d.driver_id = f.driver_id AND d.date = f.jour AND d.status = 'approved');$a$,
    $a$AND d.driver_id = f.driver_id AND d.date = f.jour AND d.status <> 'rejected');$a$);
  IF position($a$d.status <> 'rejected' AND COALESCE$a$ IN src) = 0
     OR position($a$d.date = f.jour AND d.status <> 'rejected');$a$ IN src) = 0 THEN
    RAISE EXCEPTION 'fleetroom_rebuild : définition inattendue, migration 073 non appliquée';
  END IF;
  EXECUTE src;
END $$;

-- ── 2. Validation humaine après import Fleetroom ──
CREATE OR REPLACE FUNCTION fleet.fleetroom_yield_to_declaration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = fleet, public
AS $$
DECLARE fr RECORD;
BEGIN
  IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved')
     AND COALESCE(NEW.source, '') <> 'fleetroom' THEN
    SELECT * INTO fr FROM daily_reports
     WHERE tenant_id = NEW.tenant_id AND driver_id = NEW.driver_id AND date = NEW.date
       AND status = 'approved' AND source = 'fleetroom' AND id <> NEW.id;
    IF FOUND THEN
      DELETE FROM daily_reports WHERE id = fr.id;
      INSERT INTO fleetroom_conflicts (tenant_id, driver_id, jour, report_id, declared, fleetroom, resolved, updated_at)
      -- en BEFORE INSERT la ligne n'existe pas encore : pas de report_id (FK)
      VALUES (NEW.tenant_id, NEW.driver_id, NEW.date, CASE WHEN TG_OP = 'UPDATE' THEN NEW.id END,
        jsonb_build_object('especes', NEW.yango_cash, 'carte', NEW.yango_card, 'brut', NEW.yango_gross,
                           'courses', NEW.yango_trip_count, 'solde', NEW.solde_yango, 'source', NEW.source),
        jsonb_build_object('especes', fr.yango_cash, 'carte', fr.yango_card, 'brut', fr.yango_gross,
                           'courses', fr.yango_trip_count, 'solde', fr.solde_yango),
        false, now())
      ON CONFLICT (tenant_id, driver_id, jour) DO UPDATE
        SET report_id = EXCLUDED.report_id, declared = EXCLUDED.declared,
            fleetroom = EXCLUDED.fleetroom, resolved = false, updated_at = now();
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_fleetroom_yield ON fleet.daily_reports;
CREATE TRIGGER trg_fleetroom_yield
  BEFORE INSERT OR UPDATE OF status ON fleet.daily_reports
  FOR EACH ROW EXECUTE FUNCTION fleet.fleetroom_yield_to_declaration();
