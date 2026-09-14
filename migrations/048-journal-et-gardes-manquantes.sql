-- ============================================================
-- MIGRATION 048 — JOURNAL RÉELLEMENT ÉCRIT + GARDES D'ÉCRITURE MANQUANTES
-- À exécuter dans Supabase Dashboard > SQL Editor (projet tlcgoxinhtzmtgkmsaip).
-- Idempotente : réexécutable sans effet de bord.
--
-- Deux trous constatés en direct le 14/09/2026 sur un vrai compte chauffeur,
-- avec la seule clé anon du bundle (donc reproductible depuis l'APK, sans
-- jamais passer par l'interface admin) :
--
--   1. PAYMENTS n'a aucune garde (la 039 couvrait profiles, daily_reports,
--      expenses, vehicles, remuneration_config, tenant_settings — pas payments).
--      Un chauffeur pouvait : s'insérer un paiement de 500 000 F, gonfler un
--      paiement existant, effacer la trace de son acompte pour qu'il ne soit
--      jamais déduit de sa paie, modifier ou SUPPRIMER le salaire d'un collègue.
--      Idem sur UPLOADS et KYC_DOCUMENTS : insertion libre pour le compte d'un
--      autre chauffeur, et statut KYC posé soi-même.
--
--   2. Le JOURNAL est structurellement vide : fleet.action_logs et
--      fleet.audit_logs n'ont AUCUN GRANT, même pas pour service_role. Les six
--      écritures côté client sont en `void ...insert()` (fire-and-forget) donc
--      échouent en silence, et l'écran Journal lit 42501 permission denied.
--      Résultat : aucune trace d'aucune action depuis la création du produit.
-- ============================================================

-- ════════════════ PARTIE A — GARDES D'ÉCRITURE ════════════════
-- Réutilise les helpers de la 039 : is_trusted_server(), is_admin(),
-- current_tenant_id(). Les policies RLS « FOR ALL tenant » restent en place.

-- ── A1. PAYMENTS : la paie n'est écrite que par un gestionnaire ──
-- Aucun écran chauffeur n'écrit de paiement (il ne fait que lire les siens),
-- la règle admin-only ne retire donc aucune fonctionnalité.
DROP TRIGGER IF EXISTS guard_payments_iud ON fleet.payments;
CREATE TRIGGER guard_payments_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.payments
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_admin_only();

-- ── A2. UPLOADS : un chauffeur ne joint des pièces qu'à SES lignes ──
-- Le tenant_id est forcé (plusieurs appelants légitimes l'omettent) plutôt que
-- refusé : on répare la donnée au lieu de casser l'écran.
CREATE OR REPLACE FUNCTION fleet.guard_uploads()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() OR fleet.is_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RLS: suppression de pièce jointe réservée au gestionnaire';
  END IF;
  IF NEW.driver_id IS DISTINCT FROM auth.uid()
  OR (TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'RLS: pièce jointe d''un autre chauffeur';
  END IF;
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := fleet.current_tenant_id();
  ELSIF NEW.tenant_id IS DISTINCT FROM fleet.current_tenant_id() THEN
    RAISE EXCEPTION 'RLS: pièce jointe hors de son organisation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_uploads_iud ON fleet.uploads;
CREATE TRIGGER guard_uploads_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.uploads
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_uploads();

-- ── A3. KYC_DOCUMENTS : ses propres pièces, et jamais son propre statut ──
CREATE OR REPLACE FUNCTION fleet.guard_kyc()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() OR fleet.is_admin() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'RLS: suppression de document KYC réservée au gestionnaire';
  END IF;
  IF NEW.driver_id IS DISTINCT FROM auth.uid()
  OR (TG_OP = 'UPDATE' AND OLD.driver_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'RLS: document KYC d''un autre chauffeur';
  END IF;
  -- Le chauffeur dépose, le gestionnaire valide : le statut reste 'pending'.
  IF COALESCE(NEW.status, 'pending') IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'RLS: validation KYC réservée au gestionnaire';
  END IF;
  IF NEW.tenant_id IS NULL THEN
    NEW.tenant_id := fleet.current_tenant_id();
  ELSIF NEW.tenant_id IS DISTINCT FROM fleet.current_tenant_id() THEN
    RAISE EXCEPTION 'RLS: document KYC hors de son organisation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_kyc_iud ON fleet.kyc_documents;
CREATE TRIGGER guard_kyc_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.kyc_documents
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_kyc();

-- ════════════════ PARTIE B — LE JOURNAL S'ÉCRIT ENFIN ════════════════

-- ── B1. AUDIT_LOGS : journal serveur (écrit par les routes API) ──
-- La 022 a créé la table, activé la RLS et posé une policy de lecture, mais
-- aucun GRANT : même le service_role recevait 42501. D'où un lib/audit.ts
-- silencieux depuis toujours. Journal serveur → invisible des clients.
GRANT SELECT, INSERT ON fleet.audit_logs TO service_role;
REVOKE ALL ON fleet.audit_logs FROM anon, authenticated;

-- ── B2. ACTION_LOGS : journal métier (écrit par les écrans) ──
ALTER TABLE fleet.action_logs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT                 ON fleet.action_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON fleet.action_logs TO service_role;
REVOKE ALL ON fleet.action_logs FROM anon;

-- Lecture : le gestionnaire voit tout son tenant, le chauffeur ses seules actions.
DROP POLICY IF EXISTS "action_logs: lecture" ON fleet.action_logs;
CREATE POLICY "action_logs: lecture" ON fleet.action_logs
  FOR SELECT USING (
    tenant_id = fleet.current_tenant_id()
    AND (fleet.is_admin() OR actor_id = auth.uid())
  );

-- Écriture : dans son tenant uniquement. L'identité de l'auteur est imposée par
-- le trigger ci-dessous, pas par le client (un journal falsifiable ne vaut rien).
DROP POLICY IF EXISTS "action_logs: insertion" ON fleet.action_logs;
CREATE POLICY "action_logs: insertion" ON fleet.action_logs
  FOR INSERT WITH CHECK (tenant_id = fleet.current_tenant_id());

-- Pas de policy UPDATE/DELETE pour `authenticated` : journal append-only.
CREATE OR REPLACE FUNCTION fleet.guard_action_logs()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'RLS: le journal est en écriture seule (ajout uniquement)';
  END IF;
  -- Identité et organisation imposées : le client ne choisit pas qui a agi.
  NEW.actor_id   := auth.uid();
  NEW.tenant_id  := fleet.current_tenant_id();
  NEW.actor_role := (SELECT role FROM fleet.profiles WHERE id = auth.uid());
  NEW.created_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_action_logs_iud ON fleet.action_logs;
CREATE TRIGGER guard_action_logs_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.action_logs
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_action_logs();

COMMENT ON TABLE fleet.action_logs IS
  'Journal métier append-only : qui a soumis, validé, rejeté, modifié quoi. Auteur et tenant imposés par trigger (048).';

-- ════════════════ VÉRIFICATION ════════════════
-- 1. Les quatre gardes sont posées (4 lignes attendues)
SELECT tgname, tgrelid::regclass AS table_gardee
FROM pg_trigger
WHERE NOT tgisinternal
  AND tgname IN ('guard_payments_iud', 'guard_uploads_iud', 'guard_kyc_iud', 'guard_action_logs_iud')
ORDER BY tgname;

-- 2. Les journaux sont accessibles aux bons rôles
SELECT table_name, grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS droits
FROM information_schema.role_table_grants
WHERE table_schema = 'fleet'
  AND table_name IN ('action_logs', 'audit_logs')
  AND grantee IN ('anon', 'authenticated', 'service_role')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;
