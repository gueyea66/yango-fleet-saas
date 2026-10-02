-- ════════════════════════════════════════════════════════════
-- 075 — Saisie opérateur et validation séparée
-- ════════════════════════════════════════════════════════════
-- Besoin (NMK, générique) : un opérateur (ex. dispatcher) saisit pour le
-- compte des chauffeurs (1) les recettes hors Yango d'un jour et (2) des
-- charges avec preuve ; un AUTRE admin valide. Les chauffeurs n'ont rien à
-- faire.
--
-- 1. profiles.peut_valider : un admin « saisie seule » garde la vue mais ne
--    peut ni valider ni rejeter, ni modifier une ligne validée, ni promouvoir
--    un compte en admin.
-- 2. Traçabilité : entered_by / approved_by / approved_at, posés par la base
--    (non modifiables par l'app) ; personne ne valide sa propre saisie.
-- 3. fleet.saisies_hors_yango : recettes hors Yango par chauffeur et par jour.
--    Accès réservé au serveur (routes API) : aucun accès direct anon/authenticated.
-- 4. Journées Fleetroom / opérateur : brut et net = composantes Yango + hors
--    Yango validé. Un ré-import Fleetroom conserve donc le hors Yango.
-- 5. Lignes validées verrouillées (déclarations, charges, saisies) : seul un
--    admin valideur (ou le serveur) les modifie ou les supprime.
-- Idempotent. Testée à blanc sur les données NMK (transaction annulée).

-- ── 0. Contexte de confiance ─────────────────────────────────
-- Serveur (service_role) ou console SQL (session ≠ PostgREST). Les requêtes de
-- l'app passent par PostgREST (session_user = authenticator) : jamais « console ».
-- session_user (et non current_user, qui vaut le propriétaire dans une
-- fonction SECURITY DEFINER).
CREATE OR REPLACE FUNCTION fleet.is_console_ou_serveur()
RETURNS boolean LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT fleet.is_trusted_server() OR session_user NOT IN ('authenticator', 'anon', 'authenticated');
$$;

-- ── 1. Droit de valider ──────────────────────────────────────
ALTER TABLE fleet.profiles ADD COLUMN IF NOT EXISTS peut_valider BOOLEAN NOT NULL DEFAULT true;
COMMENT ON COLUMN fleet.profiles.peut_valider IS
  'Admin : false = saisie seule (ne valide pas, ne modifie pas une ligne validée). Sans effet pour un chauffeur.';

-- l'utilisateur courant peut-il valider ? (admin + peut_valider)
CREATE OR REPLACE FUNCTION fleet.peut_valider_courant()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM fleet.profiles WHERE id = auth.uid() AND role = 'admin' AND peut_valider);
$$;

-- Droit de valider et rôle admin : seul un admin valideur (ou le serveur) les
-- accorde ou les retire. Sans cela, un admin « saisie seule » pourrait créer un
-- chauffeur puis le passer admin (valideur par défaut).
CREATE OR REPLACE FUNCTION fleet.guard_droits_admin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF fleet.is_console_ou_serveur() OR fleet.peut_valider_courant() THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'admin' THEN RAISE EXCEPTION 'RLS: création d''administrateur réservée à un administrateur valideur'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.peut_valider IS DISTINCT FROM OLD.peut_valider THEN
    RAISE EXCEPTION 'RLS: seul un administrateur valideur peut modifier le droit de valider';
  END IF;
  IF NEW.role IS DISTINCT FROM OLD.role AND (NEW.role = 'admin' OR OLD.role = 'admin') THEN
    RAISE EXCEPTION 'RLS: seul un administrateur valideur peut changer un rôle administrateur';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_peut_valider_upd ON fleet.profiles;
DROP TRIGGER IF EXISTS guard_droits_admin_iu ON fleet.profiles;
CREATE TRIGGER guard_droits_admin_iu BEFORE INSERT OR UPDATE OF role, peut_valider ON fleet.profiles
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_droits_admin();
DROP FUNCTION IF EXISTS fleet.guard_peut_valider();

-- ── 2. Traçabilité ───────────────────────────────────────────
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
-- accès uniquement par les routes serveur (/api/admin/saisies)
REVOKE ALL ON fleet.saisies_hors_yango FROM anon, authenticated;
GRANT ALL ON fleet.saisies_hors_yango TO service_role;

-- ── 4. Validation séparée (déclarations, charges, saisies) ───
CREATE OR REPLACE FUNCTION fleet.guard_validation_separee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_decision  BOOLEAN := false;
  v_auteur    UUID;
  v_confiance BOOLEAN := fleet.is_console_ou_serveur();
