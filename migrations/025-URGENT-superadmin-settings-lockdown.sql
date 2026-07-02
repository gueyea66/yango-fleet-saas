-- ============================================================
-- MIGRATION 025 — URGENT — 2026-07-02
-- FAILLE CRITIQUE : fleet.superadmin_settings est lisible ET inscriptible
-- par le rôle `anon` (clé publique embarquée dans le bundle JS).
-- La clé d'accès superadmin ACTIVE (row key='access_key') est donc
-- exposée à n'importe quel visiteur, qui peut aussi la RÉÉCRIRE.
--
-- Cause : la migration 024 (RLS + REVOKE) n'a pas été appliquée en prod.
-- Effet de ce fix : l'app continue de fonctionner car elle accède à cette
-- table via la clé service_role (côté serveur), qui bypasse RLS et grants.
--
-- ⚠️ IMPORTANT — dépendance UI : la page /superadmin lit encore
-- superadmin_settings via le client ANON (navigateur). Après ce lockdown,
-- l'onglet « Paramètres » du superadmin ne pourra plus lire ces réglages
-- tant que le correctif code (lecture via API service_role) n'est pas déployé.
-- → Appliquer ce SQL EN MÊME TEMPS que le déploiement du correctif code,
--   ou juste avant (la sécurité prime sur l'onglet Paramètres).
--
-- À exécuter dans Supabase Dashboard → SQL Editor.
-- Idempotent.
-- ============================================================

-- Verrou : service_role uniquement (deny-by-default pour anon/authenticated)
ALTER TABLE fleet.superadmin_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fleet.superadmin_settings FROM anon, authenticated;

-- Rappel migration 024 (au cas où non appliquée) — idempotent
ALTER TABLE fleet.notification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fleet.notification_log FROM anon, authenticated;

-- ── VÉRIFICATION ──
-- Doit renvoyer rowsecurity = true et aucun grant anon :
--   SELECT relname, relrowsecurity FROM pg_class
--   WHERE relname = 'superadmin_settings';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--   WHERE table_name = 'superadmin_settings';
