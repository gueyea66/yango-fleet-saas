# Spec — Calculs, reportings & projections

**Statut :** validé par Abdou le 2026-07-02 · référence d'implémentation
**Principe directeur :** deux reportings coexistent sur les mêmes données —
un reporting **Commissions** (théorique, %, pour la rémunération) et un reporting
**Opérationnel réel** (mesuré, pour le vrai résultat économique) — plus une vue
**Trésorerie** (cash décaissé). On ne mélange jamais les trois.

---

## 1. Reporting COMMISSIONS (théorique, rémunération)

C'est le modèle actuel, conservé. Calcul par rapport journalier :

```
base            = brut_yango + bonus_yango
comm_yango      = base × taux_yango(chauffeur)          # % Yango
comm_partenaire = base × taux_partenaire(chauffeur)     # % partenaire
service_supp    = montant saisi manuellement (optionnel, défaut 0)
net_commissions = base − comm_yango − comm_partenaire − service_supp + hors_yango
```

**Changements vs existant :**
- Les taux `taux_yango` et `taux_partenaire` deviennent **réglables par chauffeur**
  (aujourd'hui : tenant, avec override `partner_rate` par véhicule). Résolution :
  **chauffeur → véhicule → tenant** (première valeur définie gagne).
- Nouveau champ **`service_supplementaire`** sur le rapport : charge de commission
  Yango additionnelle, en FCFA, saisie à la main, souvent vide. Vient réduire le net.
- Les taux effectifs restent **figés dans le rapport** au moment de la soumission
  (`commission_rate`, `partner_rate`, `service_supplementaire`) → l'historique ne
  bouge pas si on change les taux plus tard.

Usage : rémunération, accords commerciaux, « ce qui est dû ». C'est le net affiché
au chauffeur et la base du calcul de salaire.

---

## 2. Reporting OPÉRATIONNEL réel (mesuré)

On remplace les **achats front-loadés** par la **consommation réelle**.

### 2.1 Solde Yango consommé (Modèle A — le solde = toute la ponction Yango)

Par chauffeur et par jour :
```
solde_veille        = solde_yango du rapport précédent du chauffeur (chronologique)
solde_fin           = solde_yango du rapport courant
provisions_du_jour  = Σ dépenses catégorie "Solde Yango" du chauffeur ce jour
solde_consomme      = max(0, solde_veille − solde_fin + provisions_du_jour)
```
- Rattaché au **chauffeur** (le wallet est au chauffeur).
- `solde_veille` **dérivé automatiquement** du dernier rapport (pas de ressaisie).
  Premier rapport d'un chauffeur : `solde_veille = solde_fin` (consommation 0) ou
  un solde initial saisi une fois. Jours manquants : on prend le dernier solde connu.

### 2.2 Carburant consommé (Option 1 — coût/km dérivé du réel)

```
cout_carburant_par_km = Σ(montant dépenses "Carburant") ÷ Σ(km parcourus)   [historique]
carburant_consomme    = km_periode × cout_carburant_par_km
```
- Km parcourus = différence d'odomètre entre rapports consécutifs (déjà calculé).
- Le ratio se cale seul sur les vraies données et **lisse le front-load** (peu importe
  quand le plein est payé, le coût suit les km). Ratio calculé au niveau chauffeur si
  assez de données, sinon tenant.

### 2.3 Résultat opérationnel

```
recettes          = brut_yango + bonus_yango + hors_yango
depenses_ope       = dépenses HORS "Solde Yango" et HORS "Carburant"
                     (entretien, péage, lavage, amende, contrôle, autre…)
net_operationnel   = recettes − solde_consomme − carburant_consomme − depenses_ope − salaires
```
> Note : dans le reporting opérationnel on n'utilise **pas** les commissions % ;
> le solde consommé mesuré *est* la ponction Yango réelle (Modèle A). Le
> `service_supplementaire` appartient au reporting Commissions ; s'il correspond à
> une charge réglée via le wallet, elle est déjà dans `solde_consomme`.

---

## 3. Vue TRÉSORERIE (cash)

```
encaissements = recettes encaissées (brut_yango + bonus + hors_yango)
decaissements = TOUTES les sorties réelles :
                provisions de solde + achats de carburant + autres dépenses + salaires
tresorerie    = encaissements − decaissements
avance_solde  = provisions_de_solde − solde_consomme   # cash immobilisé en solde
avance_carbu  = achats_carburant   − carburant_consomme # cash immobilisé en carburant
```
Sert à suivre le cash que tu front-load. Affichée en **bloc distinct** du dashboard.

**Réconciliation** : `net_operationnel − tresorerie = avance_solde + avance_carbu`
(l'écart entre résultat et cash = ce que tu as avancé mais pas encore consommé).

---

## 4. Salaire au prorata

Pour les **modèles à base fixe** (fixed, et base des paliers tiered) :
```
jours_ouvres_travailles = jours ouvrés entre la date d'entrée et la fin de période
jours_ouvres_mois       = jours ouvrés du mois complet
salaire = salaire_mensuel × (jours_ouvres_travailles ÷ jours_ouvres_mois)
```
- Ne s'applique **pas** aux modèles proportionnels (percent, location) — déjà indexés
  sur l'activité.
- Appliqué selon le **modèle paramétré** du chauffeur/tenant.

### Jours ouvrés
- **1 jour de repos par semaine**, **variable** (déclaré par le chauffeur, onglet Repos /
  calendrier). Réalisé : `jours ouvrés = jours calendaires − repos déclarés`.
- **Projection future** : hypothèse 6 jours ouvrés / 7, comptés sur le **calendrier réel**
  du mois visé (un mois « à 5 semaines » a plus de jours ouvrés qu'un mois à 4).
- **Jours fériés** : ignorés. Si besoin, posés en « jour off » sur le calendrier
  (donc traités comme un repos).

---

## 5. Projection PnL (mois en cours, mois & années suivants)

```
resultat_moyen_par_jour_ouvre = resultat_operationnel_realise ÷ jours_ouvres_ecoules
projection_periode            = resultat_moyen_par_jour_ouvre × jours_ouvres_de_la_periode
```
- Basée sur le **résultat opérationnel** (§2), jamais sur les commissions théoriques.
- **Charges projetées = base opérationnelle** (solde consommé + carburant consommé +
  dépenses opé récurrentes), **jamais les provisions** front-loadées.
- Jours ouvrés de la période = comptés sur le calendrier réel (§4), 6j/7 pour le futur.
- Décline sur : reste du mois en cours, mois suivants, années suivantes.

---

## 6. Filtre chauffeur — partout

Le filtre chauffeur (déjà sur le Dashboard) doit exister et se comporter à l'identique
sur **toutes** les pages : Soumissions, Historique, Calendrier, Paiements, Avances,
Pilotage, Véhicules, KYC, Rémunération. Filtre partagé (même état, même UX).

---

## 7. Impacts schéma (migrations à appliquer en prod)

| Table | Colonne | Rôle |
|-------|---------|------|
| `profiles` (chauffeur) | `comm_yango` NUMERIC, `comm_partner` NUMERIC | taux commission par chauffeur (null → fallback véhicule/tenant) |
| `profiles` (chauffeur) | `hire_date` DATE | date d'entrée pour le prorata salaire |
| `profiles` (chauffeur) | `solde_initial` NUMERIC | solde wallet de départ (1re consommation) |
| `vehicles` | `yango_rate` NUMERIC | taux Yango par véhicule (défaut/prévision ; `partner_rate` existe déjà) |
| `daily_reports` | `service_supplementaire` NUMERIC DEFAULT 0 | charge Yango add. saisie |
| `daily_reports` | `vehicle_id` (déjà présent) | à rendre systématique |

Toutes idempotentes (`ADD COLUMN IF NOT EXISTS`). Regroupées dans `migrations/026-calculs.sql`.

---

## 8. Ordre d'implémentation (phases)

1. **Phase 1** — Commissions % par chauffeur + `service_supplementaire` (étend l'existant).
2. **Phase 2** — Solde consommé réel + vues Opérationnel / Trésorerie au dashboard.
3. **Phase 3** — Carburant consommé réel (coût/km historique).
4. **Phase 4** — Salaire prorata + projection PnL sur jours ouvrés.
5. **Phase 5** — Filtre chauffeur homogène partout.

Le reporting Commissions actuel reste **intact** pendant tout le chantier ; le réel
s'ajoute à côté. Tests unitaires sur chaque formule (solde, carburant, prorata, jours
ouvrés, projection) + build + tsc à chaque phase.
