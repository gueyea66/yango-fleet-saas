-- 047 — Relais Telegram par tenant (retour Abdou 04/09 : « de vrais messages
-- push ») : les événements destinés aux admins (rapport soumis, dépense,
-- expirations, avances non justifiées) sont AUSSI envoyés sur Telegram quand le
-- tenant a un chat configuré — canal garanti, indépendant du navigateur.
-- À exécuter dans l'éditeur SQL Supabase (canal DDL habituel).

ALTER TABLE fleet.tenant_settings
  ADD COLUMN IF NOT EXISTS telegram_chat_id text;

COMMENT ON COLUMN fleet.tenant_settings.telegram_chat_id IS
  'Chat Telegram (id numérique) recevant les alertes admin du tenant — nécessite TELEGRAM_BOT_TOKEN côté serveur.';
