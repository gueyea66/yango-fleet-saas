-- ============================================================
-- MIGRATION: Ajout colonne fuel_liters sur fleet.expenses
-- Pour un calcul précis du prix au litre
-- À exécuter dans Supabase SQL Editor
-- ============================================================

ALTER TABLE fleet.expenses
  ADD COLUMN IF NOT EXISTS fuel_liters NUMERIC(8,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fuel_odometer INTEGER DEFAULT NULL;

COMMENT ON COLUMN fleet.expenses.fuel_liters IS 'Litres déclarés (uniquement pour Carburant)';
COMMENT ON COLUMN fleet.expenses.fuel_odometer IS 'Kilométrage au moment du plein';
