# Texte à coller dans Claude Code — ajustements UI v2 (après #130)

```
Les 7 PR UI v2 sont mergées. Fais maintenant les ajustements ci-dessous.

RÈGLES (inchangées) :
- Une branche par lot, basée sur main, une PR par lot, dans l'ordre A → E.
- 100 % présentation. Ne pas modifier : routes API, requêtes Supabase, RLS, lib/calc.ts, lib/reportNet.ts, useDashboardKPIs, usePilotage, schéma. Seule exception : le lot E, une migration additive idempotente.
- Pour chaque PR : tsc, lint (pas de nouveau problème), npm test, build et ui-guard verts. 5/5 checks GitHub. Lien Preview.
- Si un point touche à la logique ou aux données, arrête-toi et demande-moi.
- À la fin, donne-moi un tableau : PR → contenu → checks → Preview.

LOT A — fix: filtres (gestionnaire)
1. Filtre Mois : aujourd'hui, choisir un mois ne change rien. Le mois choisi doit piloter useDashboardKPIs, le briefing, Coûts par poste, la file À valider, et tous les écrans qui ont la barre de filtres.
2. Ajouter « Dates » dans la barre de période. Voir la maquette 6a (Admin.dc.html) :
   - popover avec des raccourcis : Aujourd'hui, Hier, Cette semaine, 2 dernières sem., Mois dernier, 30 derniers jours ;
   - un calendrier pour choisir une plage ;
   - un bouton « Appliquer · N j ».
3. Chauffeurs : passer au choix multiple. Voir la maquette 6b :
   - recherche, « Tous les chauffeurs », cases à cocher, les inactifs grisés ;
   - le libellé affiche « 2 chauffeurs » ;
   - la bordure devient orange quand un filtre est actif.
   filterDriverId devient une liste. Si le hook n'accepte qu'un seul id, agréger côté UI sans toucher au hook. Si c'est impossible, dis-le-moi.
4. L'état des filtres va dans l'URL (?p=mois&m=2026-09 ou ?du=2026-09-08&au=2026-09-21, &d=id1,id2) et survit au rechargement.
5. Tests : changer de mois, de plage ou de chauffeurs change bien les chiffres.

LOT B — fix: app chauffeur
6. Ajouter un bouton « Se déconnecter » :
   - en bas de Profil (ouvert depuis l'avatar de l'en-tête), en rouge, avec l'icône LogOut. Voir la maquette 2d (Driver.dc.html) ;
   - il appelle la déconnexion existante ;
   - vérifier qu'il existe aussi en mode ancienne UI.

LOT C — feat: lien Espace opérateur
7. Sur la page de connexion (app/auth/login), sous le formulaire, ajouter un petit lien discret : « Espace opérateur » → route superadmin existante. Style : 12 px, couleur --sk-t2, soulignement au survol. Voir la maquette 3b (Owner and Platform.dc.html). Ne rien changer à l'accès superadmin : le lien mène seulement à la page de connexion opérateur existante.

LOT D — feat: Pilotage et Finance (maquettes 2d et 4b de Admin.dc.html)
8. Pilotage :
   - sous-onglets Vue d'ensemble / P&L / Cash flow / Simulation ;
   - 3 chiffres : Km parcourus, Coût/km, Net/km ;
   - tableau par chauffeur : Jours, Net validé, En attente, Net/km, Écart GPS (orange au-delà de 15 %) ;
   - graphe des km par jour.
   Les données viennent de usePilotage, sans modifier ses calculs.
9. Finance :
   - 4 chiffres : Encaissements, Décaissements (= dépenses + avances CAT_AVANCE), Masse salariale projetée, Marge après salaires ;
   - tableau des salaires : Chauffeur, Palier, Salaire dû, Avances, Reste à payer, et « Marquer payé » avec l'action existante de PaymentsTab ;
   - derniers mouvements ;
   - les sous-onglets Paiements / Avances / Journal restent.

LOT E — activation propre
10. /ui-v2 renvoie 404 dans l'app mobile installée (PWA). Trouve la cause (service worker, cache, middleware) et corrige.
11. Remplacer l'activation par localStorage par un réglage par tenant :
    - colonne tenant_settings.ui_v2 boolean default false (migration additive idempotente) ;
    - interrupteur dans Paramètres → « Nouvelle interface », réservé aux admins ;
    - garder localStorage comme surcharge par appareil, pour les tests.
12. Protéger /ui-v2 en production : accessible seulement aux admins connectés, ou 404.

À NE PAS CORRIGER, seulement expliquer :
13. Le briefing affiche « Net opérationnel (7 j) » = −111 568 (−5,4 %), puis juste en dessous +11 929 (+9,7 %). Explique d'où vient chaque chiffre (fichier, fonction, requête). Ne modifie rien.
```
