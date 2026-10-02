-- ════════════════════════════════════════════════════════════
-- 075 — Saisie opérateur et validation séparée
-- ════════════════════════════════════════════════════════════
-- Besoin (NMK, générique) : un opérateur (ex. dispatcher) saisit pour le
-- compte des chauffeurs (1) les recettes hors Yango d'un jour et (2) des
-- charges avec preuve ; un AUTRE admin valide. Les chauffeurs n'ont rien à
-- faire.
--
-- 1. profiles.peut_valider : un admin « saisie seule » garde la vue mais ne
--    peut ni valider ni rejeter (déclarations, charges, saisies hors Yango).
-- 2. Traçabilité : entered_by / approved_by / approved_at sur expenses et
--    saisies ; personne ne valide sa propre saisie (garde en base).
-- 3. fleet.saisies_hors_yango : recettes hors Yango par chauffeur et par jour,
--    en attente puis validées.
-- 4. Journées Fleetroom / opérateur : brut et net recalculés à partir de leurs
--    composantes + hors Yango validé. Idempotent : un nouvel import Fleetroom
--    (fleetroom_rebuild) ne fait plus disparaître le hors Yango.
-- Idempotent. À appliquer dans l'éditeur SQL Supabase.

-- ── 0. Console SQL ───────────────────────────────────────────
-- Session sans JWT (éditeur SQL Supabase, migrations) : de confiance, comme le
-- serveur. Les requêtes de l'app passent toujours par PostgREST, avec un JWT.
CREATE OR REPLACE FUNCTION fleet.is_console_ou_serveur()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT fleet.is_trusted_server() OR COALESCE(current_setting('request.jwt.claims', true), '') = '';
$$;

-- ── 1. Droit de valider ──────────────────────────────────────
ALTER TABLE fleet.profiles ADD COLUMN IF NOT EXISTS peut_valider BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN fleet.profiles.peut_valider IS
  'Admin : false = saisie seule (ne peut ni valider ni rejeter). Sans effet pour un chauffeur.';

-- garde_profiles (039) ne protège que certains champs : un non-admin ne doit
-- pas pouvoir se donner le droit de valider.
CREATE OR REPLACE FUNCTION fleet.guard_peut_valider()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.peut_valider IS DISTINCT FROM OLD.peut_valider
     AND NOT (fleet.is_console_ou_serveur() OR (fleet.is_admin() AND fleet.peut_valider_courant())) THEN
    RAISE EXCEPTION 'RLS: seul un admin valideur peut modifier le droit de valider';
  END IF;
  RETURN NEW;
END $$;

-- l'utilisateur courant peut-il valider ? (admin + peut_valider)
CREATE OR REPLACE FUNCTION fleet.peut_valider_courant()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM fleet.profiles WHERE id = auth.uid() AND role = 'admin' AND peut_valider);
$$;

DROP TRIGGER IF EXISTS guard_peut_valider_upd ON fleet.profiles;
CREATE TRIGGER guard_peut_valider_upd BEFORE UPDATE OF peut_valider ON fleet.profiles
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_peut_valider();

