-- ============================================================
-- 061 — Accès tenant : supprimer l'échéance fantôme
-- À exécuter UNE FOIS dans le SQL Editor Supabase.
-- ============================================================
--
-- POURQUOI
-- --------
-- La migration 011 a posé `trial_ends_at TIMESTAMPTZ DEFAULT (now() + 30 days)`
-- sur TOUS les tenants, puis backfillé les existants. Le tenant de l'opérateur
-- (slug 'm3a', créé en 010 avec plan 'pro', jamais passé par un paiement) a
-- donc hérité d'une date de fin d'essai que personne n'a choisie, et
-- `plan_expires_at` est resté NULL.
--
-- Or la garde d'accès lit `plan_expires_at ?? trial_ends_at` : 30 jours après
-- la 011, l'admin de M3A se connecte, la session Supabase s'ouvre
-- normalement… et le middleware le renvoie sur /locked, pendant que l'API
-- répond 402. Vu du siège de l'utilisateur : « mon identifiant admin ne marche
-- plus ». Le seul remède disponible — « Étendre l'accès » dans la console —
-- repose une échéance à +30 jours, donc le problème revient chaque mois.
--
-- CE QUE FAIT CETTE MIGRATION
-- ---------------------------
-- 1. `never_expires` : un accès qui ne doit jamais tomber le dit explicitement,
--    au lieu de dépendre de l'absence accidentelle de deux dates.
-- 2. Le tenant de l'opérateur passe en accès permanent, et son échéance
--    fantôme est effacée.
-- 3. Le DEFAULT de `trial_ends_at` saute : une durée d'essai est une décision
--    métier (TRIAL_DAYS = 14 côté code, pas 30), pas un défaut de colonne qui
--    s'applique dans le dos de qui insère une ligne. Tous les chemins de
--    création (POST /api/register, console super admin) la posent déjà
--    explicitement.
-- 4. Un tenant qui a un `plan_expires_at` n'est plus « aussi » en essai.
--
-- IDEMPOTENTE : ré-exécutable sans effet de bord.
-- ============================================================

-- 1) Accès permanent, explicite
ALTER TABLE fleet.tenants
  ADD COLUMN IF NOT EXISTS never_expires BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN fleet.tenants.never_expires IS
  'true = aucune échéance ne s''applique (tenant opérateur, compte interne). Seul `active` peut alors fermer l''accès.';

-- 2) Le tenant de l'opérateur ne doit pas expirer
UPDATE fleet.tenants
   SET never_expires = true,
       trial_ends_at = NULL
 WHERE slug = 'm3a';

-- 3) Plus de deadline posée par défaut
ALTER TABLE fleet.tenants ALTER COLUMN trial_ends_at DROP DEFAULT;

-- 4) Payer met fin à l'essai — une seule échéance fait foi
UPDATE fleet.tenants
   SET trial_ends_at = NULL
 WHERE plan_expires_at IS NOT NULL
   AND trial_ends_at IS NOT NULL;

-- 5) Idem pour un tenant marqué « accès permanent » plus tard
UPDATE fleet.tenants
   SET trial_ends_at = NULL, plan_expires_at = NULL
 WHERE never_expires = true
   AND (trial_ends_at IS NOT NULL OR plan_expires_at IS NOT NULL);

-- ── Contrôle après exécution ────────────────────────────────
-- SELECT slug, plan, active, never_expires, trial_ends_at, plan_expires_at,
--        COALESCE(plan_expires_at, trial_ends_at) AS echeance_qui_fait_foi
--   FROM fleet.tenants ORDER BY created_at;
