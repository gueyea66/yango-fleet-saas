-- ============================================================
-- YANGO FLEET SAAS — Multi-tenant schema
-- Run this ONCE on the new fleet-saas Supabase project
-- ============================================================

-- ── TENANTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug         TEXT UNIQUE NOT NULL,           -- 'abdou', 'alpha', 'beta'
  name         TEXT NOT NULL,                  -- 'M3A Fleet', 'Alpha Transport'
  domain       TEXT UNIQUE,                    -- custom domain (optional)
  plan         TEXT NOT NULL DEFAULT 'starter', -- starter | pro | enterprise
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ── TENANT SETTINGS (branding + config) ──────────────────────
CREATE TABLE IF NOT EXISTS tenant_settings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  app_name        TEXT NOT NULL DEFAULT 'Fleet Manager',
  logo_url        TEXT,                         -- URL du logo client
  primary_color   TEXT NOT NULL DEFAULT '#f5a623',
  currency        TEXT NOT NULL DEFAULT 'XOF',
  timezone        TEXT NOT NULL DEFAULT 'Africa/Dakar',
  operator_name   TEXT,                         -- nom affiché en bas de l'app
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

-- ── REMUNERATION CONFIG ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS remuneration_config (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  model             TEXT NOT NULL DEFAULT 'fixed', -- fixed | percent | hybrid
  base_amount       NUMERIC DEFAULT 0,           -- salaire fixe mensuel
  commission_rate   NUMERIC DEFAULT 0,           -- % du brut (0.0 à 1.0)
  bonus_threshold   NUMERIC DEFAULT 0,           -- seuil CA pour bonus
  bonus_amount      NUMERIC DEFAULT 0,           -- montant bonus si seuil atteint
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

-- ── EXISTING TABLES — add tenant_id ──────────────────────────
ALTER TABLE profiles        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE daily_reports   ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE expenses        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE payments        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE vehicles        ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE uploads         ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);

-- ── INDEXES ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_profiles_tenant      ON profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_daily_reports_tenant ON daily_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_expenses_tenant      ON expenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant      ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant      ON vehicles(tenant_id);

-- ── RLS ──────────────────────────────────────────────────────
-- Disable RLS on all tables (anon key is safe, access via tenant_id filter in app)
ALTER TABLE tenants              DISABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_settings      DISABLE ROW LEVEL SECURITY;
ALTER TABLE remuneration_config  DISABLE ROW LEVEL SECURITY;
ALTER TABLE profiles             DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_reports        DISABLE ROW LEVEL SECURITY;
ALTER TABLE expenses             DISABLE ROW LEVEL SECURITY;
ALTER TABLE payments             DISABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles             DISABLE ROW LEVEL SECURITY;
ALTER TABLE uploads              DISABLE ROW LEVEL SECURITY;

-- ── GRANTS ───────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- ── SEED : tenant M3A (Abdou) ─────────────────────────────────
INSERT INTO tenants (slug, name, plan) VALUES ('m3a', 'M3A Fleet', 'pro')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO tenant_settings (tenant_id, app_name, primary_color, currency, timezone, operator_name)
SELECT id, 'M3A Fleet Manager', '#f5a623', 'XOF', 'Africa/Dakar', 'M3A Group'
FROM tenants WHERE slug = 'm3a'
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO remuneration_config (tenant_id, model, base_amount)
SELECT id, 'fixed', 150000
FROM tenants WHERE slug = 'm3a'
ON CONFLICT (tenant_id) DO NOTHING;
