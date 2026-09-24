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

-- ── Reprise de la fiche NMK ─────────────────────────────
-- La fiche existait déjà dans la page isolée : elle est reprise telle quelle
-- pour que personne ne la ressaisisse. ON CONFLICT DO NOTHING — rejouer cette
-- migration n'écrase jamais le travail fait depuis dans la console.
--
-- Une réserve utile : le mode est « Commission sur le brut » et le taux n'a
-- jamais été donné par le client. Le champ reste vide, donc la mise en service
-- écrira un taux nul tant qu'il n'est pas renseigné — à demander à Nicolas.

INSERT INTO fleet.onboarding_files (id, nom, doc)
VALUES ('nmk-transports', 'NMK Transports', '{"nom": "NMK Transports", "contact": "Nicolas", "sousDomaine": "", "gestionnaire": "Daniel", "gestionnaireEmail": "", "vehiculesPrevus": 8, "j0": "", "a": {"A1": {"s": 1, "n": "Accord oral le 22/09, demarrage en octobre. Facture du 1er versement a emettre."}, "A2": {"s": 1, "n": "Teste le 22/09 : le code part vers l''ancien numero. Pistes : nouvelle puce sur ce numero ou contact Yango."}, "A3": {"s": 1, "n": "Demande dans l''email du compte rendu (brouillon du 22/09)."}, "A4": {"s": 1, "n": "Demande dans l''email du compte rendu (brouillon du 22/09)."}, "A5": {"s": 1, "n": "Modele cite : 40 000 XOF brut par vehicule et par jour. Repos et vehicule immobilise a preciser."}, "A6": {"s": 0, "n": "Versements de 130 000 a 150 000 cites sans periode."}, "A8": {"s": 2, "n": "Nicolas veut que Daniel soit forme en priorite. - C''est Daniel"}, "A10": {"s": 2, "n": "Logo recupere sur nmktransports.sn."}}, "b": {"B4": {"s": 0, "n": "L''espace nmk actuel est une demonstration (donnees simulees) : creer un espace separe."}}, "c": {"C1": {"s": 1, "n": "Demande en seance et dans l''email du 22/09."}}, "vehicules": [], "chauffeurs": [], "regle": {"mode": "Commission sur le brut", "versement": "40000", "commission": "", "repos": "1 par semaine", "immobilise": "", "carburant": "Carburant, soldes Yango et salaires fournis par la direction", "seuilCarb": "30", "objectif": "10 vehicules, 400 000 XOF de versement par jour"}, "formation": {"date": "", "lieu": "", "participants": "Daniel (gestionnaire), Nicolas (direction), les chauffeurs"}, "notes": "Devis M3A-2026-NMK-001 : 1 400 000 XOF HT en deux versements (700 000 a l''acceptation, 700 000 a la fin de la formation), puis 100 000 XOF HT/mois jusqu''a 10 vehicules. Demarrage en octobre.", "maj": "2026-09-22T19:28:50.993Z"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
