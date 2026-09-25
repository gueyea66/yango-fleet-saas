-- ============================================================
-- MIGRATION 069 — CLOISONNEMENT DES DONNÉES ENTRE CHAUFFEURS (B5)
--
-- Idempotente. Ne touche AUCUNE donnée : uniquement des policies RLS.
--
-- La migration 048 avait fermé la moitié du sujet — les GARDES D'ÉCRITURE
-- (triggers) et le cloisonnement de `kyc_documents`, `notifications`,
-- `push_subscriptions`, `ai_extractions`, `ai_uploads_ref` et `action_logs`.
-- La LECTURE, elle, est restée ouverte sur les quatre tables qui portent les
-- données personnelles : leur policy disait « tenant_id = current_tenant_id() »
-- pour ALL, sans distinction de rôle. Conséquence, avec la clé anon et une
-- simple session de chauffeur :
--
--   • daily_reports → les journées de tous ses collègues
--   • expenses      → leurs dépenses
--   • payments      → leurs salaires et leurs avances
--   • profiles      → leurs téléphones, e-mails et salaires de base
--   • uploads       → les pièces qu'ils ont envoyées
--
-- Ce n'est pas une faille théorique : le parc de NMK compte onze comptes
-- chauffeurs ouverts, et la paie de chacun devient lisible par les dix autres.
--
-- ── Ce que la policy dit maintenant ──────────────────────
-- Trois cas, dans cet ordre :
--   1. `is_trusted_server()` — les routes serveur (service_role). Redondant en
--      pratique, puisque service_role contourne déjà la RLS ; gardé pour que la
--      règle reste vraie si la RLS est un jour forcée.
--   2. `is_admin()` — le gestionnaire et la direction voient tout leur tenant.
--      C'est leur métier : valider les rapports, payer, suivre.
--   3. `driver_id = auth.uid()` — un chauffeur ne voit que ses lignes.
--
-- ── Pourquoi c'est sans risque pour l'application ────────
-- Chaque requête de l'app chauffeur filtre DÉJÀ sur son propre identifiant :
-- `app/driver/page.tsx`, `components/driver/useDriverHomeData.ts`,
-- `useDriverPilotageStats.ts`, `DriverCards.tsx` et
-- `components/v2/driver/useDriverMonth.ts` posent tous `.eq("driver_id",
-- profile.id)` (et `.eq("id", user.id)` pour son profil). La policy ne fait donc
-- que rendre obligatoire ce que le code respecte déjà : elle ne retire aucune
-- ligne que l'application demandait.
--
-- Les tables de flotte partagée — `vehicles`, `vehicle_maintenance`,
-- `remuneration_config`, `tenant_settings`, `tenants` — restent ouvertes au
-- tenant, à dessein : la liste du parc et la règle de rémunération sont la
-- même information pour tout le monde, et ne révèlent rien d'un collègue.
--
-- Les tables `telematics_*` restent à traiter séparément (migration 070) :
-- elles n'ont pas de `driver_id` et demandent une jointure par véhicule.
-- L'app chauffeur ne les lit pas, l'exposition y est donc théorique — mais
-- réelle pour qui saurait forger la requête.
-- ============================================================

/* ── Les quatre tables de données personnelles, et les pièces ── */
-- Une seule policy par table, pour ALL, comme avant : on ne change pas la
-- forme, seulement l'ensemble des lignes visibles. Découper en SELECT/INSERT/
-- UPDATE/DELETE aurait été plus fin mais aurait aussi pu interdire une écriture
-- que l'app fait légitimement aujourd'hui — les triggers de la 048 tiennent
-- déjà ce rôle.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['daily_reports', 'expenses', 'payments', 'uploads']
  LOOP
    -- Idempotence : on retire l'ancienne comme la nouvelle avant de recréer.
    EXECUTE format('DROP POLICY IF EXISTS %I ON fleet.%I', t || ': tenant only', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON fleet.%I', t || ': cloisonne par chauffeur', t);
    EXECUTE format($f$
      CREATE POLICY %I ON fleet.%I FOR ALL
        USING (
          tenant_id = fleet.current_tenant_id()
          AND (fleet.is_trusted_server() OR fleet.is_admin() OR driver_id = auth.uid())
        )
        WITH CHECK (
          tenant_id = fleet.current_tenant_id()
          AND (fleet.is_trusted_server() OR fleet.is_admin() OR driver_id = auth.uid())
        )
    $f$, t || ': cloisonne par chauffeur', t);
  END LOOP;
END $$;

/* ── Les profils ─────────────────────────────────────────── */
-- Cas à part : la clé n'est pas `driver_id` mais `id`, et il y avait DEUX
-- policies permissives. Or des policies permissives s'additionnent : « son
-- propre dossier » n'a jamais rien restreint, elle a seulement rouvert ce que
-- « tout le tenant » ouvrait déjà. Les deux sont remplacées par une seule.
--
-- `current_tenant_id()` lit lui-même `profiles` : aucune récursion possible,
-- la fonction est SECURITY DEFINER et traverse donc la RLS.

DROP POLICY IF EXISTS "profiles: same tenant" ON fleet.profiles;
DROP POLICY IF EXISTS "profiles: own record" ON fleet.profiles;
DROP POLICY IF EXISTS "profiles: son dossier, ou le tenant pour un gestionnaire" ON fleet.profiles;

CREATE POLICY "profiles: son dossier, ou le tenant pour un gestionnaire"
  ON fleet.profiles FOR ALL
  USING (
    fleet.is_trusted_server()
    OR id = auth.uid()
    OR (tenant_id = fleet.current_tenant_id() AND fleet.is_admin())
  )
  WITH CHECK (
    fleet.is_trusted_server()
    OR id = auth.uid()
    OR (tenant_id = fleet.current_tenant_id() AND fleet.is_admin())
  );

/* ── Trace ───────────────────────────────────────────────── */

COMMENT ON TABLE fleet.daily_reports IS
  'Journées déclarées. Lecture cloisonnée depuis la 069 : un chauffeur ne voit que les siennes.';
COMMENT ON TABLE fleet.payments IS
  'Salaires et avances. Lecture cloisonnée depuis la 069 : un chauffeur ne voit que les siens.';

/* ── Retour arrière, si l'application casse ──────────────────
   Les policies d'avant la 069, à recréer telles quelles :

     DROP POLICY "daily_reports: cloisonne par chauffeur" ON fleet.daily_reports;
     CREATE POLICY "daily_reports: tenant only" ON fleet.daily_reports FOR ALL
       USING (tenant_id = fleet.current_tenant_id());
     -- idem pour expenses, payments, uploads

     DROP POLICY "profiles: son dossier, ou le tenant pour un gestionnaire" ON fleet.profiles;
     CREATE POLICY "profiles: same tenant" ON fleet.profiles FOR ALL
       USING (tenant_id = fleet.current_tenant_id());
     CREATE POLICY "profiles: own record" ON fleet.profiles FOR SELECT
       USING (id = auth.uid());

   Aucune donnée n'est concernée : le retour arrière est instantané et complet.
   ────────────────────────────────────────────────────────── */
