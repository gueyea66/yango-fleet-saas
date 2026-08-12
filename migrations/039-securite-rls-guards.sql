-- ============================================================
-- MIGRATION 039 — DURCISSEMENT SÉCURITÉ (fix audit V1)
-- ------------------------------------------------------------
-- Corrige la faille CRITIQUE d'élévation de privilège : les policies
-- `FOR ALL USING (tenant_id = current_tenant_id())` de la migration 020
-- laissaient TOUT utilisateur authentifié (y compris un chauffeur) écrire
-- via la clé anon du navigateur. Un chauffeur pouvait :
--   UPDATE profiles SET role='admin'         → devenir admin
--   UPDATE daily_reports SET status='approved' → s'auto-approuver
--   modifier sa propre rémunération.
--
-- APPROCHE : on NE touche PAS aux policies RLS (les lectures et les
-- écritures légitimes du front continuent de marcher à l'identique).
-- On ajoute des TRIGGERS de garde qui s'exécutent AVANT chaque écriture
-- et refusent les opérations sensibles pour les utilisateurs non-admin.
-- Le serveur (service_role) et les admins passent librement.
--
-- Idempotente (CREATE OR REPLACE + DROP TRIGGER IF EXISTS). Additive :
-- zéro impact sur les flux légitimes (self-service chauffeur préservé).
-- ============================================================

-- ── Helpers ────────────────────────────────────────────────

-- Contexte serveur de confiance (clé service_role) : bypass total.
CREATE OR REPLACE FUNCTION fleet.is_trusted_server()
RETURNS boolean LANGUAGE sql STABLE
SET search_path = ''
AS $$ SELECT coalesce(auth.role(), '') = 'service_role' $$;

-- L'utilisateur courant est-il admin de son tenant ?
-- SECURITY DEFINER → lit profiles hors RLS, pas de récursion.
CREATE OR REPLACE FUNCTION fleet.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM fleet.profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
$$;

-- Durcissement défense-en-profondeur : search_path figé sur la fonction
-- pivot de la RLS (recommandation audit V-mineure).
CREATE OR REPLACE FUNCTION fleet.current_tenant_id()
RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = ''
AS $$ SELECT tenant_id FROM fleet.profiles WHERE id = auth.uid() $$;

-- ── PROFILES : bloquer l'auto-promotion et l'auto-augmentation ──
CREATE OR REPLACE FUNCTION fleet.guard_profiles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() OR fleet.is_admin() THEN
    RETURN NEW;
  END IF;
  -- Un non-admin ne peut éditer QUE sa propre ligne…
  IF NEW.id IS DISTINCT FROM auth.uid() OR OLD.id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'RLS: modification limitée à son propre profil';
  END IF;
  -- …et JAMAIS ces champs sensibles (rôle, tenant, paie, statut) :
  IF NEW.role         IS DISTINCT FROM OLD.role
  OR NEW.tenant_id    IS DISTINCT FROM OLD.tenant_id
  OR NEW.comm_yango   IS DISTINCT FROM OLD.comm_yango
  OR NEW.comm_partner IS DISTINCT FROM OLD.comm_partner
  OR NEW.salary_model IS DISTINCT FROM OLD.salary_model
  OR NEW.base_amount  IS DISTINCT FROM OLD.base_amount
  OR NEW.solde_initial IS DISTINCT FROM OLD.solde_initial
  OR NEW.account_type IS DISTINCT FROM OLD.account_type
  OR NEW.driver_level IS DISTINCT FROM OLD.driver_level
  OR NEW.active       IS DISTINCT FROM OLD.active
  OR NEW.payment_frequency IS DISTINCT FROM OLD.payment_frequency
  OR NEW.onboarding_reviewed IS DISTINCT FROM OLD.onboarding_reviewed
  OR NEW.onboarding_notes    IS DISTINCT FROM OLD.onboarding_notes THEN
    RAISE EXCEPTION 'RLS: champ protégé — modification réservée au gestionnaire';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_profiles_upd ON fleet.profiles;
CREATE TRIGGER guard_profiles_upd BEFORE UPDATE ON fleet.profiles
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_profiles();

-- INSERT/DELETE de profils : admins/serveur uniquement.
CREATE OR REPLACE FUNCTION fleet.guard_profiles_ins_del()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() OR fleet.is_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'RLS: création/suppression de profil réservée au gestionnaire';
END $$;

DROP TRIGGER IF EXISTS guard_profiles_ins ON fleet.profiles;
CREATE TRIGGER guard_profiles_ins BEFORE INSERT ON fleet.profiles
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_profiles_ins_del();
DROP TRIGGER IF EXISTS guard_profiles_del ON fleet.profiles;
CREATE TRIGGER guard_profiles_del BEFORE DELETE ON fleet.profiles
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_profiles_ins_del();

-- ── DAILY_REPORTS : pas d'auto-approbation, pas de vol de ligne ──
CREATE OR REPLACE FUNCTION fleet.guard_reports()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() OR fleet.is_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RLS: suppression de rapport réservée au gestionnaire';
  END IF;
  -- Le rapport doit appartenir au chauffeur courant (avant et après).
  IF NEW.driver_id IS DISTINCT FROM auth.uid()
  OR (TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'RLS: rapport d''un autre chauffeur';
  END IF;
  -- Le chauffeur ne peut jamais approuver (ni via INSERT ni via UPDATE).
  IF NEW.status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    RAISE EXCEPTION 'RLS: approbation réservée au gestionnaire';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_reports_iud ON fleet.daily_reports;
CREATE TRIGGER guard_reports_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.daily_reports
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_reports();

-- ── EXPENSES : mêmes règles (propriété + pas d'auto-validation) ──
CREATE OR REPLACE FUNCTION fleet.guard_expenses()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() OR fleet.is_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RLS: suppression de dépense réservée au gestionnaire';
  END IF;
  IF NEW.driver_id IS DISTINCT FROM auth.uid()
  OR (TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'RLS: dépense d''un autre chauffeur';
  END IF;
  IF NEW.status = 'approved'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
    RAISE EXCEPTION 'RLS: validation réservée au gestionnaire';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_expenses_iud ON fleet.expenses;
CREATE TRIGGER guard_expenses_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.expenses
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_expenses();

-- ── VEHICLES : un chauffeur ne gère que son propre véhicule ──
CREATE OR REPLACE FUNCTION fleet.guard_vehicles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() OR fleet.is_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RLS: suppression de véhicule réservée au gestionnaire';
  END IF;
  IF NEW.driver_id IS DISTINCT FROM auth.uid()
  OR (TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'RLS: véhicule non rattaché au chauffeur courant';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_vehicles_iud ON fleet.vehicles;
CREATE TRIGGER guard_vehicles_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.vehicles
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_vehicles();

-- ── REMUNERATION_CONFIG & TENANT_SETTINGS : admins/serveur seuls ──
CREATE OR REPLACE FUNCTION fleet.guard_admin_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() OR fleet.is_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'RLS: écriture réservée au gestionnaire';
END $$;

DROP TRIGGER IF EXISTS guard_remun_iud ON fleet.remuneration_config;
CREATE TRIGGER guard_remun_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.remuneration_config
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_admin_only();

DROP TRIGGER IF EXISTS guard_tsettings_iud ON fleet.tenant_settings;
CREATE TRIGGER guard_tsettings_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_admin_only();

-- ============================================================
-- FIN 039. Après application, rejouer le test d'intrusion V1 :
--   un chauffeur qui tente UPDATE profiles SET role='admin'
--   doit recevoir une ERREUR (au lieu de 200).
-- ============================================================
