-- ============================================================
-- MIGRATION 071 — AMORTISSEMENT ET FINANCEMENT DES VÉHICULES
--
-- Idempotente. N'écrase aucune donnée existante : uniquement des colonnes
-- nouvelles (toutes nullables) et une table nouvelle.
--
-- ── Le problème ──────────────────────────────────────────
-- Jusqu'ici le produit ne connaissait AUCUN coût du capital. `netFinal` =
-- recettes − charges saisies − salaires. Le net affiché était donc un net
-- HORS AMORTISSEMENT : un exploitant qui dégage 400 000 et doit encore
-- rembourser 200 000 de véhicule lisait « 400 000 » et se croyait rentable.
-- Constat d'Abdou le 25/09 : il ne faut pas montrer une image embellie.
--
-- ── Deux choses distinctes, deux blocs ───────────────────
-- Le piège numéro un de ce sujet est de les confondre :
--
--   AMORTISSEMENT — charge CALCULÉE, non-cash. Existe même sur un véhicule
--   payé comptant. C'est l'usure de l'actif. Elle appartient au RÉSULTAT.
--
--   MENSUALITÉ DE FINANCEMENT — sortie de cash RÉELLE (capital + intérêts).
--   N'existe que s'il y a leasing ou crédit. Elle appartient à la TRÉSORERIE.
--
-- Les additionner dans le résultat compterait deux fois le même véhicule.
-- D'où deux endroits séparés : les colonnes d'amortissement sur `vehicles`,
-- et la table `vehicle_financing` pour la dette.
--
-- ── Pourquoi la durée n'est pas une simple colonne « durée » ──
-- Mesure faite le 25/09 sur le parc M3A réel (km déclarés au compteur,
-- juin→septembre) :
--   Chevrolet Orlando 2016 — 96 998 km au compteur, 5 890 km/mois
--   Kia K3 2017           — 149 037 km au compteur, 4 597 km/mois
--
-- Un 36 mois posé à la main sous-estimait l'amortissement de 35 à 40 % :
-- un véhicule racheté à 149 000 km ne s'amortit pas sur la même durée qu'un
-- véhicule neuf, même acheté le même jour au même prix. La durée se DÉDUIT
-- donc du kilométrage restant avant fin de vie, plafonnée par une durée
-- économique maximale (`amort_duree_max_mois`) — on amortit toujours sur la
-- plus COURTE des deux, jamais sur la plus longue. Règle prudentielle.
--
-- ⛔ NE JAMAIS ajouter « Amortissement » à EXPENSE_CATEGORIES (lib/
-- expenseCategories.ts). Même piège que « Décaissement propriétaire » : une
-- charge saisie a un justificatif, un chauffeur et compte en trésorerie.
-- L'amortissement n'a rien de tout ça. L'y mettre polluerait la trésorerie
-- d'un décaissement fantôme, ferait apparaître chez le chauffeur une charge
-- qu'il n'a pas faite, et casserait le deep dive par poste des rapports.
-- ============================================================

-- ════════════════ A — AMORTISSEMENT (bloc RÉSULTAT) ════════════════

ALTER TABLE fleet.vehicles
  -- Prix payé, frais de mise en route inclus (mutation, immatriculation).
  ADD COLUMN IF NOT EXISTS prix_acquisition      NUMERIC,
  -- Valeur de revente estimée À LA FIN de la période d'amortissement — pas
  -- la cote d'aujourd'hui. C'est l'erreur de saisie la plus fréquente et la
  -- plus coûteuse : une résiduelle surévaluée vide l'amortissement de son
  -- sens et ramène l'image embellie qu'on cherche à supprimer.
  ADD COLUMN IF NOT EXISTS valeur_residuelle     NUMERIC,
  -- Point de départ de l'amortissement. Permet de recalculer l'historique
  -- déjà saisi, et de savoir quand la charge tombe à zéro.
  ADD COLUMN IF NOT EXISTS date_acquisition      DATE,
  -- Kilométrage de fin de vie utile en exploitation VTC. Par véhicule et non
  -- global : retour Abdou du 25/09, les véhicules peuvent aller jusqu'à
  -- 400 000 éventuellement selon la marque — un Toyota et un Chevrolet ne
  -- meurent pas au même compteur.
  ADD COLUMN IF NOT EXISTS amort_plafond_km      INT,
  -- Plafond de durée. Borne la durée déduite du kilométrage : sans elle, un
  -- véhicule peu roulé s'amortirait sur 50 mois et plus, ce qui n'a pas de
  -- sens économique sur une occasion.
  ADD COLUMN IF NOT EXISTS amort_duree_max_mois  INT,
  -- 'lineaire' | 'km'. Le mode 'km' exige une couverture télématique
  -- suffisante sur la période, sinon le moteur retombe sur 'lineaire' et le
  -- signale à l'écran (au 25/09 : 1 véhicule sur 15 équipé, 13 jours de
  -- données sur 25 — le linéaire est le seul défaut viable).
  ADD COLUMN IF NOT EXISTS amort_methode         TEXT,
  -- Qui porte le financement. Un véhicule hébergé pour un tiers ne coûte pas
  -- son capital à l'exploitant : amortissement 0. Sans ce champ on chargerait
  -- NMK d'un actif qui appartient à M3A.
  ADD COLUMN IF NOT EXISTS amort_porte_par       TEXT;

COMMENT ON COLUMN fleet.vehicles.valeur_residuelle IS
  'Valeur de revente estimee A LA FIN de l amortissement, pas la cote actuelle.';
