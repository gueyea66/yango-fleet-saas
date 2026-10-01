# Import Fleetroom — exports Yango comme déclaration

> Référence. Règles validées par Abdou le 01/10/2026 sur les exports NMK de janvier à septembre 2026.

## Pourquoi

Les exports Fleetroom du parc remplacent les captures d'écran et les déclarations des chauffeurs. On dépose les fichiers bruts tels quels, sans les retravailler. L'app en tire :
- les déclarations journalières ;
- les recharges ;
- le solde Yango.

## Les trois exports

| Export Fleetroom | Contenu | Clé anti-doublon |
|---|---|---|
| **Transactions** (`park_transactions`) | 1 ligne par mouvement du solde chauffeur | (horodatage, chauffeur Yango, catégorie, montant, commande), unique sur 81 799 lignes réelles |
| **Commandes** (`report_orders`) | 1 ligne par commande : statut, raison d'annulation, heures, adresses, distance, tarif | identifiant de commande. Un nouvel import met la ligne à jour, car le statut peut évoluer d'un export à l'autre |
| **Soldes** | solde de début et de fin de journée de chaque chauffeur actif | (chauffeur, jour). **La date n'est pas dans le fichier, il faut la saisir** |

Pièges connus de ces exports :
- séparateur `;`, décimales à virgule, BOM, fins de ligne CRLF ;
- **plaques en cyrillique** (АА195SJ) ;
- **« Distance (en km) » est en mètres** ;
- deux colonnes « Conducteur » (l'identifiant, puis le nom) et deux colonnes « Véhicule » ;
- certains noms changent de casse d'un export à l'autre : le rattachement se fait par l'identifiant Yango (`profiles.yango_driver_id`).

## Règles de calcul (validées)

| Élément | Règle |
|---|---|
| Brut Yango | espèces (`cash_collected`) + carte (`card`). **La compensation promo est exclue.** |
| Commission Yango | `platform_ride_fee` + `platform_ride_vat` + `platform_reposition_fee` |
| Commission partenaire | `partner_ride_fee` (véhicules partenaires uniquement) |
| Frais de réservation | `commission_booking_fee` : **exclus** des commissions. Ils débitent quand même le solde. |
| Rechargements manuels | `partner_service_manual` : exclus du CA, enregistrés comme dépense « Solde Yango », comptés dans le solde |
| Bonus | `bonus` (à la course et d'objectif) |
| **Solde fin J** | solde fin J-1 + Σ transactions du jour **hors espèces** |
| Ancre du solde | dernier export « Soldes », sinon `profiles.solde_initial`, sinon 0 |
| Nouveau chauffeur | démarre à 0, puis reçoit une recharge de départ (Emile, Abdon, Badiane…) |

Vérification au 29/09 : pour les 6 chauffeurs actifs, l'écart est inférieur à 1 XOF sur le solde de début, le mouvement du jour et le solde de fin.

## Garde-fous contre la double déclaration

1. **Même fichier déposé deux fois** : refusé. L'empreinte sha256 est enregistrée dans `fleetroom_imports`.
2. **Périodes qui se chevauchent** : les lignes brutes déjà connues sont ignorées grâce à leur clé naturelle.
3. **Aucun cumul** : les déclarations sont *recalculées* depuis le brut par `fleet.fleetroom_rebuild`. Rejouer un import donne le même résultat.
4. **Jour déjà déclaré par le chauffeur** (photo ou saisie, source ≠ `fleetroom`) : la déclaration **n'est pas écrasée**. Les deux versions sont consignées dans `fleetroom_conflicts` pour être rapprochées.
5. **Recharges** : une transaction donne une seule dépense, grâce à `expenses.external_ref = 'yango_tx:<id>'`.
6. **Chauffeur inconnu** : il est signalé (`unknownDrivers`, `unmapped_drivers`). Aucune déclaration n'est créée pour lui.

## Code

- `migrations/072-import-fleetroom.sql` : tables brutes, journal des imports, écarts, fonction `fleetroom_rebuild`.
- `lib/fleetroom/parse.ts` : parseurs, testés dans `__tests__/fleetroomParse.test.ts`.
- `lib/fleetroom/ingest.ts` : enchaîne le dépôt, le dédoublonnage, le rattachement des chauffeurs et le recalcul.
- `scripts/fleetroom-import.ts` : la même chose en ligne de commande, pour reconstituer l'historique.
- `scripts/sql/nmk-fleetroom-profils.sql` : profils NMK (chauffeurs partis, identifiants Yango, dates d'entrée).

## À faire

- **Page admin « Import Fleetroom »** : glisser-déposer des 2 ou 3 fichiers, avec la date pour l'export Soldes. Elle affiche un compte rendu : nouvelles lignes, lignes déjà connues, jours recalculés, écarts, chauffeurs inconnus. Elle s'appuie sur `ingestFleetroom`.
- **Écran de rapprochement** pour `fleetroom_conflicts`, par exemple une carte déclarée par le chauffeur mais absente chez Yango.
- **KPI et monitoring chauffeurs** à partir des données hors modèle de déclaration, à cadrer avec Abdou :
  - heures de début et de fin, amplitude, temps en course (environ 55 % de l'amplitude) ;
  - taux d'acceptation, refus, échecs de connexion ;
  - répartition horaire, zones de départ et d'arrivée (géocodage via `geocode_cache`), XOF par km ;
  - frais de réservation, promos, bonus d'objectif.
- **Croisement GPS** : découper la trace du véhicule sur les créneaux de course pour séparer les km en course, les km d'approche et les km à vide.
- **Plus tard** : l'API Fleet de Yango supprimerait l'export manuel.

## Constat sur la carte (écart signalé par Abdou)

Yango n'enregistre que **14 paiements carte en 9 mois**. Les chauffeurs, eux, déclarent régulièrement de la carte que Fleetroom ne connaît pas. Exemples dans le tenant M3A en septembre :
- Emile : 2 700 le 26/09, 2 700 le 27/09, 1 000 le 29/09 ;
- Abdon : 1 000 le 04/09, 12 700 le 11/09, 2 800 le 15/09.

Seuls deux montants d'Abdon se retrouvent chez Yango : 1 400 le 16/09 et 700 le 22/09. Le solde déclaré par Emile le 29/09 (9 546) correspond pourtant exactement à Fleetroom : cette « carte » ne passe donc pas par le solde Yango. Il faut vérifier auprès des chauffeurs à quoi elle correspond (Wave ? paiement hors application ?).
