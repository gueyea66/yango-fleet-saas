-- ============================================================
-- MIGRATION 021 — INDEXES COMPOSITES POUR LES REQUÊTES FRÉQUENTES
-- À exécuter dans Supabase Dashboard > SQL Editor
-- Idempotent : IF NOT EXISTS sur tous les indexes.
-- ============================================================

-- Requêtes par tenant + date (très fréquentes pour les tableaux de bord)
CREATE INDEX IF NOT EXISTS idx_daily_reports_tenant_date
  ON fleet.daily_reports(tenant_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_reports_tenant_driver_date
  ON fleet.daily_reports(tenant_id, driver_id, date DESC);

-- Dépenses par tenant + chauffeur
CREATE INDEX IF NOT EXISTS idx_expenses_tenant_driver
  ON fleet.expenses(tenant_id, driver_id);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date
  ON fleet.expenses(tenant_id, expense_date DESC);

-- Paiements par tenant + date
CREATE INDEX IF NOT EXISTS idx_payments_tenant_date
  ON fleet.payments(tenant_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_tenant_driver
  ON fleet.payments(tenant_id, driver_id);

-- Véhicules par tenant
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant
  ON fleet.vehicles(tenant_id);

-- Profils par tenant + rôle (listing des chauffeurs)
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_role
  ON fleet.profiles(tenant_id, role);

-- Vérification :
-- SELECT indexname, tablename FROM pg_indexes WHERE schemaname = 'fleet' ORDER BY tablename;
