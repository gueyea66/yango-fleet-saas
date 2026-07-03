-- Migration 028 — 2026-07-03
-- Correctif : les tables de la migration 024 (notifications, push_subscriptions,
-- superadmin_settings) ont été créées APRÈS les grants initiaux du schéma fleet.
-- service_role n'avait donc AUCUN privilège dessus → "permission denied" :
--   - l'insert de sendNotification échouait silencieusement,
--   - GET /api/notifications renvoyait 500,
--   → aucune alerte (cloche ni push) ne fonctionnait.
--
-- Idempotente : GRANT peut être rejoué sans risque.

GRANT USAGE ON SCHEMA fleet TO service_role;

GRANT ALL ON fleet.notifications        TO service_role;
GRANT ALL ON fleet.push_subscriptions   TO service_role;
GRANT ALL ON fleet.superadmin_settings  TO service_role;
GRANT ALL ON fleet.notification_log     TO service_role;

-- Évite que le problème se reproduise pour les futures tables du schéma fleet
ALTER DEFAULT PRIVILEGES IN SCHEMA fleet GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA fleet GRANT USAGE, SELECT ON SEQUENCES TO service_role;
