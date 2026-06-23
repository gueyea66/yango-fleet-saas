-- ============================================================
-- MIGRATION: Colonnes manquantes sur fleet.daily_reports
-- et fleet.expenses — à exécuter dans Supabase SQL Editor
-- ============================================================

-- Colonnes manquantes sur daily_reports
ALTER TABLE fleet.daily_reports
  ADD COLUMN IF NOT EXISTS solde_yango          NUMERIC        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS partner_rate         NUMERIC        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS vehicle_id           UUID           DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS yango_bonus          NUMERIC        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS off_yango_revenue    NUMERIC        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS yango_trip_count     INT            DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS off_yango_trip_count INT            DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS end_odometer         INT            DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment              TEXT           DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason     TEXT           DEFAULT NULL;

-- Colonnes manquantes sur expenses
ALTER TABLE fleet.expenses
  ADD COLUMN IF NOT EXISTS expense_date   DATE           DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS status         TEXT           NOT NULL DEFAULT 'submitted',
  ADD COLUMN IF NOT EXISTS category       TEXT           DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS tenant_id      UUID           REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS fuel_liters    NUMERIC(8,2)   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS fuel_odometer  INT            DEFAULT NULL;

-- Source tag (si pas encore fait)
ALTER TABLE fleet.daily_reports ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'saas';
ALTER TABLE fleet.expenses      ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'saas';

-- Index utiles
CREATE INDEX IF NOT EXISTS idx_daily_reports_vehicle ON fleet.daily_reports(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_solde   ON fleet.daily_reports(solde_yango);
CREATE INDEX IF NOT EXISTS idx_expenses_date         ON fleet.expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_status       ON fleet.expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_category     ON fleet.expenses(category);
