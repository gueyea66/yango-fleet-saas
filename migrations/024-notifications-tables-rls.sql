-- Migration 024 — 2026-07-02
-- 1) Formalise les tables créées manuellement en prod (notifications, push_subscriptions,
--    superadmin_settings) pour rendre le schéma reproductible (déploiements white-label).
-- 2) Corrige la faille de la migration 011 : notification_log était accessible avec la clé anon.
--
-- Idempotente : peut être rejouée sans risque (IF NOT EXISTS partout).
-- Ces tables ne sont accédées que via service_role côté serveur :
-- RLS activé SANS policy = accès refusé pour anon/authenticated (deny by default).

-- ── Notifications in-app ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet.notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL,
  type         text NOT NULL,
  title        text NOT NULL,
  body         text,
  data         jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON fleet.notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON fleet.notifications (recipient_id) WHERE read_at IS NULL;

-- ── Abonnements Web Push ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fleet.push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

-- ── Réglages superadmin (clé d'accès, confirmations de paiement) ──
CREATE TABLE IF NOT EXISTS fleet.superadmin_settings (
  key        text PRIMARY KEY,
  value      text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Verrouillage : service_role uniquement ───────────────────────
ALTER TABLE fleet.notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.push_subscriptions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.superadmin_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON fleet.notifications       FROM anon, authenticated;
REVOKE ALL ON fleet.push_subscriptions  FROM anon, authenticated;
REVOKE ALL ON fleet.superadmin_settings FROM anon, authenticated;

-- ── Correction migration 011 : notification_log ──────────────────
ALTER TABLE fleet.notification_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON fleet.notification_log FROM anon, authenticated;
