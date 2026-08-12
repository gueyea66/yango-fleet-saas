-- ============================================================
-- MIGRATION 040 — VERROUILLAGE DU SCHÉMA public HÉRITÉ (fix audit V3)
-- ------------------------------------------------------------
-- Constat de l'audit : le schéma `public` (hérité de la migration 010)
-- est encore exposé par PostgREST avec des GRANT anon/authenticated et la
-- RLS désactivée. En pratique il ne reste que des tables VIDES
-- (public.profiles, public.reports = 0 ligne — les vraies données sont
-- dans `fleet`), mais on retire ces droits par défense en profondeur pour
-- qu'aucune écriture/lecture anonyme n'y soit jamais possible.
--
-- Le schéma `yango` n'est PAS exposé (déjà OK). L'app tourne sur `fleet`.
-- Idempotente et sans risque (n'affecte que le schéma public legacy vide).
-- ============================================================

-- Retirer les droits larges accordés en 010 aux rôles clients.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
-- Ne plus accorder automatiquement de droits aux futurs objets public.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- Réactiver la RLS sur les tables public héritées encore présentes
-- (deny-all une fois les grants retirés). Boucle tolérante aux absences.
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Idéalement, retirer aussi `public` des "Exposed schemas" dans
-- Supabase → Settings → API (ne laisser que `fleet`). Ce réglage se fait
-- dans l'UI Supabase, pas en SQL.
-- ============================================================
