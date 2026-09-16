# Conception analytique — ce que le GPS devra pouvoir répondre

Ce document existe parce que les analyses poussées viendront **après**, mais que
les objets qui les rendent possibles doivent être posés **maintenant**. Rajouter
un champ à un historique de positions déjà accumulé ne le remplit pas
rétroactivement : ce qui n'est pas capté aujourd'hui est perdu pour toujours.

Règle directrice, reprise du brief §23 : **aucun chiffre sans son chemin de
preuve.** Chaque indicateur doit pouvoir être ouvert jusqu'aux positions brutes
qui l'ont produit.

---

## 1. Les quatre couches, et pourquoi elles sont séparées

```
  positions          brut, append-only, jamais recalculé        ← la preuve
      ↓
  trips              trajets reconstruits par inférence          ← recalculable
      ↓
  events             faits dérivés datés (départ, arrêt, …)      ← recalculable
      ↓
  daily / vues       agrégats et rapprochements                  ← recalculable
```

Tout ce qui est en aval des positions porte un `method_version`. Quand la
méthode de détection s'améliore — et elle s'améliorera, notamment après la
calibration du moteur — on efface et on recalcule depuis le brut, sans avoir
perdu une seconde d'historique. C'est la raison d'être de la séparation.

---

## 2. Les questions auxquelles il faudra répondre

Rangées par ordre de valeur, avec l'objet qui les porte et **ce qu'il faut
capter dès maintenant** pour qu'elles soient répondables plus tard.

### 2.1 Écart déclaratif — la plus rentable

> Le chauffeur déclare 210 km, le GPS en voit 248. Où sont les 38 km ?

- Porté par : `v_telematics_reconciliation` (jour × véhicule).
- Exige : positions horodatées par l'appareil, jour local Dakar, et le lien
  `vehicle_id` — déjà en place.
- Piège à ne pas oublier dans l'analyse : un écart n'est pas une fraude. Le GPS
  perd des points en ville dense, et un boîtier hors ligne sous-estime toujours.
  D'où `points`, `gaps_s` et `coverage_pct` stockés à côté du chiffre : sans
  eux, l'écart n'est pas interprétable.

