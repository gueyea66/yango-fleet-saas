-- ════════════════════════════════════════════════════════════
-- 082 — Bonus d'objectif : dans le CA, et part chauffeur à un taux propre
-- ════════════════════════════════════════════════════════════
-- Demande d'Abdou (07/10/2026, après la formation NMK) : quand Yango verse un
-- « Bonus d'objectif », le chauffeur en touche 50 %, contre 20 % sur le reste.
--   salaire = (CA brut − bonus d'objectif) × 20 % + bonus d'objectif × 50 %
-- Le bonus doit donc faire partie du CA.
--
-- 1. remuneration_config.bonus_objectif_rate : taux propre au bonus d'objectif.
--    NULL = même taux que le reste (aucun changement pour les autres comptes).
--    Posé à 0,5 pour NMK et son compte de formation.
-- 2. fleetroom_rebuild : un jour où Yango ne crédite qu'un bonus (aucune course)
--    n'avait pas de journée, donc le bonus n'entrait pas dans le CA (45 jours
--    sur NMK, 531 135 F sur 2025-2026). Ces jours ont désormais leur journée :
--    0 course, le bonus en recette. Relancer ensuite le recalcul (script).
--
-- La table remuneration_config n'accepte l'écriture que d'un gestionnaire ou du
-- serveur (guard_admin_only) : la transaction se déclare « serveur ».
-- Idempotent.

BEGIN;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true),
       set_config('request.jwt.claim.role', 'service_role', true);

ALTER TABLE fleet.remuneration_config ADD COLUMN IF NOT EXISTS bonus_objectif_rate NUMERIC;
ALTER TABLE fleet.remuneration_config DROP CONSTRAINT IF EXISTS remuneration_config_bonus_objectif_rate_check;
ALTER TABLE fleet.remuneration_config ADD CONSTRAINT remuneration_config_bonus_objectif_rate_check
  CHECK (bonus_objectif_rate IS NULL OR (bonus_objectif_rate >= 0 AND bonus_objectif_rate <= 1));
COMMENT ON COLUMN fleet.remuneration_config.bonus_objectif_rate IS
  'Part du chauffeur sur le bonus d''objectif (0–1). NULL = même taux que commission_rate.';

UPDATE fleet.remuneration_config r SET bonus_objectif_rate = 0.5
FROM fleet.tenants t WHERE t.id = r.tenant_id AND t.slug IN ('nmk', 'nmk-formation') AND r.bonus_objectif_rate IS NULL;

DO $$
DECLARE src TEXT;
  avant TEXT := 'AND (COALESCE(o.courses, 0) > 0 OR COALESCE(c.especes, 0) + COALESCE(c.carte, 0) <> 0);';
  apres TEXT := 'AND (COALESCE(o.courses, 0) > 0 OR COALESCE(c.especes, 0) + COALESCE(c.carte, 0) <> 0 OR COALESCE(c.bonus, 0) <> 0);';
BEGIN
  SELECT pg_get_functiondef('fleet.fleetroom_rebuild(uuid,date,date)'::regprocedure) INTO src;
  IF position(apres IN src) > 0 THEN RETURN; END IF;   -- déjà appliquée
  IF position(avant IN src) = 0 THEN
    RAISE EXCEPTION 'fleetroom_rebuild : définition inattendue, migration 082 non appliquée';
  END IF;
  EXECUTE replace(src, avant, apres);
END $$;

COMMIT;

-- Contrôle : 0.2 et 0.5 pour les deux comptes, et rebuild_a_jour = true
SELECT t.slug, r.commission_rate, r.bonus_objectif_rate,
  position('OR COALESCE(c.bonus, 0) <> 0' IN pg_get_functiondef('fleet.fleetroom_rebuild(uuid,date,date)'::regprocedure)) > 0 AS rebuild_a_jour
FROM fleet.tenants t JOIN fleet.remuneration_config r ON r.tenant_id = t.id
WHERE t.slug IN ('nmk', 'nmk-formation');
