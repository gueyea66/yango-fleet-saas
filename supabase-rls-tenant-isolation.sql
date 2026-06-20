-- ============================================================
-- RLS TENANT ISOLATION — À exécuter dans Supabase SQL Editor
-- Garantit que chaque utilisateur ne voit QUE les données
-- de son tenant, même si le code oublie le filtre tenant_id.
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

-- Chaque utilisateur voit son propre profil
CREATE POLICY "profiles: own record" ON fleet.profiles
  FOR SELECT USING (id = auth.uid());

-- Les admins voient tous les profils de leur tenant
CREATE POLICY "profiles: same tenant" ON fleet.profiles
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── DAILY REPORTS ─────────────────────────────────────────────
ALTER TABLE fleet.daily_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_reports: tenant only" ON fleet.daily_reports
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── EXPENSES ──────────────────────────────────────────────────
ALTER TABLE fleet.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "expenses: tenant only" ON fleet.expenses
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── PAYMENTS ──────────────────────────────────────────────────
ALTER TABLE fleet.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "payments: tenant only" ON fleet.payments
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── VEHICLES ──────────────────────────────────────────────────
ALTER TABLE fleet.vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vehicles: tenant only" ON fleet.vehicles
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── VEHICLE MAINTENANCE ───────────────────────────────────────
ALTER TABLE fleet.vehicle_maintenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vehicle_maintenance: tenant only" ON fleet.vehicle_maintenance
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── REMUNERATION CONFIG ───────────────────────────────────────
ALTER TABLE fleet.remuneration_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "remuneration_config: tenant only" ON fleet.remuneration_config
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── TENANT SETTINGS ───────────────────────────────────────────
ALTER TABLE fleet.tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_settings: tenant only" ON fleet.tenant_settings
  FOR ALL USING (tenant_id = fleet.current_tenant_id());

-- ── TENANTS (lecture seule de son propre tenant) ──────────────
ALTER TABLE fleet.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenants: own tenant read" ON fleet.tenants
  FOR SELECT USING (id = fleet.current_tenant_id());

-- ── UPLOADS ───────────────────────────────────────────────────
-- Activer si la table existe
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'fleet' AND table_name = 'uploads') THEN
    EXECUTE 'ALTER TABLE fleet.uploads ENABLE ROW LEVEL SECURITY';
    EXECUTE 'CREATE POLICY "uploads: tenant only" ON fleet.uploads
             FOR ALL USING (tenant_id = fleet.current_tenant_id())';
  END IF;
END
$$;

-- ── SERVICE ROLE BYPASS ───────────────────────────────────────
-- Le service role (utilisé par les API routes) bypass RLS automatiquement.
-- Les admins créés via /api/superadmin/create-admin utilisent le service role
-- et peuvent donc écrire sans contrainte RLS — c'est voulu.

-- ── VÉRIFICATION ─────────────────────────────────────────────
-- Après exécution, vérifier dans Supabase Dashboard > Authentication > Policies
-- que toutes les tables ont bien des policies actives.
