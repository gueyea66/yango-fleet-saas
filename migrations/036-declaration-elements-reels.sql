-- Migration 036 — 2026-08-04
-- Éléments réels Yango dans la déclaration journalière (retour terrain Abdou,
-- vraie capture Yango Pro « Comparatif » du 03/08/2026).
--
-- L'app Yango Pro affiche les éléments BRUTS : Espèces, Carte, Bonus,
-- Commission du service, Commissions du partenaire, Services supplémentaires.
-- Brut Yango = Espèces + Carte. Le chauffeur (ou l'extraction vision) reporte
-- ces éléments TELS QUELS — aucun calcul.
--
-- 100% ADDITIVE : colonnes NULLABLES uniquement, pattern des migrations
-- daily-reports-v2. Aucun comportement existant ne change (les rapports
-- historiques restent valides, les nouveaux champs sont optionnels).
-- lib/calc.ts reste l'unique source des commissions THÉORIQUES ; les
-- commissions réelles lues dans l'app sont stockées à titre déclaratif
-- (réconciliation solde consommé ↔ commissions déclarées).
-- Idempotente.

ALTER TABLE fleet.daily_reports
  ADD COLUMN IF NOT EXISTS yango_cash NUMERIC NULL,                   -- « Espèces » (FCFA)
  ADD COLUMN IF NOT EXISTS yango_card NUMERIC NULL,                   -- « Carte » (FCFA, absent certains jours)
  ADD COLUMN IF NOT EXISTS commission_yango_reelle NUMERIC NULL,      -- « Commission du service » (valeur absolue)
  ADD COLUMN IF NOT EXISTS commission_partenaire_reelle NUMERIC NULL; -- « Commissions du partenaire » (valeur absolue)

COMMENT ON COLUMN fleet.daily_reports.yango_cash IS
  'Espèces encaissées (app Yango Pro) — brut = yango_cash + yango_card';
COMMENT ON COLUMN fleet.daily_reports.yango_card IS
  'Paiements carte (app Yango Pro) — null si aucun paiement carte ce jour';
COMMENT ON COLUMN fleet.daily_reports.commission_yango_reelle IS
  'Commission du service affichée par Yango (valeur absolue) — déclaratif, calc.ts reste la référence théorique';
COMMENT ON COLUMN fleet.daily_reports.commission_partenaire_reelle IS
  'Commissions du partenaire affichées par Yango (valeur absolue) — déclaratif';
