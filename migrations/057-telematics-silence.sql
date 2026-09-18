-- ============================================================
-- MIGRATION 057 — ALERTE QUAND UN BOÎTIER SE TAIT
--
-- Idempotente. ADDITIVE.
--
-- Le 17/09/2026, la passerelle est restée en panne douze heures sans que
-- personne ne le sache : l'écran affichait bien « silencieux depuis X », mais
-- personne ne regarde un écran la nuit. Un flux GPS coupé ne doit pas attendre
-- qu'on le remarque.
--
-- `silence_alerted_at` retient qu'une alerte a déjà été émise pour l'épisode
-- en cours : sans cela, un boîtier muet pendant trois jours enverrait une
-- alerte à chaque passage, et plus personne ne les lirait.
-- ============================================================

ALTER TABLE fleet.telematics_devices
  ADD COLUMN IF NOT EXISTS silence_alerted_at TIMESTAMPTZ;

COMMENT ON COLUMN fleet.telematics_devices.silence_alerted_at IS
  'Horodatage de la dernière alerte de silence. Remis à NULL dès que le boîtier réémet.';
