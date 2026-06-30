-- ============================================================
-- MIGRATION 020 — ACTIVATION RLS IDEMPOTENTE
-- À exécuter dans Supabase Dashboard > SQL Editor
--
-- Idempotente : peut être relancée plusieurs fois sans erreur.
-- Remplace la migration 010 qui désactivait le RLS.
-- ============================================================

-- Helper : retourne le tenant_id de l'utilisateur connecté
CREATE OR REPLACE FUNCTION fleet.current_tenant_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT tenant_id FROM fleet.profiles WHERE id = auth.uid()
$$;

-- ── PROFILES ──────────────────────────────────────────────────
ALTER TABLE fleet.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles: own record"  ON fleet.profiles;
DROP POLICY IF EXISTS "profiles: same tenant" ON fleet.profiles;

CREATE POLICY "profiles: own record" ON fleet.profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles: same tenant" ON fleet.profiles
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── DAILY REPORTS ─────────────────────────────────────────────
ALTER TABLE fleet.daily_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "daily_reports: tenant only" ON fleet.daily_reports;

CREATE POLICY "daily_reports: tenant only" ON fleet.daily_reports
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── EXPENSES ──────────────────────────────────────────────────
ALTER TABLE fleet.expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses: tenant only" ON fleet.expenses;

CREATE POLICY "expenses: tenant only" ON fleet.expenses
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── PAYMENTS ──────────────────────────────────────────────────
ALTER TABLE fleet.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payments: tenant only" ON fleet.payments;

CREATE POLICY "payments: tenant only" ON fleet.payments
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── VEHICLES ──────────────────────────────────────────────────
ALTER TABLE fleet.vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicles: tenant only" ON fleet.vehicles;

CREATE POLICY "vehicles: tenant only" ON fleet.vehicles
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── VEHICLE MAINTENANCE ───────────────────────────────────────
ALTER TABLE fleet.vehicle_maintenance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicle_maintenance: tenant only" ON fleet.vehicle_maintenance;

CREATE POLICY "vehicle_maintenance: tenant only" ON fleet.vehicle_maintenance
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── REMUNERATION CONFIG ───────────────────────────────────────
ALTER TABLE fleet.remuneration_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "remuneration_config: tenant only" ON fleet.remuneration_config;

CREATE POLICY "remuneration_config: tenant only" ON fleet.remuneration_config
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── TENANT SETTINGS ───────────────────────────────────────────
ALTER TABLE fleet.tenant_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_settings: tenant only" ON fleet.tenant_settings;

CREATE POLICY "tenant_settings: tenant only" ON fleet.tenant_settings
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── TENANTS (lecture seule de son propre tenant) ──────────────
ALTER TABLE fleet.tenants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenants: own tenant read" ON fleet.tenants;

CREATE POLICY "tenants: own tenant read" ON fleet.tenants
  FOR SELECT USING (id = fleet.current_tenant_id());

-- ── UPLOADS ───────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'fleet' AND table_name = 'uploads') THEN
    EXECUTE 'ALTER TABLE fleet.uploads ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "uploads: tenant only" ON fleet.uploads';
    EXECUTE 'CREATE POLICY "uploads: tenant only" ON fleet.uploads
             FOR ALL USING (tenant_id = fleet.current_tenant_id())';
  END IF;
END
$$;

-- ── VÉRIFICATION ─────────────────────────────────────────────
-- Après exécution, vérifier :
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'fleet';
-- Toutes les tables doivent avoir rowsecurity = true.
