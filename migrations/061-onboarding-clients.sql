-- ============================================================
-- MIGRATION 061 — FICHES D'ONBOARDING CLIENT
--
-- Idempotente. ADDITIVE : une seule table nouvelle, aucune donnée existante
-- touchée.
--
-- Le suivi de mise en service d'un client (ce qu'il doit fournir, son parc,
-- ses chauffeurs, sa règle de versement) vivait hors de l'application : une
-- page isolée qui ne pouvait pas écrire dans M3A Fleet. Conséquence directe,
-- la double saisie — le parc noté d'un côté, re-créé à la main de l'autre.
--
-- La fiche revient donc dans la base, à côté des clients qu'elle prépare :
--   • un enregistrement par client en préparation, identifié par son futur
--     slug, pour que la fiche et l'espace créé portent le même nom ;
--   • le contenu en JSONB — la fiche est un brouillon qui change de forme au
--     fil des dossiers, la figer en colonnes obligerait une migration à chaque
--     champ ajouté ;
--   • `tenant_id` et `provisioned_at` renseignés à la mise en service, seule
--     trace qui distingue une fiche encore en préparation d'une fiche déjà
--     versée dans l'application. C'est ce qui rend la mise en service
--     rejouable sans créer de doublon.
--
-- Accès : réservé à la console superadmin (service_role). La RLS est activée
-- sans aucune policy — donc aucune lecture possible avec la clé anon, y
-- compris pour un admin client connecté. Une fiche contient le devis, les
-- coordonnées du gérant et les pièces des chauffeurs d'un prospect : elle ne
-- regarde aucun tenant, pas même celui qu'elle prépare.
-- ============================================================

CREATE TABLE IF NOT EXISTS fleet.onboarding_files (
  id              TEXT PRIMARY KEY,              -- futur slug du client ('nmk')
  nom             TEXT NOT NULL,                 -- raison sociale affichée
  doc             JSONB NOT NULL DEFAULT '{}'::jsonb,
  tenant_id       UUID REFERENCES fleet.tenants(id) ON DELETE SET NULL,
  provisioned_at  TIMESTAMPTZ,                   -- date de la mise en service
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_files_tenant  ON fleet.onboarding_files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_files_updated ON fleet.onboarding_files(updated_at DESC);

ALTER TABLE fleet.onboarding_files ENABLE ROW LEVEL SECURITY;
-- Volontairement aucune policy : seul service_role traverse.

COMMENT ON TABLE  fleet.onboarding_files IS
  'Fiches de mise en service client (console superadmin). Accès service_role uniquement.';
COMMENT ON COLUMN fleet.onboarding_files.provisioned_at IS
  'Renseigné à la première mise en service ; rend l''opération rejouable sans doublon.';
