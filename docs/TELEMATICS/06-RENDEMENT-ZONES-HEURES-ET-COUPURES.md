# Rendement par zone et par heure, et fiche de coupure Yango

> Suite de `05-ANALYSE-KPI-HORS-YANGO.md`, demandée par Abdou le 13/10/2026.
> La partie A repose sur des chiffres réels : les exports Commandes Yango présents sur le poste (`Downloads/report_orders*.csv`), analysés le 13/10/2026. La partie B est une conception : elle attend le rapport de temps en ligne.

## Résumé

1. **Le prix au km et le gain à l'heure ne désignent pas les mêmes créneaux.** À 17 h le km est le mieux payé de la journée (+10 % sur le tarif attendu), mais la circulation tombe à 13 km/h : le gain par heure de course y est dans la moyenne basse. Le vrai pic est **6 h – 8 h**, et il tient 12 mois sur 13.
2. **Le dimanche est le jour le plus rentable à l'heure, 13 mois sur 13, et c'est le jour où la flotte travaille le moins** : moitié moins d'heures qu'un jour de semaine.
3. **Aucun créneau de jour n'est « inutile » d'après Yango seul.** Hors pics, les écarts entre créneaux sont de l'ordre de ±15 %. Le vrai gisement est ailleurs : **41 % de l'amplitude d'une journée n'est pas en course** (5 h sur 12,6 h). Yango ne dit pas ce qui s'y passe ; le GPS et le temps en ligne, si.
4. **Même sans rapport de temps en ligne, le silence de Yango est déjà un signal fort.** La flotte reçoit environ 3 sollicitations par heure d'activité. Un véhicule qui roule 90 minutes sans aucune sollicitation a moins de 1 % de chances d'avoir eu l'application allumée.
5. **Avec le rapport de temps en ligne**, on produit pour chaque coupure une fiche : heure et lieu de la coupure, km roulés hors ligne, trajet, arrêts, heure et lieu de la remise en ligne.

---

# Partie A — Ce que disent déjà les commandes Yango

## A1. Les données

| | |
|---|---|
| Période | 04/10/2025 → 11/10/2026 |
| Lignes distinctes | 46 737, dont 31 097 courses terminées et 15 636 annulées |
| Courses exploitables | 30 995 (durée 1 à 180 min, distance 0,3 à 80 km) |
| Véhicules, chauffeurs | 11 plaques, 17 chauffeurs |
| Chiffre d'affaires | 56,5 M XOF, encaissé à 99 % en espèces |
| Kilomètres en course | 181 594 km |
| Heures en course | 11 745 h |
| Commission Yango | 14,9 % du tarif |

Une journée type de chauffeur (1 550 journées) : 20 courses, 36 400 XOF, 117 km en course, 12,6 h d'amplitude entre la première prise en charge et la dernière dépose, dont **59 % en course**. Rapporté à l'amplitude, cela fait 2 839 XOF par heure.

**Limite de lecture.** Les « heures d'activité » utilisées plus bas sont reconstituées : des événements Yango (course, refus, annulation) espacés de 45 minutes au plus forment une session. Une attente longue sans aucune sollicitation n'y figure pas. Les gains « par heure d'activité » sont donc des majorants ; ils servent à comparer les créneaux entre eux, pas à prévoir un revenu.

## A2. Le tarif s'explique à 75 % par la distance et la durée

Régression sur les 30 995 courses :

```
tarif ≈ 340 + 183 × km + 18 × minutes        (R² = 0,755 ; erreur médiane 251 XOF)
```

Lecture : une prise en charge vaut 340 XOF, chaque km 183 XOF, chaque minute 18 XOF. Deux usages immédiats :

- **estimer la valeur d'un trajet hors Yango** à partir de sa distance et de sa durée GPS (document 05, §5.4) ;
- **mesurer la majoration** : le rapport tarif réel ÷ tarif attendu dit quand et où Yango paie plus que la normale.

| Heure | 0–5 h | 6 h | 7 h | 8–12 h | 13–16 h | 17 h | 18 h | 19–20 h | 21–23 h |
|---|---|---|---|---|---|---|---|---|---|
| Majoration médiane | 0,83–0,88 | 0,94 | **1,06** | 0,92–0,95 | 1,00–1,03 | **1,10** | 1,05 | 0,96–0,98 | 0,88–0,92 |

