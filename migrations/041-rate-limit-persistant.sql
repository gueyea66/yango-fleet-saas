-- ============================================================
-- MIGRATION 041 — RATE-LIMIT PERSISTANT (fix audit V4)
-- ------------------------------------------------------------
-- Le rate-limiting en mémoire (Map) est inefficace sur Vercel (serverless,
-- instances multiples/éphémères) : les compteurs ne sont ni partagés ni
-- persistants. On les déporte en base, avec un compteur atomique par bucket.
-- Utilisé par /api/superadmin/verify et /api/register.
-- Idempotente. La table est deny-all (service_role uniquement).
-- ============================================================

CREATE TABLE IF NOT EXISTS fleet.rate_limits (
  bucket       text PRIMARY KEY,
  count        int  NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE fleet.rate_limits ENABLE ROW LEVEL SECURITY;
-- Aucune policy → deny-all pour anon/authenticated ; seul service_role écrit.
REVOKE ALL ON fleet.rate_limits FROM anon, authenticated;

-- Incrément atomique. Retourne TRUE si la requête est autorisée (sous la
-- limite), FALSE si le seuil est dépassé dans la fenêtre courante.
CREATE OR REPLACE FUNCTION fleet.rate_limit_hit(
  p_bucket text, p_max int, p_window_sec int
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count int;
BEGIN
  INSERT INTO fleet.rate_limits (bucket, count, window_start)
    VALUES (p_bucket, 1, now())
  ON CONFLICT (bucket) DO UPDATE SET
    count = CASE
      WHEN fleet.rate_limits.window_start < now() - make_interval(secs => p_window_sec)
      THEN 1 ELSE fleet.rate_limits.count + 1 END,
    window_start = CASE
      WHEN fleet.rate_limits.window_start < now() - make_interval(secs => p_window_sec)
      THEN now() ELSE fleet.rate_limits.window_start END
  RETURNING count INTO v_count;
  RETURN v_count <= p_max;
END $$;

-- Purge optionnelle des vieux buckets (à appeler par un cron si besoin).
CREATE OR REPLACE FUNCTION fleet.rate_limit_gc(p_older_than_sec int DEFAULT 86400)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$ DELETE FROM fleet.rate_limits
      WHERE window_start < now() - make_interval(secs => p_older_than_sec) $$;
-- ============================================================
