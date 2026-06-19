-- Migration : module gestion de flotte
-- À exécuter dans Supabase SQL Editor (fleet schema)

-- 1. Étendre la table fleet.vehicles
ALTER TABLE fleet.vehicles
  ADD COLUMN IF NOT EXISTS tenant_id        UUID REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS color            TEXT,
  ADD COLUMN IF NOT EXISTS fuel_type        TEXT NOT NULL DEFAULT 'essence',
  ADD COLUMN IF NOT EXISTS transmission     TEXT NOT NULL DEFAULT 'manuelle',
  ADD COLUMN IF NOT EXISTS vin              TEXT,
  ADD COLUMN IF NOT EXISTS mileage          INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS partner_rate     NUMERIC,
  ADD COLUMN IF NOT EXISTS insurance_company  TEXT,
  ADD COLUMN IF NOT EXISTS insurance_number   TEXT,
  ADD COLUMN IF NOT EXISTS insurance_expiry   DATE,
  ADD COLUMN IF NOT EXISTS visite_expiry      DATE,
  ADD COLUMN IF NOT EXISTS notes              TEXT,
  ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2. Table maintenance / incidents
CREATE TABLE IF NOT EXISTS fleet.vehicle_maintenance (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id   UUID NOT NULL REFERENCES fleet.vehicles(id) ON DELETE CASCADE,
  tenant_id    UUID REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  driver_id    UUID REFERENCES fleet.profiles(id) ON DELETE SET NULL,
  type         TEXT NOT NULL DEFAULT 'maintenance',
  -- maintenance | reparation | accident | visite_technique | vidange | autre
  title        TEXT NOT NULL,
  description  TEXT,
  cost         NUMERIC NOT NULL DEFAULT 0,
  mileage_at   INT,
  date         DATE NOT NULL DEFAULT CURRENT_DATE,
  status       TEXT NOT NULL DEFAULT 'done',
  -- planned | done | cancelled
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_tenant ON fleet.vehicles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_fleet_vehicles_status ON fleet.vehicles(status);
CREATE INDEX IF NOT EXISTS idx_maint_vehicle ON fleet.vehicle_maintenance(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maint_tenant  ON fleet.vehicle_maintenance(tenant_id);
CREATE INDEX IF NOT EXISTS idx_maint_date    ON fleet.vehicle_maintenance(date);

ALTER TABLE fleet.vehicle_maintenance DISABLE ROW LEVEL SECURITY;