La classe compte autant que l'heure : Confort 1,02 et Comfort+ 1,05 contre Éco 0,91.

## A3. Par heure : le km le mieux payé n'est pas l'heure la mieux payée

| Heure | Courses | XOF/km médian | Vitesse (km/h) | XOF par heure d'activité | Annulation client |
|---|---|---|---|---|---|
| 0–5 h | 1 234 | 244–297 | 20–25 | 3 240–4 050 | 19–21 % |
| **6 h** | 381 | 301 | 19,5 | **6 150** | 17 % |
| **7 h** | 936 | **385** | 14,8 | **5 060** | 22 % |
| 8–11 h | 7 866 | 319–336 | 16–17 | 3 820–4 110 | 16–21 % |
| 12–13 h | 3 678 | 333–343 | 14,7 | 3 700 | 21–22 % |
| 14–16 h | 5 601 | 349–364 | 14–15,6 | 4 040–4 300 | 23–24 % |
| **17 h** | 1 715 | **394** | **12,8** | 3 930 | **26 %** |
| 18–19 h | 3 449 | 353–378 | 13–13,7 | 3 620–3 740 | 22–24 % |
| 20–23 h | 6 135 | 295–337 | 15–19 | 3 570–3 780 | 20–22 % |

Trois enseignements :

1. **6 h – 8 h est le meilleur créneau** : routes libres à 6 h, majoration à 7 h. Le gain par heure en course dépasse la moyenne 12 mois sur 13. Or la flotte n'y est présente que 462 h sur l'année, contre plus de 900 h pour chaque heure de l'après-midi.
2. **17 h – 19 h est un piège** : le km est le mieux payé, mais on roule à 13 km/h et un quart des commandes est annulé par le client, souvent après un trajet d'approche. Le gain horaire retombe sous celui de 15 h.
3. **La nuit paie mal au km (majoration 0,85) mais roule vite** : le gain horaire reste correct tant qu'il y a des courses, avec une attente qui double vers 3 h – 5 h (6 à 7 minutes entre deux courses, contre 3,6 l'après-midi).

## A4. Par jour : le dimanche est sous-exploité

| Jour | Heures d'activité | XOF par heure d'activité | Vitesse (km/h) |
|---|---|---|---|
| Lundi | 2 222 | 4 029 | 13,8 |
| Mardi | 2 401 | 3 780 | 13,4 |
| Mercredi | 2 360 | **3 684** | 13,4 |
| Jeudi | 2 280 | 3 764 | 13,3 |
| Vendredi | 2 115 | 3 879 | 13,6 |
| Samedi | 1 954 | 4 105 | 14,7 |
| **Dimanche** | **1 132** | **4 384** | **16,3** |

Le dimanche rapporte 19 % de plus par heure que le mercredi, parce qu'on y roule plus vite et que les courses sont plus longues. Mesuré par heure en course, il bat la semaine **chaque mois sans exception** (de +7 % à +30 %). C'est le résultat le plus solide de l'étude et le levier le plus simple : une rotation qui met des véhicules sur la route le dimanche.

## A5. Par zone : deux classements opposés

Les adresses Yango portent un code de rue (« Rue GY-39 ») dont le préfixe désigne la commune ; la correspondance a été apprise sur les adresses elles-mêmes (GY = Grand Yoff, 1 024 cas sur 1 024). 60 % des départs ont un code.

| Zone de départ | Courses | XOF/km | Vitesse | XOF par heure en course |
|---|---|---|---|---|
| Dieuppeul-Derklé | 838 | **385** | 11,9 | 4 590 |
| Fann-Point E-Amitié (AAB) | 417 | 383 | 12,5 | 4 770 |
| Médina | 418 | 369 | 11,6 | 4 440 |
| Sacré-Cœur | 1 312 | 361 | 12,8 | 4 560 |
| Sicap Liberté | 1 673 | 355 | 13,1 | 4 780 |
| Grand Yoff | 2 068 | 349 | 12,7 | 4 640 |
| HLM | 786 | 350 | 11,5 | **4 100** |
| Biscuiterie | 572 | 359 | 11,3 | **4 110** |
| Mermoz | 1 328 | 322 | 14,8 | 4 920 |
| Ngor-Almadies | 825 | 301 | 17,2 | **5 200** |
| Ouakam | 1 556 | **297** | 15,3 | 4 570 |
| Fann (FN) | 290 | 310 | 17,7 | **5 460** |

