# Ajustements à faire après les 7 PR (UI v2)

Relevés pendant les tests du 24/09/2026. À traiter dans une seule PR « fix: ajustements UI v2 », basée sur main, une fois #130 fusionnée.

## Filtres (gestionnaire)
1. **Filtre Mois** : sélectionner un mois ne change pas les chiffres. Le mois doit piloter `useDashboardKPIs`, le briefing, Coûts par poste et la file À valider.
2. **Filtre dates** : il n'existe pas. Ajouter une plage « du … au … », en plus de Jour / 7 j / Mois / Année.
3. **Filtre chauffeur** : on ne peut pas en choisir plusieurs. Passer à une sélection multiple (cases à cocher + « Tous »).
4. L'état des filtres doit rester dans l'URL (`?p=&du=&au=&d=id1,id2`) et s'appliquer partout où il y a la barre de filtres.

## App chauffeur
5. **Déconnexion** : le bouton manque. Il doit être dans Profil (avatar de l'en-tête), tout en bas, en rouge, comme sur la maquette 2d.

## Activation
6. `/ui-v2` renvoie 404 sur l'app mobile installée (cache du service worker ?).
7. Il faut un interrupteur propre pour activer v2 par tenant (Paramètres), au lieu de `localStorage`.

## Écrans pas encore refaits (vague suivante)
10. **Pilotage** : pas prévu dans les étapes 1–7. Appliquer la maquette 2d :
    - sous-onglets Vue d'ensemble / P&L / Cash flow / Simulation ;
    - 3 KPI : Km, Coût/km, Net/km ;
    - table par chauffeur avec Net/km et Écart GPS ;
    - km par jour.
    Aucun calcul de `usePilotage` ne change.
11. **Finance** : l'étape 5 a seulement regroupé les onglets existants (Paiements, Avances, Journal). Appliquer la maquette 4b :
    - 4 KPI : Encaissements, Décaissements (dépenses + avances), Masse salariale, Marge après salaires ;
    - table des salaires (palier, dû, avances, reste, « Marquer payé ») ;
    - derniers mouvements.

## À vérifier (pas de correction sans accord)
8. Le briefing affiche « Net opérationnel (7 j) » = −111 568 (−5,4 %), puis juste en dessous +11 929 (+9,7 %). Il faut expliquer la source de chaque chiffre.
9. Protéger ou retirer la page de démo `/ui-v2` en production.
