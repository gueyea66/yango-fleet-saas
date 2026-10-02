-- Rattrapage : pièces jointes sans tenant_id (8 lignes au 01/10/2026, toutes du
-- 18/06, antérieures au déclencheur guard_uploads). Sans tenant, la RLS les
-- cache à l'admin et /api/kyc-signed-urls refuse de les signer : photos
-- « invisibles » dans l'historique.
-- Tenant = celui du chauffeur ; ref_id = l'uuid présent dans le chemin, s'il
-- correspond bien à un rapport ou une dépense du même chauffeur.
-- Idempotent : ne touche que les lignes encore à NULL.

BEGIN;

UPDATE fleet.uploads u
SET tenant_id = p.tenant_id
FROM fleet.profiles p
WHERE u.tenant_id IS NULL AND p.id = u.driver_id AND p.tenant_id IS NOT NULL;

UPDATE fleet.uploads u
SET ref_id = r.id
FROM fleet.daily_reports r
WHERE u.ref_id IS NULL AND u.file_type = 'report'
  AND r.driver_id = u.driver_id
  AND u.file_path LIKE '%' || r.id::text || '%';  -- le chemin peut commencer par l'uuid tenant/chauffeur

-- Contrôle : doit renvoyer 0
SELECT count(*) AS reste_sans_tenant FROM fleet.uploads WHERE tenant_id IS NULL;

COMMIT;