Le centre dense paie le mieux au km et le moins bien à l'heure ; la corniche et les Almadies font l'inverse. **C'est l'heure qu'il faut maximiser**, parce que le temps est la ressource rare et que le carburant pèse peu : à 6 L/100 et 990 XOF le litre (hypothèse à remplacer par vos chiffres), un km coûte environ 59 XOF de carburant, soit 17 % du tarif médian au km.

**La valeur d'une destination.** Une course vaut son tarif plus ce qui vient après. Après une dépose à Liberté, Médina ou Fass, la course suivante arrive en 2,8 à 3 minutes (médiane) ; après Ngor, Fann, Patte d'Oie ou Golf Sud, en 4,4 à 4,8 minutes. Une course vers les Almadies paie bien mais dépose dans une zone où l'on attend 50 % plus longtemps.

## A6. Ce qu'on apprend des chauffeurs

| Chauffeur | Heures d'activité | XOF par heure | XOF/km | Acceptation | Présence 6–9 h | Présence 18–23 h |
|---|---|---|---|---|---|---|
| Ngom Emile Abdou | 666 | **4 198** | 389 | 97 % | 11 % | 36 % |
| Seck Cheikh Oumar | 1 979 | 4 089 | 340 | 91 % | 7 % | 44 % |
| Bah Abdourahmane | 723 | 4 015 | 317 | 92 % | 17 % | 32 % |
| Fall Souka | 1 800 | 4 004 | 348 | 92 % | 17 % | 18 % |
| Fall El Hadj Ibrahima | 3 126 | 3 937 | 336 | 87 % | 18 % | 28 % |
| Ngouma Raphael | 2 567 | 3 928 | 334 | 92 % | 18 % | 28 % |
| Mane Omar Idionty | 2 099 | 3 617 | 330 | **98 %** | **7 %** | 42 % |
| Seidi Amadu | 298 | **3 487** | 313 | 97 % | 12 % | 37 % |

Huit des dix chauffeurs à plus de 150 heures d'activité sont montrés.

- **20 % d'écart** entre le premier et le dernier, à activité comparable.
- **Accepter tout ne paie pas** : Mane Omar accepte 98 % des demandes et se classe huitième sur dix.
- **Les horaires n'expliquent presque rien de l'écart.** La décomposition faite ensuite dans l'application (effet des horaires, puis reste) attribue aux horaires moins de 100 XOF par heure pour chaque chauffeur, sur un écart total de 700 XOF. Mane Omar travaille peu le matin, mais ce n'est pas ce qui le pénalise : l'écart tient à la manière de travailler (courses choisies, zones, attente), et c'est le GPS qui permettra de l'ouvrir.
- **Emile obtient le meilleur prix au km** (389 XOF, courses à 1 900 XOF de médiane) : à vérifier s'il s'agit de la classe du véhicule (Confort) ou de ses choix.

Pour passer de ces constats à une explication chiffrée, la méthode est une **décomposition d'écart** : l'écart de gain horaire entre deux chauffeurs se sépare en effet d'horaires, effet de zones, effet de classe du véhicule, et un reste qui est le savoir-faire propre. Seul ce reste s'apprend d'un chauffeur à l'autre ; les trois autres se règlent par le planning.

## A7. Ce que ces chiffres ne permettent pas de dire

- **Si un créneau est « inutile ».** Il faudrait le temps passé en ligne sans sollicitation, que les sessions reconstituées ne voient pas, et les km à vide, que Yango ne voit pas du tout.
- **Si c'est l'heure qui cause le gain.** Les chauffeurs choisissent leurs horaires : ceux qui sortent à 6 h sont peut-être simplement les meilleurs. Seul un essai le tranche (§C4).
- **Le marché.** On observe la flotte, pas la demande totale de Dakar.
- **L'évolution des tarifs.** Le gain par heure en course varie de 4 300 à 5 900 XOF selon les mois (creux en mars-avril, pic en août) : toute comparaison doit se faire à mois égal.

---

# Partie B — La fiche de coupure

## B1. Avec le rapport de temps en ligne