COMMENT ON COLUMN fleet.vehicles.amort_porte_par IS
  'exploitant | proprietaire_tiers — proprietaire_tiers implique amortissement 0.';

-- Défauts appliqués aux lignes existantes ET aux suivantes. 400 000 km et
-- 36 mois : plafond km validé par Abdou le 25/09 ; 36 mois est la durée
-- économique maximale retenue pour une occasion en usage VTC intensif.
ALTER TABLE fleet.vehicles
  ALTER COLUMN amort_plafond_km     SET DEFAULT 400000,
  ALTER COLUMN amort_duree_max_mois SET DEFAULT 36,
  ALTER COLUMN amort_methode        SET DEFAULT 'lineaire',
  ALTER COLUMN amort_porte_par      SET DEFAULT 'exploitant';

-- Rattrapage des lignes créées avant la migration. Ne touche que les NULL :
-- rejouer la migration ne réécrit jamais une valeur saisie à la main.
UPDATE fleet.vehicles SET amort_plafond_km     = 400000      WHERE amort_plafond_km     IS NULL;
UPDATE fleet.vehicles SET amort_duree_max_mois = 36          WHERE amort_duree_max_mois IS NULL;
UPDATE fleet.vehicles SET amort_methode        = 'lineaire'  WHERE amort_methode        IS NULL;

-- Un véhicule de segment « partenaire » est hébergé pour un tiers : par
-- défaut son capital n'est pas porté par l'exploitant. Modifiable ensuite au
-- cas par cas (un partenaire peut avoir confié un véhicule que l'exploitant
-- finance réellement).
UPDATE fleet.vehicles
   SET amort_porte_par = CASE WHEN fleet_segment = 'partenaire'
                              THEN 'proprietaire_tiers' ELSE 'exploitant' END
 WHERE amort_porte_par IS NULL;

ALTER TABLE fleet.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_amort_methode_chk,
  DROP CONSTRAINT IF EXISTS vehicles_amort_porte_par_chk,
  DROP CONSTRAINT IF EXISTS vehicles_amort_coherence_chk;

ALTER TABLE fleet.vehicles
  ADD CONSTRAINT vehicles_amort_methode_chk
    CHECK (amort_methode IS NULL OR amort_methode IN ('lineaire', 'km')),
  ADD CONSTRAINT vehicles_amort_porte_par_chk
    CHECK (amort_porte_par IS NULL OR amort_porte_par IN ('exploitant', 'proprietaire_tiers')),
  -- La résiduelle ne peut pas dépasser le prix d'achat : ce serait un
  -- amortissement négatif, donc un véhicule qui enrichit en vieillissant.
  ADD CONSTRAINT vehicles_amort_coherence_chk
    CHECK (prix_acquisition IS NULL OR valeur_residuelle IS NULL
           OR valeur_residuelle <= prix_acquisition);

-- ════════════════ B — FINANCEMENT (bloc TRÉSORERIE) ════════════════
-- Table séparée et non colonnes : un véhicule peut être refinancé, et on veut
-- garder l'historique des échéanciers plutôt que d'écraser le précédent.

CREATE TABLE IF NOT EXISTS fleet.vehicle_financing (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     UUID NOT NULL REFERENCES fleet.vehicles(id) ON DELETE CASCADE,
  tenant_id      UUID REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  -- comptant : aucune mensualité, mais l'amortissement court quand même.
  type           TEXT NOT NULL DEFAULT 'comptant',
  organisme      TEXT,
  -- Montant financé (≠ prix d'acquisition s'il y a un apport).
  montant_finance NUMERIC NOT NULL DEFAULT 0,
  apport         NUMERIC NOT NULL DEFAULT 0,
  -- Mensualité TOUT COMPRIS (capital + intérêts + assurance du crédit) :
  -- c'est la somme qui sort réellement du compte chaque mois.
  mensualite     NUMERIC NOT NULL DEFAULT 0,
  taux_annuel    NUMERIC,
  duree_mois     INT,
  date_debut     DATE,
  -- Renseignée quand le crédit est soldé par anticipation ; sinon la fin est
  -- déduite de date_debut + duree_mois.
  date_fin       DATE,
  actif          BOOLEAN NOT NULL DEFAULT true,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_financing_type_chk
    CHECK (type IN ('comptant', 'leasing', 'credit_bancaire', 'autre'))
);

CREATE INDEX IF NOT EXISTS idx_vfin_vehicle ON fleet.vehicle_financing(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vfin_tenant  ON fleet.vehicle_financing(tenant_id);
-- Un seul échéancier actif par véhicule : sinon la trésorerie compterait deux
-- mensualités pour un seul crédit.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vfin_actif_par_vehicule
  ON fleet.vehicle_financing(vehicle_id) WHERE actif;

-- Cloisonnement par tenant, aligné sur les migrations 039/048/069 : la lecture
-- et l'écriture d'un échéancier sont réservées aux admins de son tenant. Un
-- chauffeur n'a aucune raison de connaître la dette de la flotte.
ALTER TABLE fleet.vehicle_financing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vfin_admin_tenant ON fleet.vehicle_financing;
CREATE POLICY vfin_admin_tenant ON fleet.vehicle_financing
  FOR ALL USING (
    fleet.is_trusted_server()
    OR (fleet.is_admin() AND tenant_id = fleet.current_tenant_id())
  ) WITH CHECK (
    fleet.is_trusted_server()
    OR (fleet.is_admin() AND tenant_id = fleet.current_tenant_id())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON fleet.vehicle_financing TO authenticated, service_role;
