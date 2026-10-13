# GPS × Yango : nouveaux KPI et détection du hors Yango non déclaré

> Analyse demandée par Abdou le 13/10/2026. Rien n'est encore codé : ce document dit ce qu'on peut mesurer, avec quelle méthode, avec quelle fiabilité, et dans quel ordre le construire.

## 1. Verdict

1. **Oui, le hors Yango « application éteinte » est mesurable**, par soustraction : tout ce que le véhicule fait (GPS) moins tout ce que Yango explique (export Commandes) laisse un résidu. Ce résidu se mesure en kilomètres, en heures et en nombre de trajets qui ressemblent à des courses.
2. **Ce ne sera jamais une preuve, seulement un faisceau d'indices chiffré.** Le GPS voit un déplacement, pas un client ni un billet. La sortie utile est une liste courte de journées à expliquer, chacune avec sa carte et ses horaires, pas une accusation automatique.
3. **Une donnée manque pour être précis : le temps en ligne Yango.** L'export Commandes dit quand le chauffeur était en course, pas quand son application était allumée. Sans elle on déduit ; avec elle on mesure. C'est la première chose à chercher dans Fleetroom (§3.3).
4. **Il faut deux à quatre semaines de données avant toute conclusion sur un chauffeur.** Le suivi a démarré le 13/10/2026 ; une « anomalie » n'a de sens que par rapport à une habitude, et l'habitude n'existe pas encore.

## 2. Le principe : la journée d'un véhicule est un budget à équilibrer

Chaque jour, pour chaque véhicule, on écrit l'égalité suivante :

```
km GPS du jour  =  km en course Yango
                +  km d'approche (aller chercher le client)
                +  km à vide légitimes (attente, repositionnement)
                +  km domicile ↔ zone de travail
                +  km de service (carburant, garage, lavage)
                +  km hors Yango déclarés (saisies validées dans l'app)
                +  RÉSIDU
```