Le rapport donne, par chauffeur, des périodes avec un état : en ligne et libre, en course, hors ligne. On les pose sur le même axe que les points GPS du véhicule.

**Pour chaque période hors ligne pendant laquelle le véhicule a bougé**, on calcule :

| Élément | Calcul |
|---|---|
| Heure et lieu de la coupure | position GPS la plus proche du début de la période, géocodée |
| Contexte de la coupure | dernière course : où elle a déposé, combien de minutes avant |
| Distance roulée hors ligne | somme des segments GPS dans la période, dérive à l'arrêt exclue |
| Temps en mouvement | durée des segments au-dessus de 3 km/h |
| Arrêts | lieu et durée de chaque arrêt, en distinguant arrêt court (30 s à 5 min) et arrêt long |
| Trajets type course | nombre de segments « arrêt court → trajet direct → arrêt court » (document 05, §5.2) |
| Valeur estimée | modèle de tarif A2 appliqué à chacun de ces trajets |
| Remise en ligne | heure, lieu, et distance à vol d'oiseau depuis le point de coupure |
| Coût direct | km hors ligne × (carburant + usure par km) |

**Ce que la fiche affiche**, en une phrase et une carte :

> Mardi 14 h 32, coupure à Liberté 6, 4 minutes après une dépose. **23 km roulés en 1 h 09 hors ligne** : Liberté → Yoff (arrêt 2 min) → Almadies (arrêt 3 min) → Ouakam. Trois trajets ont la forme d'une course, valeur estimée 5 400 XOF. Remise en ligne à 15 h 41 à Ouakam. Aucune recette hors Yango déclarée ce jour-là.

(Exemple fabriqué pour montrer le format.) Un clic ouvre le rejeu du Suivi GPS, calé sur l'heure de la coupure : l'outil existe déjà.

## B2. Les motifs à chercher dans les coupures

Une coupure isolée ne dit rien. Ce sont les répétitions qui parlent :

| Motif | Test |
|---|---|
| **Coupure en zone de forte demande** | pourquoi s'éteindre là où les courses arrivent en 3 minutes ? On compare le lieu de coupure à la carte de valeur des zones (A5) |
| **Coupure à heure fixe** | même créneau plusieurs jours de suite : un client régulier hors application |
| **Coupure juste après une course** | le client de la course devient un client direct pour le retour |
| **Mêmes lieux d'arrêt pendant les coupures** | regroupement des arrêts hors ligne (DBSCAN) : une gare, un hôtel, un marché |
| **Taux de coupure roulée** | km hors ligne ÷ km totaux, par chauffeur, comparé aux pairs le même jour |
| **Dérive** | carte CUSUM sur les km hors ligne quotidiens : détecte une installation progressive |

Le miroir est tout aussi utile pour l'optimisation : **en ligne et immobile** (où attend-on, et combien de temps ?), **en ligne et roulant sans course** (maraude : combien de km pour trouver un client ?).

## B3. Sans le rapport : le silence de Yango comme preuve

Chaque ligne de l'export Commandes prouve que l'application était allumée à cet instant, y compris les refus et les annulations (15 636 lignes). La flotte reçoit en moyenne **3,2 sollicitations par heure d'activité** (46 737 événements pour 14 464 heures).

Si les sollicitations arrivent au hasard à ce rythme (loi de Poisson), la probabilité de n'en recevoir aucune pendant une durée T, application allumée, vaut `exp(−3,2 × T)` :

| Silence | Probabilité si l'application était allumée |
|---|---|
| 30 min | 20 % |
| 60 min | 4 % |
| 90 min | 0,8 % |
| 2 h | 0,2 % |

Un véhicule qui roule 90 minutes en journée sans une seule ligne dans Yango avait donc, selon toute vraisemblance, l'application éteinte. On affine en calculant le rythme par zone et par heure (il est plus faible la nuit), ce qui donne pour chaque silence un niveau de confiance.

Limites : le rythme de 3,2 est mesuré pendant les sessions actives, donc un peu surestimé ; et un chauffeur peut être en ligne mais hors de portée des demandes. C'est pourquoi le rapport de temps en ligne reste préférable : il transforme une probabilité en constat.

---

# Partie C — Aller plus loin : optimiser

## C1. La bonne unité : la marge par heure

