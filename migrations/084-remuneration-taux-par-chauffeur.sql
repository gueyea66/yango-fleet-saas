-- ════════════════════════════════════════════════════════════
-- 084 — Rémunération : taux propres à un chauffeur
-- ════════════════════════════════════════════════════════════
-- Demande d'Abdou (08/10/2026) : chaque chauffeur peut avoir son propre
-- paramétrage ; s'il est « par défaut », celui de Paramètres › Rémunération
-- s'applique. Le modèle et le montant de base se réglaient déjà par chauffeur
-- (salary_model, base_amount) ; il manquait les taux.
--   salary_rate                 : part du chauffeur sur le CA brut (0–1)
--   salary_bonus_objectif_rate  : part du chauffeur sur le bonus d'objectif (0–1)
-- NULL = paramétrage par défaut du compte. Idempotent.

ALTER TABLE fleet.profiles ADD COLUMN IF NOT EXISTS salary_rate NUMERIC;
ALTER TABLE fleet.profiles ADD COLUMN IF NOT EXISTS salary_bonus_objectif_rate NUMERIC;
ALTER TABLE fleet.profiles DROP CONSTRAINT IF EXISTS profiles_salary_rate_check;
ALTER TABLE fleet.profiles ADD CONSTRAINT profiles_salary_rate_check
  CHECK (salary_rate IS NULL OR (salary_rate >= 0 AND salary_rate <= 1));
ALTER TABLE fleet.profiles DROP CONSTRAINT IF EXISTS profiles_salary_bonus_objectif_rate_check;
ALTER TABLE fleet.profiles ADD CONSTRAINT profiles_salary_bonus_objectif_rate_check
  CHECK (salary_bonus_objectif_rate IS NULL OR (salary_bonus_objectif_rate >= 0 AND salary_bonus_objectif_rate <= 1));
COMMENT ON COLUMN fleet.profiles.salary_rate IS
  'Part du chauffeur sur le CA brut (0–1). NULL = remuneration_config.commission_rate.';
COMMENT ON COLUMN fleet.profiles.salary_bonus_objectif_rate IS
  'Part du chauffeur sur le bonus d''objectif (0–1). NULL = remuneration_config.bonus_objectif_rate.';

-- Contrôle : 2
SELECT count(*) AS colonnes FROM information_schema.columns
WHERE table_schema = 'fleet' AND table_name = 'profiles' AND column_name IN ('salary_rate', 'salary_bonus_objectif_rate');
