-- Migration : isolement multi-tenant sur daily_reports et expenses
-- À exécuter dans Supabase SQL Editor

-- 1. Ajouter tenant_id aux tables
ALTER TABLE fleet.daily_reports ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES fleet.tenants(id) ON DELETE SET NULL;
ALTER TABLE fleet.expenses ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES fleet.tenants(id) ON DELETE SET NULL;

-- 2. Remplir tenant_id des lignes existantes depuis le profil du chauffeur
UPDATE fleet.daily_reports dr
SET tenant_id = p.tenant_id
FROM fleet.profiles p
WHERE dr.driver_id = p.id AND dr.tenant_id IS NULL;

UPDATE fleet.expenses e
SET tenant_id = p.tenant_id
FROM fleet.profiles p
WHERE e.driver_id = p.id AND e.tenant_id IS NULL;

-- 3. (Optionnel) Créer index pour performances
CREATE INDEX IF NOT EXISTS idx_daily_reports_tenant ON fleet.daily_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant ON fleet.expenses(tenant_id);