Tous les termes sauf le dernier se calculent ou se bornent. **Le résidu est la mesure du hors Yango non déclaré** (et de l'usage personnel). La même égalité s'écrit en heures de mouvement.

C'est un bilan matière, comme en contrôle de gestion industriel : on ne cherche pas le voleur, on cherche ce qui ne boucle pas.

## 3. Les données, et ce qu'elles valent

### 3.1 Ce qu'on a

| Source | Grain | Ce qu'elle donne | Limite |
|---|---|---|---|
| GPS (GPSwox, relève 15 s) | 1 point / 15 s / véhicule | position, vitesse, horodatage | dernière position seulement : km légèrement sous-estimés dans les virages ; trou si la relève s'arrête |
| Trajets GPS (calcul M3A) | trajet | début, fin, distance, arrêts, bouchons absorbés | arrêt = immobile ≥ 5 min dans 50 m ; un dépose-client de 40 s n'est pas un arrêt |
| Export Commandes Yango | commande | prise en charge, fin, adresses départ → arrivée, distance, tarif, statut, plaque | chargé à J+1 ; pas d'heure d'acceptation ; adresses en texte, pas en coordonnées |
| Export Transactions Yango | mouvement de solde | espèces, carte, commissions, bonus | — |
| Déclarations et saisies hors Yango | jour | compteur, carburant, recettes hors Yango déclarées | déclaratif |
| Jours de repos | jour | repos déclaré | déclaratif |

### 3.2 Ce qu'on n'a pas

- **L'état de l'application Yango** (en ligne, occupé, hors ligne). C'est le cœur de votre question, et aucun des trois exports actuels ne le contient.
- **L'heure d'acceptation** d'une commande : on ne sait pas quand le trajet d'approche commence.
- **L'état du moteur et le niveau de carburant** : non fournis de façon fiable.
- **Un historique** : aucune position NMK avant le 13/10/2026.
- **Trois véhicules sur six** : Nabi (14 j), Omar Mane (29 j) et Raphael (6 j) étaient silencieux à l'enrôlement.

### 3.3 La donnée à aller chercher

Fleetroom propose en principe un rapport de temps de travail des chauffeurs (heures en ligne, par jour ou par session). **Non vérifié sur votre compte** : à regarder dans les rapports Fleetroom. S'il existe, c'est un quatrième export à charger avec les trois autres, et la question « roulait-il application éteinte ? » devient une mesure directe :

```
km hors ligne = km GPS parcourus pendant que le chauffeur est « hors ligne » chez Yango
```

Sans ce rapport, on travaille avec la méthode du §5, qui reste solide mais confond deux cas : application éteinte, et application allumée sans commande.

## 4. Les KPI que le GPS ajoute

Aujourd'hui les KPI chauffeurs viennent de Yango seul : acceptation, refus, heures en course, amplitude, occupation, XOF/km. L'amplitude Yango va de la première prise en charge à la dernière fin de course ; tout ce qui se passe avant, après, et entre les courses est invisible. Le GPS éclaire exactement cette zone.

### 4.1 Productivité

| KPI | Formule | Ce qu'il dit |
|---|---|---|
| **Taux de km productifs** | km en course Yango ÷ km GPS | part du roulage qui rapporte ; son complément est le « kilométrage mort » |
| **Occupation réelle** | heures en course ÷ heures de mouvement GPS | l'occupation actuelle divise par l'amplitude Yango, qui ignore le roulage hors créneau |
| **Recette par km réel** | (CA Yango + hors Yango déclaré) ÷ km GPS | le XOF/km actuel repose sur les km Yango ou le compteur déclaré |
| **Recette par heure de mouvement** | même numérateur ÷ heures de mouvement | rendement du temps réellement passé au volant |
| **Km d'approche par course** | km GPS dans la fenêtre avant prise en charge ÷ courses | coût caché de chaque course, par zone |

### 4.2 Contrôle

| KPI | Formule | Ce qu'il dit |
|---|---|---|
| **Km résiduels** | résidu du bilan §2 | hors Yango non déclaré + usage personnel |
| **Trajets type course hors créneau Yango** | comptage §5.2 | nombre de courses probables sans commande |
| **Recette hors Yango estimée** | tarif appris sur ses propres courses × trajets hors créneau (§5.4) | ordre de grandeur de ce qui n'est pas remonté |
| **Mouvement hors plage** | km et heures entre le dernier retour et le premier départ habituels, et les jours de repos | usage de nuit, usage un jour déclaré « repos » |
| **Écart compteur** | km compteur déclaré − km GPS | compteur faux ou boîtier muet |
| **Consommation implicite** | litres déclarés ÷ km GPS × 100 | au-dessus de la norme du modèle : carburant qui ne va pas dans ce véhicule, ou km manquants |
| **Écart de distance par course** | km GPS pendant la commande ÷ km Yango de la commande | doit rester proche de 1 ; sinon détour, ou plaque Yango ≠ véhicule réel |

### 4.3 Exploitation et risque

| KPI | Ce qu'il dit |
|---|---|
| Premier départ, dernier retour, durée au point de nuit | discipline horaire ; véhicule qui ne dort pas où il devrait |
| Lieux d'arrêt récurrents et nouveaux lieux (§6.2) | stations, garages, points d'attente ; un lieu nouveau et fréquent mérite une question |
| Sorties de zone | sur votre capture du 13/10, AB268FK roulait à 92 km/h près de Nguékhokh, à une soixantaine de km de Dakar : normal si c'est une mission, à expliquer sinon |
| Excès de vitesse (durée au-dessus d'un seuil) | risque d'accident et d'usure ; mesurable dès maintenant |
| Disponibilité du boîtier (couverture) | sans elle aucun des chiffres ci-dessus n'est interprétable |

## 5. Le cas central : rouler application éteinte

### 5.1 Étape 1 — découper le temps (algèbre d'intervalles)

Pour un véhicule et un jour, on pose deux séries d'intervalles sur le même axe horaire :

- **G** : les périodes de mouvement GPS ;
- **Y** : les commandes Yango terminées `[prise en charge, fin]`, rattachées au véhicule par la plaque.

Un balayage chronologique classe chaque minute de mouvement :

| Classe | Définition | Statut |
|---|---|---|
| **En course** | mouvement ∩ commande | expliqué |
| **Approche** | mouvement qui se termine à une prise en charge, dans la limite de τ minutes avant (τ ≈ 15, à calibrer) | expliqué |
| **Entre-courses court** | mouvement entre deux commandes séparées de moins de δ minutes (δ ≈ 20) | expliqué (repositionnement) |
| **Domicile** | premier et dernier trajet du jour, si une extrémité est le point de nuit habituel | expliqué |
| **Service** | trajet dont une extrémité est une station, un garage ou un lavage connus | expliqué |
| **Hors créneau** | tout le reste | **à qualifier** |

### 5.2 Étape 2 — reconnaître une course dans le « hors créneau »

Tout mouvement hors créneau n'est pas une course. Une course de taxi a une signature physique, qu'on teste sur chaque trajet hors créneau :

| Caractéristique | Course | Maraude ou usage personnel |
|---|---|---|
| Arrêt bref au départ (prise en charge, 30 s à 3 min) | oui | non |
| Trajet direct : distance à vol d'oiseau ÷ distance parcourue ≥ 0,6 | oui | faible (boucles) |
| Longueur 2 à 20 km, durée 8 à 45 min | typique | variable |
| Arrêt bref à l'arrivée puis redépart | oui | arrêt long |
| Départ d'un point de forte demande (aéroport, gare, marché, hôtel) | fréquent | indifférent |
| Enchaînement de plusieurs trajets de ce type | très typique | rare |

Un trajet qui coche la plupart des cases est compté comme **course probable hors Yango**. Le seuil se règle sur les courses Yango elles-mêmes : elles sont des courses certaines, donc l'étalon parfait. On mesure leur signature GPS, on en déduit les seuils, et on vérifie que le détecteur retrouve bien les courses Yango (son taux de détection) avant de le lancer sur le reste.

**Point technique.** Le découpage actuel coupe un trajet après 5 minutes d'immobilité. Un dépose-client dure moins : deux courses enchaînées sortent comme un seul trajet. Il faut ajouter une détection des **arrêts courts** (vitesse nulle 30 s à 5 min dans 30 m), ce que la relève à 15 secondes permet tout juste. C'est le principal développement du lot 1.

### 5.3 Étape 3 — retirer ce qui est déclaré

Les saisies hors Yango validées dans l'application sont légitimes. On les retranche : si le chauffeur a déclaré 3 courses hors Yango et que le GPS en voit 3, le résidu est nul. **Seul l'excédent compte.**

### 5.4 Étape 4 — chiffrer

Pour passer des trajets aux francs, on apprend le tarif sur les courses Yango du même véhicule (régression simple : `tarif ≈ a + b × km + c × minutes`), puis on l'applique aux courses probables hors créneau. Le résultat est un **ordre de grandeur de recette non remontée**, avec une fourchette, jamais un montant à réclamer.

Le coût direct pour l'entreprise se calcule sans hypothèse commerciale :

```
coût du résidu = km résiduels × (conso L/100 × prix du litre ÷ 100 + usure par km)
```

L'usure par km existe déjà dans l'application (amortissement des véhicules, migration 071).

### 5.5 Ce qui peut tromper le détecteur

| Faux positif | Parade |
|---|---|
| Trajet d'approche plus long que τ | calibrer τ par zone ; mieux : obtenir l'heure d'acceptation ou le temps en ligne |
| Commande annulée après déplacement | l'export contient les annulations et leur raison : les inclure comme mouvement expliqué |
| Dérive GPS à l'arrêt (faux kilomètres) | ignorer les déplacements sous 3 km/h dans un rayon de 30 m |
| Second chauffeur sur le même véhicule | rattacher par plaque et non par chauffeur ; regarder les deux séries de commandes |
| Usage personnel toléré (rentrer chez soi, déjeuner) | **une règle écrite** : ce qui est permis doit être défini avant d'être contrôlé |
| Export Yango incomplet (pris en cours de journée) | déjà bloqué par l'aperçu d'import ; n'analyser que les jours complets |
| Boîtier muet une partie du jour | marquer le jour « non exploitable » sous un seuil de couverture |

## 6. Repérer les habitudes et les exceptions

### 6.1 Corriger la mesure d'abord

À un point toutes les 15 secondes, la distance en ligne droite entre deux points coupe les virages. Deux remèdes, par ordre de coût :

1. **Lire l'historique complet de GPSwox** (tous les points émis) ;
2. **Recaler la trace sur le réseau routier** (map-matching par modèle de Markov caché, Newson & Krumm 2009), avec un moteur d'itinéraire libre comme OSRM.

Tant que ce n'est pas fait, on raisonne en **ratios et en écarts relatifs** (ce véhicule aujourd'hui contre lui-même hier), qui sont peu sensibles à un biais constant.

### 6.2 Lieux : regrouper les arrêts

Les points d'arrêt de plusieurs semaines sont regroupés par densité (DBSCAN, Ester et al. 1996 ; détection de points de séjour, Li & Zheng 2008). Chaque groupe devient un lieu : point de nuit, station, garage, point d'attente. On obtient pour chaque véhicule une carte de ses habitudes, et trois signaux gratuits : un lieu nouveau, un lieu qui devient fréquent, un point de nuit qui change.

Pour les cartes de chaleur (où et quand la flotte travaille), une grille hexagonale (H3) croisée avec l'heure donne les zones rentables et les zones de roulage à vide.

### 6.3 Habitudes : une ligne de base par véhicule et par jour de semaine

Avec six véhicules et quelques semaines, les méthodes lourdes ne valent rien. Ce qui marche sur peu de données :

- **Écart robuste** : pour chaque KPI, médiane et écart absolu médian (MAD) du véhicule sur le même jour de semaine. Une journée est atypique au-delà de 3 MAD. La médiane résiste aux journées folles, contrairement à la moyenne.
- **Comparaison aux pairs le même jour** : s'il pleut ou si c'est jour de fête, toute la flotte bouge ensemble. On compare donc l'écart d'un véhicule à l'écart médian de la flotte ce jour-là. Un chauffeur qui baisse quand tout le monde baisse n'est pas une anomalie.
- **Cartes de contrôle (CUSUM, Page 1954 ; EWMA)** : elles détectent une **dérive lente**, que l'écart journalier ne voit pas. Exemple : 4 km résiduels de plus chaque jour pendant trois semaines ne déclenchent jamais une alerte journalière, mais font basculer la somme cumulée. C'est l'outil le plus adapté à votre cas, car le hors Yango s'installe progressivement.

### 6.4 Quand l'historique sera là (2 à 3 mois)

- **Saisonnalité** (décomposition STL, Cleveland 1990) : séparer tendance, cycle hebdomadaire et résidu.
- **Détection multivariée** (Isolation Forest, Liu et al. 2008) : repérer des journées anormales par combinaison de KPI, dont aucun n'est anormal seul (peu de courses Yango + beaucoup de km + arrêts aux mêmes points que d'habitude).
- **Modèle de recette attendue** : `CA Yango attendu = f(heures de mouvement, km, jour, zone)`. Un chauffeur durablement sous sa recette attendue à activité égale roule sans encaisser dans Yango.
- **Frontière d'efficacité** (analyse par enveloppement des données, Charnes, Cooper & Rhodes 1978) : classer les véhicules par ce qu'ils produisent (recette) pour ce qu'ils consomment (km, heures, carburant). Elle donne à chacun un objectif atteignable, celui du meilleur comparable.

### 6.5 Ne pas se noyer dans les fausses alertes

Six véhicules × trente jours × dix KPI donnent 1 800 tests par mois. À 3 MAD, le hasard seul en fait sortir quelques-uns. Trois règles :

1. **Persistance** : une alerte n'est levée que si le signal apparaît 2 jours sur 3, ou si le CUSUM bascule.
2. **Convergence** : un score par jour additionne les indices indépendants (km résiduels, trajets type course, consommation implicite, mouvement hors plage). Un seul indice fort vaut moins que trois indices moyens.
3. **Budget d'alertes** : régler les seuils pour sortir au plus une à deux journées par semaine. Une liste longue n'est pas lue.

Chaque alerte ouvre sur sa preuve : la carte du trajet, les horaires, les commandes Yango de la journée en regard.

## 7. Étalonner avant de conclure

La fiabilité du détecteur doit être mesurée, pas supposée :

- **Les courses Yango sont la vérité terrain gratuite** : le détecteur de courses doit les retrouver. Son taux de réussite sur elles borne ce qu'on peut croire du reste.
- **Quelques journées témoins** : un véhicule conduit par une personne de confiance, qui note ses courses hors Yango. On compare au détecteur et on obtient un taux de faux positifs.
- **Tout chiffre publié porte sa couverture GPS** du jour. En dessous d'un seuil, le jour est exclu.

## 8. Cadre à poser avant de s'en servir

- **Règle interne** : ce qui est autorisé (rentrer avec le véhicule, hors Yango déclaré, trajets personnels) doit être écrit et connu des chauffeurs. Sans règle, le résidu n'est pas une faute.
- **Information des chauffeurs et déclaration CDP** : la géolocalisation de salariés ou de prestataires relève de la loi sénégalaise sur les données personnelles (2008-12). Le suivi hors des heures de service est le point le plus sensible. Un dossier « CDP-declaration » existe déjà dans vos documents : à vérifier qu'il couvre cet usage. Ce n'est pas un avis juridique.
- **Usage** : l'alerte déclenche une conversation, pas une sanction. Le document d'origine du module GPS écartait déjà la notation comportementale automatique pour cette raison.

## 9. Ordre de construction proposé

| Lot | Contenu | Prérequis | Résultat |
|---|---|---|---|
| **1** | Classement du mouvement (§5.1), arrêts courts, km en course / hors course, écart de distance par course ; tableau quotidien par véhicule | 1 semaine de données, export Commandes chargé chaque jour | premier chiffre de km résiduels, non encore interprétable seul |
| **2** | Détecteur de courses hors créneau (§5.2) étalonné sur les courses Yango ; retrait du hors Yango déclaré ; chiffrage (§5.4) | lot 1, 2 semaines | nombre et valeur des courses probables non déclarées |
| **3** | Lieux récurrents (§6.2), lignes de base MAD et CUSUM (§6.3), score et alertes (§6.5) | 3 à 4 semaines | une à deux journées par semaine à expliquer, avec preuve |
| **4** | Bilan carburant, mouvement hors plage et jours de repos, sorties de zone | règle interne écrite | contrôle complet du véhicule |
| **5** | Map-matching ou historique complet, saisonnalité, Isolation Forest, frontière d'efficacité | 2 à 3 mois | pilotage fin et objectifs par véhicule |

En parallèle, dès maintenant : chercher le rapport de temps en ligne dans Fleetroom, et faire réparer ou remettre en service les trois boîtiers muets.

## 10. Références des méthodes

- Newson P., Krumm J. (2009), *Hidden Markov Map Matching Through Noise and Sparseness*, ACM SIGSPATIAL.
- Li Q., Zheng Y. et al. (2008), *Mining User Similarity Based on Location History*, ACM SIGSPATIAL (points de séjour).
- Ester M. et al. (1996), *A Density-Based Algorithm for Discovering Clusters* (DBSCAN), KDD.
- Page E. S. (1954), *Continuous Inspection Schemes*, Biometrika (CUSUM).
- Cleveland R. B. et al. (1990), *STL: A Seasonal-Trend Decomposition Procedure Based on Loess*, Journal of Official Statistics.
- Liu F. T., Ting K. M., Zhou Z.-H. (2008), *Isolation Forest*, IEEE ICDM.
- Charnes A., Cooper W., Rhodes E. (1978), *Measuring the Efficiency of Decision Making Units*, European Journal of Operational Research.

Ces références sont citées de mémoire pour situer les méthodes ; elles n'ont pas été relues pour ce document.
