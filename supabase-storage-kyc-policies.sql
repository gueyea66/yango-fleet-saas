-- ============================================================
-- STORAGE POLICIES — kyc-documents bucket
-- À exécuter dans Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- 1. Créer le bucket s'il n'existe pas encore
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'kyc-documents',
  'kyc-documents',
  false,
  52428800, -- 50 MB max
  NULL       -- tous les types MIME acceptés
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = 52428800,
  allowed_mime_types = NULL; -- supprimer les restrictions de type

-- 2. Politique : les utilisateurs authentifiés peuvent uploader
DROP POLICY IF EXISTS "kyc: authenticated upload" ON storage.objects;
CREATE POLICY "kyc: authenticated upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'kyc-documents');

-- 3. Politique : les utilisateurs authentifiés peuvent lire
DROP POLICY IF EXISTS "kyc: authenticated read" ON storage.objects;
CREATE POLICY "kyc: authenticated read"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'kyc-documents');

-- 4. Politique : les utilisateurs authentifiés peuvent mettre à jour (upsert)
DROP POLICY IF EXISTS "kyc: authenticated update" ON storage.objects;
CREATE POLICY "kyc: authenticated update"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'kyc-documents');

-- 5. Politique : les utilisateurs authentifiés peuvent supprimer leurs fichiers
DROP POLICY IF EXISTS "kyc: authenticated delete" ON storage.objects;
CREATE POLICY "kyc: authenticated delete"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'kyc-documents');