```
marge horaire = recette de l'heure × (1 − 14,9 %)
              − (km en course + km à vide) × (carburant + usure par km)
```

Sur les moyennes Yango : 2 839 XOF par heure d'amplitude, soit 2 416 après commission, pour 9,3 km en course par heure. Les **km à vide sont l'inconnue**, et c'est exactement ce que le GPS mesure. Avec 5 km à vide par heure et 59 XOF/km de carburant (hypothèses), la marge avant usure et part du chauffeur serait d'environ 1 570 XOF par heure.

« Ça ne sert à rien de rouler » devient alors une règle calculable : **un créneau est à éviter quand sa marge horaire attendue passe sous un seuil**, que vous fixez (coût du temps du chauffeur, usure). Avec le GPS, on calcule cette marge pour chacun des 168 créneaux de la semaine et pour chaque zone.

## C2. La carte de valeur zone × heure

- **Découpage** : communes au départ (on les a déjà), puis grille hexagonale H3 dès que le GPS donne le point exact de prise en charge (la position du véhicule à l'heure de la commande), ce qui remplace l'adresse en texte.
- **Cellules peu remplies** : 20 zones × 168 créneaux font 3 360 cellules pour 31 000 courses. On stabilise chaque cellule en la tirant vers la moyenne de sa zone et de son créneau, d'autant plus fort qu'elle contient peu de courses (estimateur bayésien empirique). Sans cela, la « meilleure cellule » est juste la plus chanceuse.
- **Contexte** : jour férié, Ramadan, Tabaski, Magal, fin de mois, pluie, grands événements. On ajoute ces variables à un modèle de gain par créneau ; le creux de mars-avril 2026 et le pic d'août sont des candidats à expliquer.

## C3. Où se placer et quelle course prendre

Le problème est connu en recherche opérationnelle : un taxi est un **processus de décision markovien**. À chaque instant, l'état est (zone, heure) ; les actions sont attendre, se déplacer vers une zone voisine, accepter une course. On calcule par programmation dynamique la **valeur V(zone, heure)** : le gain attendu sur les heures suivantes en partant de là (Rong et al. 2016 ; Yuan & Zheng 2011 pour la recherche du prochain client).

Ce que cela donne en pratique :
- **après une dépose**, la zone voisine où attendre, quand l'écart de valeur dépasse le coût du déplacement ;
- **la vraie valeur d'une course** : tarif + V(destination) − V(départ). Une course à 3 000 XOF vers une zone morte peut valoir moins qu'une course à 2 000 XOF vers Liberté ;
- **l'heure d'arrêt** : continuer tant que la valeur de l'heure suivante dépasse le seuil de C1.

## C4. Prouver que ça marche

Les données observées ne prouvent pas une cause (A7). Pour valider une recommandation, par exemple « sortir à 6 h » ou « travailler le dimanche », on la teste : la moitié des chauffeurs l'applique deux semaines, puis on inverse. L'écart de marge horaire entre les deux périodes, à chauffeur égal, est l'effet réel.

## C5. Ordre proposé

| Étape | Contenu | Dépend de |
|---|---|---|
| 1 | Tableau de bord rendement : grille jour × heure, zones, majoration, classement chauffeurs avec décomposition d'écart | rien : les commandes sont déjà en base |
| 2 | Silences Yango croisés au GPS (B3) : première liste de périodes roulées sans sollicitation | 1 à 2 semaines de GPS |
| 3 | Fiche de coupure (B1) et motifs (B2) | rapport de temps en ligne |
| 4 | Km à vide, approche, marge horaire réelle (C1), points de prise en charge exacts | 3 à 4 semaines de GPS |
| 5 | Carte de valeur stabilisée, contexte, valeur des destinations (C2, C3) | étape 4, 2 à 3 mois |
| 6 | Recommandations de planning et essais (C4) | étape 5 |

## Références

- Rong H. et al. (2016), *The Rich and the Poor: A Markov Decision Process Approach to Optimizing Taxi Driver Revenue Efficiency*, ACM CIKM.
- Yuan J., Zheng Y. et al. (2011), *Where to Find My Next Passenger?*, ACM UbiComp.

Citées de mémoire pour situer les méthodes ; non relues pour ce document. Les scripts d'analyse de la partie A ne sont pas dans le dépôt : ils sont à reprendre dans l'application à l'étape 1.
