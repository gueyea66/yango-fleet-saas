-- Migration 045 — 2026-09-02
-- La table fleet.kyc_documents a été créée hors migration (dashboard), sans
-- GRANT ni RLS : « permission denied for table kyc_documents » pour TOUS les
-- rôles API (service_role compris) → onboarding KYC inutilisable (upload et
-- liste des documents, côté admin comme côté chauffeur).
--
-- Correctif idempotent :
--   1. GRANTs (service_role complet ; authenticated en lecture/écriture,
--      contrôlé par RLS — pas de DELETE : un document KYC se remplace,
--      il ne se supprime pas depuis le client).
--   2. RLS : chauffeur limité à SES documents ; admin limité à SON tenant.
--      (Documents d'identité = données sensibles : pas de policy « tenant
--      only » générique qui laisserait un chauffeur lire la CNI d'un collègue.)
--   3. Policies storage du bucket kyc-documents (lecture des aperçus signés
--      côté client) : chemins réels écrits par /api/kyc-upload =
--      tenantId/…  (admin) et tenantId/userId/…  (chauffeur).

-- ── 1. GRANTs table ─────────────────────────────────────────────────────
GRANT ALL ON fleet.kyc_documents TO service_role;
GRANT SELECT, INSERT, UPDATE ON fleet.kyc_documents TO authenticated;

-- ── 2. RLS table ────────────────────────────────────────────────────────
ALTER TABLE fleet.kyc_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "kyc: driver own docs" ON fleet.kyc_documents;
CREATE POLICY "kyc: driver own docs" ON fleet.kyc_documents
  FOR ALL
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid() AND tenant_id = fleet.current_tenant_id());

DROP POLICY IF EXISTS "kyc: tenant admin" ON fleet.kyc_documents;
CREATE POLICY "kyc: tenant admin" ON fleet.kyc_documents
  FOR ALL
  USING (
    tenant_id = fleet.current_tenant_id()
    AND EXISTS (SELECT 1 FROM fleet.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    tenant_id = fleet.current_tenant_id()
    AND EXISTS (SELECT 1 FROM fleet.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ── 3. Storage (bucket privé kyc-documents, signed URLs côté client) ───
-- Chauffeur : uniquement son dossier tenant/uid/…
DROP POLICY IF EXISTS "kyc storage: driver own folder" ON storage.objects;
CREATE POLICY "kyc storage: driver own folder" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (storage.foldername(name))[1] = fleet.current_tenant_id()::text
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Admin : tout le préfixe de SON tenant.
DROP POLICY IF EXISTS "kyc storage: tenant admin" ON storage.objects;
CREATE POLICY "kyc storage: tenant admin" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (storage.foldername(name))[1] = fleet.current_tenant_id()::text
    AND EXISTS (SELECT 1 FROM fleet.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );
