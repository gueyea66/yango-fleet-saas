-- ============================================================
-- MIGRATION 063 — FICHE NMK : LE PARC RÉEL, ET LE SLUG `nmk`
--
-- Idempotente. Ne touche QUE la fiche d'onboarding de NMK.
--
-- Deux choses ici, et une seule raison : la fiche de la 061 était un brouillon
-- d'entretien (parc et chauffeurs vides, sous-domaine vide). Les exports
-- Fleetroom du 25/09 la remplissent pour de bon.
--
-- 1. L'identifiant passe de `nmk-transports` à `nmk`. `middleware.ts` prend le
--    premier label de l'hôte comme slug du tenant, et `provisionOnboarding`
--    dérive le slug de l'identifiant de la fiche. Avec `nmk-transports`,
--    l'espace n'aurait répondu que sur nmk-transports.m3afleet.com — alors que
--    `nmk.m3afleet.com` est déclaré sur Vercel depuis le 14/09 et que c'est
--    l'adresse que Nicolas connaît. Le tenant de démonstration qui occupait ce
--    slug a été supprimé le 23/09 : la place est libre.
--
-- 2. Le parc est chargé EN ENTIER — 13 véhicules, pas 8. Le parc Yango de NMK
--    mélange ses 8 voitures et 5 voitures de tiers, dont deux de M3A Solutions
--    hébergées chez lui contre 3 % du brut. Les charger toutes avec leur
--    segment donne à Nicolas la vue totale et le filtre, et permet de recouper
--    les chiffres des deux côtés. Sans le segment, ce serait un mélange ; avec,
--    c'est une réconciliation.
--
-- Les chauffeurs : 11 actifs. Les 9 licenciés et le membre du personnel
-- inactif de l'export ne sont pas chargés — ouvrir un compte à quelqu'un qui a
-- quitté l'entreprise n'a pas de sens, et la mise en service est rejouable.
-- ============================================================

/* ── 1. `nmk-transports` devient `nmk` ─────────────────── */
-- Le WHERE NOT EXISTS rend l'opération rejouable : si `nmk` existe déjà (donc
-- si cette migration est repassée), on ne fait rien plutôt que d'échouer sur
-- la clé primaire.

UPDATE fleet.onboarding_files
SET id = 'nmk', updated_at = now()
WHERE id = 'nmk-transports'
  AND NOT EXISTS (SELECT 1 FROM fleet.onboarding_files o WHERE o.id = 'nmk');

/* ── 2. Le parc, les chauffeurs, la règle ──────────────── */
-- `||` fusionne au premier niveau : les clés non citées (formation, c, maj…)
-- sont conservées. Les sous-objets `a` et `b` sont fusionnés clé par clé pour
-- ne pas effacer les points de contrôle déjà renseignés le 22/09.

UPDATE fleet.onboarding_files
SET doc = doc
      || jsonb_build_object(
           'vehicules',       '[{"id": "nmk-v01", "plaque": "AA194SJ", "modele": "Suzuki S-Presso", "annee": "2024", "proprio": "NMK Transports", "service": "2024-05-29", "segment": "interne"}, {"id": "nmk-v02", "plaque": "AA195SJ", "modele": "Suzuki S-Presso", "annee": "2024", "proprio": "NMK Transports", "service": "2024-05-29", "segment": "interne"}, {"id": "nmk-v03", "plaque": "AA192SJ", "modele": "Suzuki S-Presso", "annee": "2024", "proprio": "NMK Transports", "service": "2024-05-29", "segment": "interne"}, {"id": "nmk-v04", "plaque": "AA196SJ", "modele": "Suzuki S-Presso", "annee": "2024", "proprio": "NMK Transports", "service": "2024-05-29", "segment": "interne"}, {"id": "nmk-v05", "plaque": "AA197SJ", "modele": "Suzuki S-Presso", "annee": "2024", "proprio": "NMK Transports", "service": "2024-05-29", "segment": "interne"}, {"id": "nmk-v06", "plaque": "AA129QB", "modele": "Peugeot 2008", "annee": "2015", "proprio": "À confirmer", "service": "2024-10-28", "segment": "interne"}, {"id": "nmk-v07", "plaque": "AA377GF", "modele": "Suzuki S-Presso", "annee": "2022", "proprio": "À confirmer", "service": "2025-01-20", "segment": "interne"}, {"id": "nmk-v08", "plaque": "AB268FK", "modele": "Renault Clio", "annee": "2019", "proprio": "À confirmer", "service": "2026-01-25", "segment": "interne"}, {"id": "nmk-v09", "plaque": "AB922ER", "modele": "Nissan Sentra", "annee": "2017", "proprio": "Partenaire tiers — à nommer", "service": "2025-12-01", "segment": "partenaire"}, {"id": "nmk-v10", "plaque": "AB035EQ", "modele": "Mazda 3", "annee": "2017", "proprio": "Partenaire tiers — à nommer", "service": "2025-12-01", "segment": "partenaire"}, {"id": "nmk-v11", "plaque": "AB398GD", "modele": "Citroen C4", "annee": "2015", "proprio": "Partenaire tiers — à nommer", "service": "2026-07-08", "segment": "partenaire"}, {"id": "nmk-v12", "plaque": "AB874JG", "modele": "Chevrolet Orlando", "annee": "2016", "proprio": "M3A Solutions", "service": "2026-06-29", "segment": "partenaire"}, {"id": "nmk-v13", "plaque": "AB872JG", "modele": "Kia K3", "annee": "2017", "proprio": "M3A Solutions", "service": "2026-07-06", "segment": "partenaire"}]'::jsonb,
           'chauffeurs',      '[{"id": "nmk-c01", "nom": "NGOUMA RAPHAEL", "tel": "", "permis": "", "vehicule": "AA196SJ", "entree": "", "kyc": "À collecter"}, {"id": "nmk-c02", "nom": "Fall Souka", "tel": "", "permis": "", "vehicule": "AA194SJ", "entree": "", "kyc": "À collecter"}, {"id": "nmk-c03", "nom": "FALL El Hadj Ibrahima", "tel": "", "permis": "", "vehicule": "AB268FK", "entree": "", "kyc": "À collecter"}, {"id": "nmk-c04", "nom": "SECK CHEIKH OUMAR FOUTIYOU", "tel": "", "permis": "", "vehicule": "AA195SJ", "entree": "", "kyc": "À collecter"}, {"id": "nmk-c05", "nom": "MANE OMAR IDIONTY", "tel": "", "permis": "", "vehicule": "AA192SJ", "entree": "", "kyc": "À collecter"}, {"id": "nmk-c06", "nom": "Sarr Mounirou", "tel": "", "permis": "", "vehicule": "AA197SJ", "entree": "", "kyc": "À collecter"}, {"id": "nmk-c07", "nom": "Seidi Amadu", "tel": "", "permis": "", "vehicule": "AB035EQ", "entree": "", "kyc": "À collecter"}, {"id": "nmk-c08", "nom": "Ngom Emile Abdou", "tel": "", "permis": "", "vehicule": "AB874JG", "entree": "", "kyc": "À collecter"}, {"id": "nmk-c09", "nom": "Badiane Khadim Cheikh", "tel": "", "permis": "", "vehicule": "AB872JG", "entree": "", "kyc": "À collecter"}, {"id": "nmk-c10", "nom": "Ngom Daouda", "tel": "", "permis": "", "vehicule": "AB872JG", "entree": "", "kyc": "À collecter"}, {"id": "nmk-c11", "nom": "Ngom Abdon Boure", "tel": "", "permis": "", "vehicule": "AB872JG", "entree": "", "kyc": "À collecter"}]'::jsonb,
           'regle',           '{"mode": "Commission sur le brut", "versement": "40000", "commission": "20", "repos": "1 par semaine", "immobilise": "", "carburant": "Carburant, soldes Yango et salaires fournis par la direction", "seuilCarb": "30", "objectif": "10 véhicules, 400 000 XOF de versement par jour"}'::jsonb,
           'vehiculesPrevus', 13,
           'sousDomaine',     'nmk.m3afleet.com',
           'plan',            'pro',
           'gestionnaire',    'Daniel',
           'direction',       'Nicolas',
           'directionEmail',     'nicolas@nmktransports.sn',
           'gestionnaireEmail',  'exploitation@nmktransports.sn',
           'notes',           '"Devis M3A-2026-NMK-001 : 1 400 000 XOF HT en deux versements (700 000 a l''acceptation, 700 000 a la fin de la formation), puis 100 000 XOF HT/mois jusqu''a 10 vehicules. Demarrage en octobre.\n\nPARC CHARGE EN ENTIER (13 vehicules), a dessein : 8 internes NMK + 5 partenaires, dont AB874JG et AB872JG qui appartiennent a M3A Solutions. La segregation permet a Nicolas de voir son parc total puis de filtrer, et a Abdou de recouper ses propres chiffres. L''engagement contractuel porte sur les 8 vehicules internes.\n\nPart chauffeur 20 % du brut : valeur de travail, tenant-wide (il n''existe pas encore de regle par segment) — les chauffeurs de vehicules partenaires sont donc calcules avec la meme regle jusqu''a arbitrage de Nicolas."'::jsonb,
           'maj',             to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
         )
      || jsonb_build_object('a', coalesce(doc->'a', '{}'::jsonb) || '{"A3": {"s": 2, "n": "Reçu le 25/09 : export Fleetroom « liste des véhicules ». 13 véhicules après dédoublonnage — 8 internes, 5 partenaires (dont 2 à M3A Solutions). Propriétaire de AA129QB, AA377GF et AB268FK à confirmer."}, "A4": {"s": 2, "n": "Reçu le 25/09 : export Fleetroom « chauffeurs » (01/01 → 25/09/2026). 11 chauffeurs actifs chargés ; 9 licenciés et 1 inactif écartés. Téléphones, n° de permis et dates d''entrée absents de Fleetroom — à demander à Daniel."}, "A5": {"s": 2, "n": "40 000 XOF de brut par véhicule et par jour, part chauffeur 20 % du brut, repos 1 par semaine. Le parc produit ~31 000 XOF/jour au temps en ligne actuel (7,1 h) : 40 000 demande 9,2 h. Ajustable dans Réglages → Rémunération. Cas du véhicule immobilisé encore à préciser."}, "A8": {"s": 2, "n": "Daniel est le gestionnaire à former en priorité. Son compte admin est une boîte de RÔLE, exploitation@nmktransports.sn, pas son adresse nominative : le poste survit à la personne et aucune adresse n''est devinée. Nicolas a un second compte admin, nicolas@nmktransports.sn (direction). À vérifier avec NMK que la boîte exploitation@ existe et que Daniel la reçoit."}, "A6": {"s": 1, "n": "Les 4 exports reçus ne sont pas journaliers : aucun n''alimente l''import. Demander le rapport Fleetroom « transactions / paiements par conducteur » avec granularité JOUR sur 3 à 6 mois. Modèle prêt : Yango Business/onboarding/historique/MODELE-declarations.csv."}}'::jsonb)
      || jsonb_build_object('b', coalesce(doc->'b', '{}'::jsonb) || '{"B1": {"s": 2, "n": "Vercel Pro souscrit le 25/09 (20 €/mois). L''usage commercial est couvert. Coût fixe à amortir sur plusieurs clients : l''abonnement NMK seul (100 000 XOF/mois) le couvre déjà largement."}, "B4": {"s": 1, "n": "Tenant de démonstration `nmk` supprimé le 23/09 : le slug est libre et nmk.m3afleet.com reste déclaré sur Vercel. La fiche est renommée `nmk` pour que l''espace réponde sur ce sous-domaine."}}'::jsonb),
    updated_at = now()
WHERE id = 'nmk';

/* ── 3. Les deux comptes admin ─────────────────────────────
   Les deux comptes admin sont renseignés : nicolas@nmktransports.sn pour la
   direction, et exploitation@nmktransports.sn pour le gestionnaire (Daniel).
   Le second est volontairement une boîte de RÔLE et non l'adresse nominative
   de Daniel : le compte qui valide les rapports au quotidien doit survivre
   à un changement de gestionnaire, et aucune adresse personnelle n'est
   devinée. Reste à vérifier auprès de NMK que cette boîte existe et que
   Daniel la reçoit — sinon le mot de passe, affiché une seule fois dans la
   console, se transmet de la main à la main et l'adresse se corrige avant de
   rejouer la mise en service.
   ──────────────────────────────────────────────────────── */
