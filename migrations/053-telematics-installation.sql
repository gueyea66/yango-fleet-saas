-- ============================================================
-- MIGRATION 053 — INSTALLATION DES BOÎTIERS PAR LE GESTIONNAIRE
--
-- Idempotente. ADDITIVE : colonnes nouvelles, toutes facultatives.
--
-- Permet à un gestionnaire d'installer un boîtier chez un client sans
-- intervention technique, en gardant pour CHAQUE boîtier le chemin de retour
-- vers sa plateforme d'origine. Sans lui, une bascule ratée chez un client se
-- règle par un déplacement sur site.
-- ============================================================

ALTER TABLE fleet.telematics_devices
  ADD COLUMN IF NOT EXISTS original_server_ip   TEXT,
  ADD COLUMN IF NOT EXISTS original_server_port INTEGER,
  ADD COLUMN IF NOT EXISTS sms_password         TEXT,
  ADD COLUMN IF NOT EXISTS firmware             TEXT,
  ADD COLUMN IF NOT EXISTS apn                  TEXT,
  ADD COLUMN IF NOT EXISTS upload_interval_s    INTEGER,
  ADD COLUMN IF NOT EXISTS rconf_raw            TEXT,
  ADD COLUMN IF NOT EXISTS rconf_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS installed_at         TIMESTAMPTZ;

COMMENT ON COLUMN fleet.telematics_devices.original_server_ip IS
  'Serveur relevé par RCONF AVANT la bascule — chemin de retour vers la plateforme d''origine.';
COMMENT ON COLUMN fleet.telematics_devices.sms_password IS
  'Mot de passe SMS du boîtier. Jamais exposé aux comptes du navigateur (cf. révocation ci-dessous).';
COMMENT ON COLUMN fleet.telematics_devices.rconf_raw IS
  'Réponse RCONF telle que collée, numéro de téléphone autorisé retiré.';

-- ── Le mot de passe SMS ne doit pas être lisible depuis le navigateur ──────
-- La politique RLS de la 049 laissait tout membre du tenant — chauffeurs
-- compris — lire la table directement avec la clé publique. Avec un mot de
-- passe SMS désormais stocké, c'est trop large. Plus aucun écran ne lit cette
-- table en direct : tout passe par les routes serveur, qui vérifient le rôle.
REVOKE SELECT ON fleet.telematics_devices FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON fleet.telematics_devices TO service_role;
