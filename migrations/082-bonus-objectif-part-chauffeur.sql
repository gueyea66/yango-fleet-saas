-- ════════════════════════════════════════════════════════════
-- 082 — Bonus d'objectif : part chauffeur à un taux propre
-- ════════════════════════════════════════════════════════════
-- Demande d'Abdou (07/10/2026, après la formation NMK) : quand Yango verse un
-- « Bonus d'objectif », le chauffeur en touche 50 %, contre 20 % sur le reste.
--   salaire = (CA brut − bonus d'objectif) × 20 % + bonus d'objectif × 50 %
--
-- remuneration_config.bonus_objectif_rate : taux propre au bonus d'objectif.
-- NULL = même taux que le reste (aucun changement pour les autres comptes).
-- Le bonus d'objectif lui-même est lu dans les transactions Yango (catégorie
-- « bonus », commentaire « Bonus d'objectif ») : rien d'autre à stocker.
-- Idempotent.

ALTER TABLE fleet.remuneration_config ADD COLUMN IF NOT EXISTS bonus_objectif_rate NUMERIC;
ALTER TABLE fleet.remuneration_config DROP CONSTRAINT IF EXISTS remuneration_config_bonus_objectif_rate_check;
ALTER TABLE fleet.remuneration_config ADD CONSTRAINT remuneration_config_bonus_objectif_rate_check
  CHECK (bonus_objectif_rate IS NULL OR (bonus_objectif_rate >= 0 AND bonus_objectif_rate <= 1));
COMMENT ON COLUMN fleet.remuneration_config.bonus_objectif_rate IS
  'Part du chauffeur sur le bonus d''objectif (0–1). NULL = même taux que commission_rate.';

-- NMK et son compte de formation : 50 % du bonus d'objectif pour le chauffeur
UPDATE fleet.remuneration_config r SET bonus_objectif_rate = 0.5
FROM fleet.tenants t WHERE t.id = r.tenant_id AND t.slug IN ('nmk', 'nmk-formation') AND r.bonus_objectif_rate IS NULL;

-- Contrôle : les deux comptes doivent afficher 0.2 et 0.5
SELECT t.slug, r.model, r.commission_rate, r.bonus_objectif_rate
FROM fleet.tenants t JOIN fleet.remuneration_config r ON r.tenant_id = t.id
WHERE t.slug IN ('nmk', 'nmk-formation');