BEGIN
  -- décision = passage à approved / rejected (OLD n'est lu qu'en UPDATE)
  IF NEW.status IN ('approved','rejected') THEN
    IF TG_OP = 'INSERT' THEN v_decision := true;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN v_decision := true;
    END IF;
  END IF;

  -- saisie : chauffeur du même tenant, toujours (serveur compris)
  IF TG_TABLE_NAME = 'saisies_hors_yango' THEN
    IF NOT EXISTS (SELECT 1 FROM fleet.profiles WHERE id = NEW.driver_id AND tenant_id = NEW.tenant_id AND role = 'driver') THEN
      RAISE EXCEPTION 'Chauffeur inconnu pour ce compte';
    END IF;
  END IF;

  IF NOT v_confiance THEN
    -- Champs de traçabilité : posés par la base, jamais par l'app.
    -- (blocs imbriqués : daily_reports n'a pas entered_by, l'accès ne doit pas être évalué)
    IF TG_TABLE_NAME <> 'daily_reports' THEN
      IF TG_OP = 'INSERT' THEN
        NEW.entered_by := auth.uid();
        IF NEW.status <> 'submitted' THEN
          RAISE EXCEPTION 'Une saisie part toujours en attente de validation';
        END IF;
      ELSE
        NEW.entered_by := OLD.entered_by;
      END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.approved_by := NULL; NEW.approved_at := NULL;
    ELSE
      NEW.approved_by := OLD.approved_by; NEW.approved_at := OLD.approved_at;
    END IF;
  END IF;

  IF v_decision AND NOT v_confiance THEN
    IF NOT fleet.peut_valider_courant() THEN
      RAISE EXCEPTION 'Validation réservée à un administrateur valideur (profil « saisie seule »)';
    END IF;
    -- auteur lu sur OLD : impossible de vider / changer entered_by pour se valider
    IF TG_TABLE_NAME <> 'daily_reports' THEN
      IF TG_OP = 'UPDATE' THEN v_auteur := COALESCE(OLD.entered_by, OLD.driver_id);
      ELSE v_auteur := COALESCE(NEW.entered_by, NEW.driver_id); END IF;
      IF v_auteur = auth.uid() THEN
        RAISE EXCEPTION 'Une saisie ne peut pas être validée par son auteur';
      END IF;
    END IF;
    -- charge saisie par un opérateur : preuve obligatoire pour la valider
    IF TG_TABLE_NAME = 'expenses' THEN
      IF NEW.status = 'approved' AND NEW.source = 'operateur'
         AND NOT EXISTS (SELECT 1 FROM fleet.uploads WHERE ref_id = NEW.id AND tenant_id = NEW.tenant_id) THEN
        RAISE EXCEPTION 'Preuve manquante : impossible de valider une charge sans pièce jointe';
      END IF;
    END IF;
    NEW.approved_by := auth.uid();
    NEW.approved_at := now();
  END IF;

  -- déclaration chauffeur validée un jour qui a déjà du hors Yango validé :
  -- le montant serait perdu (la journée Fleetroom cède la place) → refus explicite
  IF v_decision AND TG_TABLE_NAME = 'daily_reports' THEN
    IF NEW.status = 'approved' AND COALESCE(NEW.source, '') NOT IN ('fleetroom', 'operateur')
       AND EXISTS (SELECT 1 FROM fleet.saisies_hors_yango s WHERE s.tenant_id = NEW.tenant_id
                   AND s.driver_id = NEW.driver_id AND s.jour = NEW.date AND s.status = 'approved') THEN
      RAISE EXCEPTION 'Des recettes hors Yango validées existent pour ce jour : rejetez-les ou intégrez-les à la déclaration';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_validation_separee_exp ON fleet.expenses;
CREATE TRIGGER guard_validation_separee_exp BEFORE INSERT OR UPDATE ON fleet.expenses
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_validation_separee();
DROP TRIGGER IF EXISTS guard_validation_separee_rep ON fleet.daily_reports;
CREATE TRIGGER guard_validation_separee_rep BEFORE INSERT OR UPDATE ON fleet.daily_reports
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_validation_separee();
DROP TRIGGER IF EXISTS guard_validation_separee_hy ON fleet.saisies_hors_yango;
CREATE TRIGGER guard_validation_separee_hy BEFORE INSERT OR UPDATE ON fleet.saisies_hors_yango
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_validation_separee();

-- ── 5. Lignes validées verrouillées ──────────────────────────
-- Une ligne validée ne se modifie / supprime que par un admin valideur ou le
-- serveur. Une charge saisie par un opérateur n'est jamais modifiable par le
-- chauffeur concerné.
CREATE OR REPLACE FUNCTION fleet.guard_ligne_validee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF fleet.is_console_ou_serveur() THEN RETURN COALESCE(NEW, OLD); END IF;
  IF OLD.status = 'approved' AND NOT fleet.peut_valider_courant() THEN
    RAISE EXCEPTION 'Ligne validée : modification réservée à un administrateur valideur';
  END IF;
  IF TG_TABLE_NAME = 'expenses' THEN
    IF OLD.source = 'operateur' AND NOT fleet.is_admin() THEN
      RAISE EXCEPTION 'Charge saisie par l''exploitation : non modifiable par le chauffeur';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS guard_ligne_validee_exp ON fleet.expenses;
