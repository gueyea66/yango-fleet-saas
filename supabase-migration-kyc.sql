-- Migration : module KYC / onboarding chauffeurs
-- À exécuter dans Supabase SQL Editor (fleet schema)

-- 1. Étendre la table profiles
ALTER TABLE fleet.profiles
  ADD COLUMN IF NOT EXISTS address              TEXT,
  ADD COLUMN IF NOT EXISTS city                 TEXT,
  ADD COLUMN IF NOT EXISTS emergency_name       TEXT,
  ADD COLUMN IF NOT EXISTS emergency_phone      TEXT,
  ADD COLUMN IF NOT EXISTS emergency_relation   TEXT,
  ADD COLUMN IF NOT EXISTS driver_level         TEXT NOT NULL DEFAULT 'debutant',
  ADD COLUMN IF NOT EXISTS years_experience     INT  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS onboarding_status    TEXT NOT NULL DEFAULT 'incomplete',
  ADD COLUMN IF NOT EXISTS onboarding_submitted TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_reviewed  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_notes     TEXT,
  ADD COLUMN IF NOT EXISTS birth_date           DATE,
  ADD COLUMN IF NOT EXISTS nationality          TEXT,
  ADD COLUMN IF NOT EXISTS license_number       TEXT,
  ADD COLUMN IF NOT EXISTS license_expiry       DATE,
  ADD COLUMN IF NOT EXISTS joined_at            TIMESTAMPTZ DEFAULT now();

-- 2. Table documents KYC
CREATE TABLE IF NOT EXISTS fleet.kyc_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   UUID NOT NULL REFERENCES fleet.profiles(id) ON DELETE CASCADE,
  tenant_id   UUID REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL,
  -- cni_recto | cni_verso | permis_recto | permis_verso | contrat | photo_profil | autre
  file_path   TEXT NOT NULL,
  file_name   TEXT,
  file_size   BIGINT,
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  notes       TEXT,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID
);

CREATE INDEX IF NOT EXISTS idx_kyc_driver   ON fleet.kyc_documents(driver_id);
CREATE INDEX IF NOT EXISTS idx_kyc_tenant   ON fleet.kyc_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kyc_type     ON fleet.kyc_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_kyc_status   ON fleet.kyc_documents(status);

-- 3. Index profiles
CREATE INDEX IF NOT EXISTS idx_profiles_onboarding ON fleet.profiles(onboarding_status);
CREATE INDEX IF NOT EXISTS idx_profiles_level      ON fleet.profiles(driver_level);

-- 4. Disable RLS (cohérent avec les autres tables)
ALTER TABLE fleet.kyc_documents DISABLE ROW LEVEL SECURITY;

-- 5. Bucket Supabase Storage : kyc-documents (à créer manuellement dans Storage)
-- Nom : kyc-documents | Public : false | Policies : authentifié uniquement
