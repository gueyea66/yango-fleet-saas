-- Migration 032 — Dimension « type de compte » sur les profils chauffeur.
--
-- 'driver'    = vrai chauffeur (compte par défaut).
-- 'technical' = compte technique / de décaissement (ex. « Founder ») servant à
--               enregistrer des dépenses/décaissements sans être un chauffeur réel.
--
-- Les comptes 'technical' sont EXCLUS des relances, des alertes d'inactivité et de
-- la masse salariale / effectif, MAIS leurs déclarations restent comptées dans les
-- chiffres (recettes, dépenses).
--
-- Additive et sûre : colonne avec valeur par défaut, aucun impact sur l'existant
-- (tous les comptes actuels deviennent 'driver'). À classer manuellement ensuite.

ALTER TABLE fleet.profiles
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'driver';

-- Garde-fou : seules deux valeurs autorisées.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_account_type_check'
  ) THEN
    ALTER TABLE fleet.profiles
      ADD CONSTRAINT profiles_account_type_check
      CHECK (account_type IN ('driver', 'technical'));
  END IF;
END $$;