-- ── 2. Traçabilité des charges ───────────────────────────────
ALTER TABLE fleet.expenses ADD COLUMN IF NOT EXISTS entered_by  UUID REFERENCES fleet.profiles(id) ON DELETE SET NULL;
ALTER TABLE fleet.expenses ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES fleet.profiles(id) ON DELETE SET NULL;
ALTER TABLE fleet.expenses ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE fleet.daily_reports ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES fleet.profiles(id) ON DELETE SET NULL;
ALTER TABLE fleet.daily_reports ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- ── 3. Saisies hors Yango ────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet.saisies_hors_yango (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  driver_id        UUID        NOT NULL REFERENCES fleet.profiles(id) ON DELETE CASCADE,
  jour             DATE        NOT NULL,
  montant          NUMERIC     NOT NULL CHECK (montant > 0 AND montant <= 10000000),
  courses          INTEGER     NOT NULL DEFAULT 0 CHECK (courses >= 0 AND courses <= 500),
  note             TEXT,
  status           TEXT        NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
  rejection_reason TEXT,
  entered_by       UUID        REFERENCES fleet.profiles(id) ON DELETE SET NULL,
  approved_by      UUID        REFERENCES fleet.profiles(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_saisies_hy_tenant_jour ON fleet.saisies_hors_yango (tenant_id, jour);
CREATE INDEX IF NOT EXISTS idx_saisies_hy_driver_jour ON fleet.saisies_hors_yango (tenant_id, driver_id, jour);

ALTER TABLE fleet.saisies_hors_yango ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saisies_hy_admin ON fleet.saisies_hors_yango;
CREATE POLICY saisies_hy_admin ON fleet.saisies_hors_yango FOR ALL
  USING (fleet.is_trusted_server() OR (fleet.is_admin() AND tenant_id = fleet.current_tenant_id()))
  WITH CHECK (fleet.is_trusted_server() OR (fleet.is_admin() AND tenant_id = fleet.current_tenant_id()));

-- ── 4. Validation séparée (déclarations, charges, saisies) ───
-- Toute décision (approved / rejected) hors serveur de confiance exige un admin
-- valideur qui n'est pas l'auteur de la saisie. Le serveur (routes API) applique
-- la même règle côté code et renseigne approved_by lui-même.
CREATE OR REPLACE FUNCTION fleet.guard_validation_separee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_decision BOOLEAN := false;
  v_auteur UUID := NEW.driver_id;  -- déclarations : l'auteur est le chauffeur
BEGIN
  -- décision = passage à approved / rejected (OLD n'est lu qu'en UPDATE)
  IF NEW.status IN ('approved','rejected') THEN
    IF TG_OP = 'INSERT' THEN v_decision := true;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN v_decision := true;
    END IF;
  END IF;
  -- Charges et saisies : auteur = entered_by (posé à l'insertion s'il manque).
  -- Blocs IF imbriqués : daily_reports n'a pas de colonne entered_by, l'accès
  -- NEW.entered_by ne doit jamais être évalué pour cette table.
  IF TG_TABLE_NAME <> 'daily_reports' THEN
    IF TG_OP = 'INSERT' AND NOT fleet.is_console_ou_serveur() THEN
      IF NEW.entered_by IS NULL THEN NEW.entered_by := auth.uid(); END IF;
    END IF;
    v_auteur := COALESCE(NEW.entered_by, NEW.driver_id);
  END IF;

  IF v_decision AND NOT fleet.is_console_ou_serveur() THEN
    IF NOT fleet.peut_valider_courant() THEN
      RAISE EXCEPTION 'Validation réservée à un administrateur valideur (profil « saisie seule »)';
    END IF;
    IF TG_TABLE_NAME <> 'daily_reports' AND TG_OP = 'UPDATE' AND v_auteur = auth.uid() THEN
      RAISE EXCEPTION 'Une saisie ne peut pas être validée par son auteur';
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_validation_separee_exp ON fleet.expenses;
CREATE TRIGGER guard_validation_separee_exp BEFORE INSERT OR UPDATE ON fleet.expenses
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_validation_separee();
DROP TRIGGER IF EXISTS guard_validation_separee_rep ON fleet.daily_reports;
CREATE TRIGGER guard_validation_separee_rep BEFORE INSERT OR UPDATE OF status ON fleet.daily_reports
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_validation_separee();
DROP TRIGGER IF EXISTS guard_validation_separee_hy ON fleet.saisies_hors_yango;
CREATE TRIGGER guard_validation_separee_hy BEFORE INSERT OR UPDATE ON fleet.saisies_hors_yango
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_validation_separee();

-- ── 5. Hors Yango validé → journée Fleetroom / opérateur ─────
-- Brut et net des journées 'fleetroom' / 'operateur' = composantes Yango +
-- hors Yango validé du jour. Recalculé à chaque écriture de la ligne : un
-- import Fleetroom qui réécrit brut et net retrouve donc le hors Yango.
CREATE OR REPLACE FUNCTION fleet.journee_hors_yango()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hy NUMERIC; v_courses INT;
BEGIN
  IF COALESCE(NEW.source, '') NOT IN ('fleetroom', 'operateur') THEN RETURN NEW; END IF;
  SELECT COALESCE(SUM(montant), 0), COALESCE(SUM(courses), 0) INTO v_hy, v_courses
  FROM fleet.saisies_hors_yango
  WHERE tenant_id = NEW.tenant_id AND driver_id = NEW.driver_id AND jour = NEW.date AND status = 'approved';
  NEW.off_yango_revenue    := v_hy;
  NEW.off_yango_trip_count := v_courses;
  NEW.gross_earnings       := COALESCE(NEW.yango_gross, 0) + COALESCE(NEW.yango_bonus, 0) + v_hy;
  NEW.net_after_expenses   := COALESCE(NEW.yango_gross, 0) + COALESCE(NEW.yango_bonus, 0)
                              - COALESCE(NEW.commission_amount, 0) + v_hy;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_journee_hors_yango ON fleet.daily_reports;
CREATE TRIGGER trg_journee_hors_yango BEFORE INSERT OR UPDATE ON fleet.daily_reports
  FOR EACH ROW EXECUTE FUNCTION fleet.journee_hors_yango();

-- Une saisie validée / annulée met à jour la journée du chauffeur (ou la crée).
CREATE OR REPLACE FUNCTION fleet.saisie_hy_vers_journee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r RECORD; v_source TEXT;
BEGIN
  FOR r IN SELECT DISTINCT x.tenant_id, x.driver_id, x.jour FROM (
    SELECT NEW.tenant_id AS tenant_id, NEW.driver_id AS driver_id, NEW.jour AS jour WHERE TG_OP <> 'DELETE'
    UNION ALL SELECT OLD.tenant_id, OLD.driver_id, OLD.jour WHERE TG_OP <> 'INSERT'
  ) x LOOP
    -- journée existante Fleetroom / opérateur : on la ré-écrit (le trigger recalcule)
    UPDATE fleet.daily_reports SET updated_at = now()
    WHERE tenant_id = r.tenant_id AND driver_id = r.driver_id AND date = r.jour
      AND status = 'approved' AND source IN ('fleetroom', 'operateur');
    IF NOT FOUND AND EXISTS (SELECT 1 FROM fleet.saisies_hors_yango
        WHERE tenant_id = r.tenant_id AND driver_id = r.driver_id AND jour = r.jour AND status = 'approved')
       AND NOT EXISTS (SELECT 1 FROM fleet.daily_reports
        WHERE tenant_id = r.tenant_id AND driver_id = r.driver_id AND date = r.jour AND status = 'approved') THEN
      -- aucune journée validée : on la crée. Tenant Fleetroom → 'fleetroom' (un import
      -- ultérieur la rafraîchit sans conflit) ; sinon 'operateur'.
      v_source := CASE WHEN EXISTS (SELECT 1 FROM fleet.yango_transactions WHERE tenant_id = r.tenant_id LIMIT 1)
                       THEN 'fleetroom' ELSE 'operateur' END;
      INSERT INTO fleet.daily_reports (tenant_id, driver_id, date, status, source,
        yango_cash, yango_card, yango_gross, yango_bonus, commission_amount, end_odometer, expense_count, comment)
      VALUES (r.tenant_id, r.driver_id, r.jour, 'approved', v_source, 0, 0, 0, 0, 0, 0, 0, 'Hors Yango (saisie opérateur)');
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_saisie_hy_vers_journee ON fleet.saisies_hors_yango;
CREATE TRIGGER trg_saisie_hy_vers_journee AFTER INSERT OR UPDATE OR DELETE ON fleet.saisies_hors_yango
  FOR EACH ROW EXECUTE FUNCTION fleet.saisie_hy_vers_journee();

-- ── 6. Contrôle ──────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'fleet' AND table_name = 'profiles' AND column_name = 'peut_valider') AS col_peut_valider,
  (SELECT count(*) FROM information_schema.tables  WHERE table_schema = 'fleet' AND table_name = 'saisies_hors_yango') AS table_saisies;
