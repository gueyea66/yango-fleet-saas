-- ════════════════════════════════════════════════════════════
-- 086 — Plateformes GPS connectées par leur API (GPSwox)
-- ════════════════════════════════════════════════════════════
-- Idempotente. ADDITIVE : une table nouvelle, rien d'existant n'est touché.
--
-- Demande d'Abdou (12/10/2026) : brancher les véhicules de NMK sur M3A Fleet
-- sans que NMK perde le signal sur sa plateforme GPSwox, et sans dépendre du
-- prestataire GPS. Le boîtier reste où il est ; M3A relit l'API de la
-- plateforme d'origine avec le compte du client.
--
-- Une ligne = le compte GPSwox d'une organisation. On n'y garde QUE la clé
-- d'API rendue à la connexion : le mot de passe n'est jamais stocké.
--
-- Cette clé donne accès à toute la flotte du client sur sa plateforme : la
-- table est donc fermée à tout ce qui n'est pas le serveur (RLS sans aucune
-- policy, droits retirés à anon et authenticated). Les écrans passent par
-- /api/admin/telematics/gpswox, qui ne la renvoie jamais.

CREATE TABLE IF NOT EXISTS fleet.telematics_sources (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'gpswox' CHECK (kind IN ('gpswox')),
  base_url       TEXT NOT NULL,              -- ex. http://173.249.19.50
  account        TEXT,                       -- identifiant du compte, pour l'affichage
  api_hash       TEXT,                       -- clé d'API ; NULL = déconnecté
  active         BOOLEAN NOT NULL DEFAULT true,
  last_polled_at TIMESTAMPTZ,                -- dernière tentative de relève
  last_ok_at     TIMESTAMPTZ,                -- dernière relève réussie
  last_error     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind)
);

ALTER TABLE fleet.telematics_sources ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON fleet.telematics_sources FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON fleet.telematics_sources TO service_role;

COMMENT ON TABLE fleet.telematics_sources IS
  'Comptes de plateformes GPS relus par API. Serveur uniquement : contient la clé d''API du client.';

/* ── Cadence de relève (à activer séparément, sur go) ─────────
   Le plan Vercel ne planifie qu'une fois par jour ; la relève passe par
   pg_cron + pg_net, déjà fournis par Supabase. Toutes les 15 secondes : c'est
   la cadence d'émission d'un boîtier en mouvement, donc presque aucun point
   n'est perdu entre deux lectures.

     SELECT cron.schedule('gpswox-releve', '15 seconds', $$
       SELECT net.http_post(
         url     := 'https://m3afleet.com/api/telematics/gpswox/poll',
         headers := jsonb_build_object('x-telematics-key',
                      (SELECT decrypted_secret FROM vault.decrypted_secrets
                        WHERE name = 'telematics_ingest_key')));
     $$);

   Arrêt :  SELECT cron.unschedule('gpswox-releve');
   ────────────────────────────────────────────────────────── */

/* ── Retour arrière ──────────────────────────────────────────
     DROP TABLE fleet.telematics_sources;
   Les boîtiers enrôlés et leurs positions ne sont pas concernés.
   ────────────────────────────────────────────────────────── */