**Ce que la base de production impose réellement** (constaté le 15/09/2026, et
non ce que suggérait le schéma d'origine) :

| Constat | Conséquence sur la vue |
|---|---|
| `start_odometer` **n'existe pas** en production ; seul `end_odometer` est saisi | Le km déclaré est un **delta entre deux déclarations successives du même chauffeur** — règle reprise telle quelle de `lib/hooks/usePilotage.ts`, pour ne pas créer une seconde vérité |
| 73 déclarations sur 160 n'ont **pas de `vehicle_id`** | Repli sur le véhicule actuellement affecté au chauffeur, sinon la moitié des journées seraient invisibles |
| Un chauffeur peut sauter des jours de déclaration | Le delta couvre alors plusieurs journées : `jours_couverts` l'expose, et l'écart est déclaré **non exploitable** plutôt que comparé à une seule journée GPS |
| Des déclarations existent en `rejected` puis corrigées | Seules les `approved` entrent dans le rapprochement, comme dans les KPI |

Matière disponible dès aujourd'hui sur le K3 (`AB-872-JG`) : odomètre déclaré
tous les jours, 150 692 → 151 461 entre le 10 et le 15/09, soit 130 à 185 km par
jour. Le jour où le boîtier bascule, le croisement a du grain à moudre
immédiatement.

### 2.2 Rendement réel au kilomètre

> CA/km, carburant/km, L/100 km — sur des kilomètres constatés, plus déclarés.

- Porté par : jointure `telematics_daily` × `daily_reports` × `expenses`.
- Exige : distance calculée par segment avec les sauts aberrants écartés et
  **comptés** (`jumps_dropped`), sinon un fix qui dérive gonfle le dénominateur
  et fabrique une fausse économie de carburant.

### 2.3 Utilisation du véhicule

> Combien d'heures par jour le véhicule travaille-t-il vraiment ?

- Porté par : `telematics_daily` (temps en mouvement, temps à l'arrêt, amplitude
  premier→dernier mouvement, nombre de trajets).
- Exige : `trips` avec leurs bornes. **Ne dépend pas de l'état moteur** — c'est
  délibéré : le temps en mouvement se mesure par le déplacement, il est
  disponible immédiatement, alors que le temps moteur attend la calibration.

### 2.4 Journée reconstituée

> À quoi a ressemblé la journée du 15, heure par heure ?

- Porté par : `trips` + `events`, rejouables sur un axe temporel (brief §10).
- Exige : les événements datés avec leur position et leur niveau de confiance.

### 2.5 Géographie de l'activité

> Où le véhicule passe-t-il son temps ? Quels corridors ? Quels points d'arrêt
> récurrents ?

- Porté par : requêtes directes sur `positions` + `events` d'arrêt.
- Exige : rien de plus que les positions — d'où l'importance de ne jamais les
  purger sans décision explicite.

### 2.6 Socle du Mission Engine (brief §9-11)

> Départ réel, arrivée réelle, retard, temps de transit.

- Porté par : `events` de type `TRIP_STARTED` / `TRIP_ENDED`, plus tard
  rapprochés d'une mission planifiée.
- Exige : que les événements existent **avant** les missions. Le jour où une
  mission est créée, elle se raccroche à des faits déjà captés — au lieu
  d'attendre que le GPS commence à en produire.

---

## 3. Inférence : ce qu'on mesure, ce qu'on déduit, ce qu'on refuse

| Grandeur | Statut | Méthode |
|---|---|---|
| Position, vitesse instantanée, cap | **mesuré** | lu dans la trame |
| Distance | **calculé** | Haversine entre points consécutifs, sauts > 3 km écartés et comptés |
| Trajet (début/fin) | **déduit** | déplacement continu, séparé par un arrêt ≥ 5 min |
| Temps en mouvement / à l'arrêt | **déduit** | somme des segments selon la vitesse |
| Arrêt long | **déduit** | immobilité ≥ 20 min hors trajet |
| **État moteur** | **refusé pour l'instant** | masque de statut non calibré (runbook §6) |
| **Odomètre** | **refusé** | non fiable sur ce boîtier ; la distance est calculée |
| Conduite (freinage, accélération) | **impossible** | le ST-901 ne l'émet pas. Ne pas le promettre |
| Consommation réelle | **refusé** | pas de capteur carburant. Reste déclarative, croisée aux km GPS |

Les seuils (5 min, 20 min, 3 km) sont des **paramètres**, pas des constantes
enfouies : ils seront ajustés après observation du terrain dakarois, et tout
recalcul se fera depuis le brut.

---

## 4. Confiance, systématiquement (brief §13)

Chaque trajet et chaque événement porte :

- `confidence` — 0 à 1 ;
- `evidence` — les faits qui l'ont produit (nombre de points, trous constatés,
  vitesse au moment de la bascule…).

Un trajet reconstruit à partir de 4 points espacés de 12 minutes n'a pas la même
valeur qu'un trajet à 120 points réguliers, et l'analyse ne doit jamais les
traiter à égalité. Les trous de couverture sont donc stockés explicitement
(`gaps_s`) plutôt que lissés en silence.

---

## 5. Ce qui est volontairement écarté

- **Notation comportementale des chauffeurs.** Le ST-901 n'a pas les capteurs
  qui la rendraient honnête ; un score fabriqué à partir de la seule vitesse GPS
  produirait des accusations invérifiables.
- **Suivi hors service.** Techniquement immédiat, mais c'est une décision
  d'entreprise et de vie privée — elle appartient à Abdou, pas au modèle. Les
  données permettront de la poser plus tard ; rien ne la présuppose aujourd'hui.