CREATE TRIGGER guard_ligne_validee_exp BEFORE UPDATE OR DELETE ON fleet.expenses
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_ligne_validee();
DROP TRIGGER IF EXISTS guard_ligne_validee_rep ON fleet.daily_reports;
CREATE TRIGGER guard_ligne_validee_rep BEFORE UPDATE OR DELETE ON fleet.daily_reports
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_ligne_validee();
DROP TRIGGER IF EXISTS guard_ligne_validee_hy ON fleet.saisies_hors_yango;
CREATE TRIGGER guard_ligne_validee_hy BEFORE UPDATE OR DELETE ON fleet.saisies_hors_yango
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_ligne_validee();

-- ── 6. Hors Yango validé → journée Fleetroom / opérateur ─────
-- Brut et net des journées 'fleetroom' / 'operateur' = composantes Yango +
-- hors Yango validé du jour (même formule que fleetroom_rebuild, 072).
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

-- Une saisie validée (ou qui cesse de l'être) met à jour la journée du chauffeur,
-- la crée si besoin, ou supprime la journée créée pour elle quand plus rien ne
-- la justifie.
CREATE OR REPLACE FUNCTION fleet.saisie_hy_vers_journee()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r RECORD; v_source TEXT; v_reste BOOLEAN;
BEGIN
  -- seules les saisies validées (avant ou après) touchent la journée
  IF NOT ((TG_OP <> 'DELETE' AND NEW.status = 'approved') OR (TG_OP <> 'INSERT' AND OLD.status = 'approved')) THEN
    RETURN NULL;
  END IF;
  FOR r IN SELECT DISTINCT x.tenant_id, x.driver_id, x.jour FROM (
    SELECT NEW.tenant_id AS tenant_id, NEW.driver_id AS driver_id, NEW.jour AS jour WHERE TG_OP <> 'DELETE'
    UNION ALL SELECT OLD.tenant_id, OLD.driver_id, OLD.jour WHERE TG_OP <> 'INSERT'
  ) x LOOP
    v_reste := EXISTS (SELECT 1 FROM fleet.saisies_hors_yango
      WHERE tenant_id = r.tenant_id AND driver_id = r.driver_id AND jour = r.jour AND status = 'approved');

    -- une déclaration chauffeur validée occupe déjà ce jour : le hors Yango serait perdu
    IF v_reste AND EXISTS (SELECT 1 FROM fleet.daily_reports WHERE tenant_id = r.tenant_id
         AND driver_id = r.driver_id AND date = r.jour AND status = 'approved'
         AND COALESCE(source, '') NOT IN ('fleetroom', 'operateur')) THEN
      RAISE EXCEPTION 'Le chauffeur a déjà une déclaration validée ce jour : corrigez-la directement plutôt qu''une saisie hors Yango';
    END IF;

    -- journée existante Fleetroom / opérateur : ré-écrite (journee_hors_yango recalcule)
    UPDATE fleet.daily_reports SET updated_at = now()
    WHERE tenant_id = r.tenant_id AND driver_id = r.driver_id AND date = r.jour
      AND status = 'approved' AND source IN ('fleetroom', 'operateur');

    IF v_reste AND NOT EXISTS (SELECT 1 FROM fleet.daily_reports
         WHERE tenant_id = r.tenant_id AND driver_id = r.driver_id AND date = r.jour AND status = 'approved') THEN
      -- aucune journée : on la crée. Tenant Fleetroom → 'fleetroom' (un import
      -- ultérieur la rafraîchit sans conflit) ; sinon 'operateur'.
      v_source := CASE WHEN EXISTS (SELECT 1 FROM fleet.yango_transactions WHERE tenant_id = r.tenant_id LIMIT 1)
                       THEN 'fleetroom' ELSE 'operateur' END;
      INSERT INTO fleet.daily_reports (tenant_id, driver_id, date, status, source,
        yango_cash, yango_card, yango_gross, yango_bonus, commission_amount, end_odometer, expense_count, comment)
      VALUES (r.tenant_id, r.driver_id, r.jour, 'approved', v_source, 0, 0, 0, 0, 0, 0, 0, 'Hors Yango (saisie opérateur)');
    ELSIF NOT v_reste THEN
      -- plus aucune saisie validée : la journée créée pour elle disparaît
      DELETE FROM fleet.daily_reports
      WHERE tenant_id = r.tenant_id AND driver_id = r.driver_id AND date = r.jour AND status = 'approved'
        AND source IN ('fleetroom', 'operateur') AND comment = 'Hors Yango (saisie opérateur)'
        AND COALESCE(yango_gross, 0) = 0 AND COALESCE(yango_bonus, 0) = 0 AND COALESCE(yango_trip_count, 0) = 0;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_saisie_hy_vers_journee ON fleet.saisies_hors_yango;
CREATE TRIGGER trg_saisie_hy_vers_journee AFTER INSERT OR UPDATE OR DELETE ON fleet.saisies_hors_yango
  FOR EACH ROW EXECUTE FUNCTION fleet.saisie_hy_vers_journee();

-- ── 7. Contrôle ──────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'fleet' AND table_name = 'profiles' AND column_name = 'peut_valider') AS col_peut_valider,
  (SELECT count(*) FROM information_schema.tables  WHERE table_schema = 'fleet' AND table_name = 'saisies_hors_yango') AS table_saisies,
  (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'guard_ligne_validee%') AS verrous;
