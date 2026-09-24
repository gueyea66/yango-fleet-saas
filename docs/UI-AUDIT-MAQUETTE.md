# UI Audit — Maquette vs Implémentation

Checklist obligatoire avant tout merge / APK / envoi d'UI : chaque écran livré
est audité contre la maquette validée par Abdou. Écarts autorisés uniquement
s'ils sont justifiés (contrainte technique ou métier) et documentés ici.

---

## Chantier : Mode simple propriétaire (`feat/ui-mode-simple`) — 2026-08-10

**Maquette validée** : artifact « M3A Fleet — Mode Simple » v2 (treemap + KPI ops).
**Activation** : `tenant_settings.ui_mode = 'simple'` (migration 037) — défaut `full`, zéro changement pour les tenants existants.

### Accueil
| Élément maquette | Implémenté | Écart / justification |
|---|---|---|
| Hero : Net final (grand) + Recettes brutes + Dépenses | ✅ | Chiffres issus de `useDashboardKPIs` (calc.ts source de vérité) |
| Bloc « À valider » avec bouton Valider par déclaration | ✅ | Complété le 11/08 (retour Abdou : « on doit pouvoir y vivre sans le mode avancé ») : rapports ET dépenses en attente, détails dépliables (brut, bonus, commission, net, solde, compteur, courses, commentaire), Valider/Rejeter, mêmes écritures que l'UI complète (statut + action_logs + notification push chauffeur), refresh des KPIs après action |
| Graphe Recettes par jour (Brut ambre / Hors-app violet / Net vert) | ✅ | Recharts, couleurs identiques à l'UI complète |
| Treemap « Dépenses par catégorie » (modèle appli originale) | ✅ | Cellule et couleurs `EXPENSE_COLORS` reprises à l'identique |
| KPI opérationnels : KM/jour · Solde conso/jour · Coût au km · Net moyen/jour | ✅ | Coût/km = (solde consommé + carburant consommé) / km total |
| Tableau récap journalier + ligne Total | ✅ | Colonnes Date/Brut/Hors-app/Dépenses/Net/KM |
| Bascule « Mode avancé » | ✅ | Bouton (pas un switch) → rend l'UI complète historique ; retour via « ← Revenir au mode simple » dans la sidebar et la nav mobile |

### Pilotage
| Élément maquette | Implémenté | Écart / justification |
|---|---|---|
| Cards KM parcourus / Coût par km / Net par km | ✅ | |
| Graphe KM par jour | ✅ | |
| Tableau par chauffeur | ⚠️ partiel | Colonnes Jours / Net validé / En attente. Le KM par chauffeur n'existe pas dans les KPIs agrégés (calcul odomètre par véhicule) — ajout ultérieur si demandé, sans dupliquer de calcul |

### Équipe
| Élément maquette | Implémenté | Écart / justification |
|---|---|---|
| Liste chauffeurs + véhicule attribué | ✅ | |
| Choix du mode de rémunération par chauffeur | ✅ | Select 5 modèles réels (`fixed/tiered/percent/hybrid/location` — migration 027) au lieu des 3 chips maquette ; l'API `update` écrasant tous les champs, les valeurs existantes sont renvoyées avec le nouveau modèle |
| Ajout chauffeur | ✅ | Champs ID + nom + mot de passe (exigés par l'API de création de compte) au lieu de nom + téléphone sur la maquette |
| Ajout véhicule (plaque, marque, modèle) | ✅ | Détails complets (assurance, visite…) restent dans la gestion de flotte avancée |
| Attribution véhicule → chauffeur | ✅ | Select sur chaque véhicule (update `vehicles.driver_id`) |

### Garanties zéro risque
- [x] Couche additive : `ui_mode` défaut `'full'` → UI historique strictement inchangée
- [x] Aucun calcul métier dupliqué : lecture seule de `useDashboardKPIs` / APIs existantes
- [x] Migration 037 idempotente (`ADD COLUMN IF NOT EXISTS`)
- [x] Build production + 143 tests verts

---

## Chantier : Refonte UI v2 (`ui-v2/etape-*`) — 2026-09-24

**Maquettes** : `design_handoff_refonte_m3a/*.dc.html` (README + MIGRATION).
**Activation** : `tenant_settings.ui_v2` (migration 062, défaut `false`) ou, sur un appareil, `localStorage.setItem("m3a-ui","v2")`.
**Garde-fou** : `bash scripts/ui-guard.sh origin/main` à chaque étape ; captures drapeau OFF comparées au pixel (`scripts/ui-v2-capture.mjs diff`).

### Étape 0 — Fondations
| Élément maquette | Implémenté | Écart / justification |
|---|---|---|
| Typo Geist sur `body` | ✅ | Scopée sous `html[data-ui="v2"]` : drapeau OFF, `body` reste en Arial (règle « aucun changement visible ») |
| Chiffres Geist Mono + `tabular-nums` | ✅ | Classe `.v2-num` |
| Tokens `--sk-*` / `--fleet-*` / `--tenant-color` | ✅ | Teintes sans variable (Valider `#22c55e`, nav `#c3c8d6`, Net Yango `#60a5fa`, Hors Yango `#c084fc`, teintes d'état, IA/Calculé) ajoutées en `--v2-*`, avec variantes mode clair |
| Sous-labels `#555e75` → `--fleet-text-muted` | ✅ | Via `--v2-muted` dans les composants v2 uniquement ; les écrans actuels ne sont pas modifiés |
| Émojis → Lucide | ⚠️ reporté | `tabGroups` admin utilise déjà Lucide. Les émojis restants (`navItems` chauffeur, `ThemeToggle`) sont remplacés dans les écrans v2 des étapes 1–2, pas dans l'UI actuelle |
| `Card`, `Stat`, `Segmented`, `ListRow`, `StatusDot`, `BottomNav`, `FilterBar`, `Badge` | ✅ | `components/ui/` + `Button`. Planche de relecture : `/ui-v2` (drapeau allumé) |
| FilterBar : période / dates / chauffeur, bordure orange quand filtré | ✅ | Composant contrôlé ; variante `chips` (puces 44 px) pour le mode simple mobile. Période + chauffeur sérialisables en `?p=…&d=…` (`lib/v2/filters.ts`) |
| Sortir `CalcBadge` / `AiBadge` de `AiBriefingSection` | ⚠️ partiel | Équivalents v2 dans `components/ui/Badge.tsx` ; `AiBriefingSection` n'est pas modifié (règle : pas d'édition des composants actuels hors drapeau) |

### Garanties
- [x] Migration 062 additive et idempotente, **non exécutée**
- [x] Aucune écriture Supabase ajoutée (ui-guard)
- [x] Drapeau OFF : 8 pages capturées, 0 px d'écart avec `main`
- [x] `tsc` · 234 tests · build OK ; lint : 0 problème ajouté (774 préexistants sur `main`)

### Étape 1 — App chauffeur (`Driver.dc.html`)
| Écran / élément maquette | Implémenté | Écart / justification |
|---|---|---|
| Bottom nav 4 onglets 64 px, actif vert + indicateur 2 px | ✅ | `Tab` garde ses 7 valeurs (`bottomNavFor`) ; Profil masque la barre (2d) |
| 1a Accueil : salutation, carte d'état + bouton 58 px, carte palier 4 niveaux, 3 raccourcis | ✅ | Aide « 2 captures… » seulement si l'extraction répond 200. Rapport rejeté : bandeau rouge « corrige et renvoie ». Modèles non-paliers : résumé du modèle |
| 1b Captures : 3 tuiles, « Lire mes captures » dès 1 image, « Saisir à la main » | ✅ | Monté seulement si `GET /api/ai/extract-declaration` = 200 ; sinon formulaire direct |
| 1c Vérification : bandeau net lu = calculé (vert) / ≠ (orange), « à vérifier » < 0,75, Hors Yango, Net du jour 26 mono | ✅ | Champs rares (commissions lues, services, courses hors, commentaire) repliés sous un lien. Date modifiable (comme aujourd'hui). Saisie manuelle : bandeau bleu |
| 2a Rapport envoyé : pastille 72, net du jour, reste pour le palier | ✅ | |
| 1d Dépense : grille 3 col. 64 px, montant 76 px / 34 mono, litres si Carburant, photo du reçu, « Envoyer X XOF » / « Indique un montant » | ✅ | Icône sur toutes les tuiles ; kilométrage, date et note conservés (champs existants) |
| 2b Pilotage : il faut X / jour pendant N jours, moyenne, 4 tuiles, barres + objectif pointillé | ✅ | Tuile « Net validé » → « Net du mois » (le chiffre inclut les rapports en attente). Objectif = palier suivant (paliers) ou objectif du mois |
| 2c Calendrier lundi-first, couleurs Validé/Attente/Rejeté/Repos, détail du jour, « Déclarer un jour de repos » | ✅ | Navigation mois précédent. Corrections : cartes actuelles (resoumettre / archiver) |
| 2d Profil : documents KYC + Ajouter, thème, déconnexion | ✅ | **Rappel du soir** et **Mot de passe** masqués : aucune donnée / aucun parcours chauffeur existant. Infos personnelles et avances conservées |

### Garanties étape 1
- [x] Logique déplacée **telle quelle** vers `components/driver/*` (1229 lignes retirées de `app/driver/page.tsx`, 100 % retrouvées à l'identique) ; JSX de l'UI actuelle inchangé
- [x] Aucune écriture ajoutée (ui-guard vs `main` et vs étape 0)
- [x] Drapeau OFF : 0 px d'écart (pages accessibles sans session)

### Étape 2 — Coque gestionnaire (`Admin Sidebar.dc.html`, `Filter Bar.dc.html`)
| Élément maquette | Implémenté | Écart / justification |
|---|---|---|
| Sidebar 224 px, logo 32, 6 destinations + séparateur + Historique / Paramètres, actif `rgba(245,166,35,.12)` | ✅ | Identifiants d'onglets inchangés ; chaque destination affiche ses anciens onglets en sous-onglets (`lib/v2/adminNav.ts`, testé : aucun onglet perdu) |
| Badge compteur « À valider » orange | ✅ | Compte des rapports + dépenses `submitted` (lecture `count`) |
| Carte d'essai + « Renouveler » vert en bas de sidebar (remplace `TrialBanner`) | ✅ | Affichée à J-14 comme la bannière ; orange à J-3. Lien `/paiement` inchangé |
| Utilisateur en bas de sidebar | ✅ | + thème et déconnexion (existants) |
| Filtre « Vue : Tous / chauffeur » → menu déroulant dans l'en-tête | ✅ | FilterBar : un chauffeur (la multi-sélection actuelle reste dans l'UI OFF) |
| Période Jour / 7 j / Mois / Année | ⚠️ partiel | **Mois / Année** seulement : `useDashboardKPIs` raisonne en mois (`filterMonths`), Jour / 7 j demanderaient de toucher aux hooks |
| Pages `/admin/drivers`, `/admin/suivi`, `/admin/boitiers`, `/admin/pilotage` | ⏭ | Sous-onglets qui ouvrent ces pages (encore en UI actuelle) — refondues aux étapes 5–6 |
| Contenu des onglets | ⏭ | Inchangé à cette étape (déplacé tel quel dans `tabContent`), refondu aux étapes 3–6 |

### Étape 3 — Tableau de bord (`Admin.dc.html` 2a / 2b)
| Élément maquette | Implémenté | Écart / justification |
|---|---|---|
| Hero 3 cartes : Net final 34 mono vert + variation + marge, Total recettes (dont hors plateforme), Trésorerie nette | ✅ | Variation par jour ouvré, même règle que la `HeroCard` actuelle ; libellé « vs période précédente » (la période suit la FilterBar) |
| « À valider » (`ValidationQueue` extraite de `SimpleModeAdmin`) | ✅ | `components/ValidationQueue.tsx` : écritures déplacées telles quelles, utilisées par le mode simple ET le tableau de bord. Bouton Valider + « Tout voir » ; « Examiner » / rejet dans À valider (étape 4). État vide « Tout est validé » |
| Sous-titre « Lu sur captures · concorde » / « Écart km GPS » sur les lignes | ⏭ | Données d'extraction et GPS branchées à l'étape 4 (panneau de détail) |
| Briefing du jour | ✅ | `AiBriefingSection` inchangé |
| Coûts par poste : XOF, % du CA, % des coûts + mini-barre, ligne Total, `CAT_AVANCE` exclu | ✅ | `lib/v2/dashboard.ts` (testé) ; mêmes agrégats que la treemap (`expenseBreakdown`) |
| Net par jour (net final sur brut) | ✅ | `kpis.dailyRows` |
| Bascule Simple / Avancé (orange) | ✅ | Avancé = sections actuelles telles quelles. Préférence par appareil |

### Étape 4 — À valider (`Admin.dc.html` 2c)
| Élément maquette | Implémenté | Écart / justification |
|---|---|---|
| Liste 360 px, onglets Rapports / Dépenses avec compteurs, ligne sélectionnée liseré orange | ✅ | + tag NOUVEAU (< 1 h) |
| Panneau de détail à droite (plus de modale) : lignes du calcul, net total 20 mono vert | ✅ | Espèces / Carte si présents, sinon Brut (rapports anciens) |
| Badge « Lu sur N captures · confiance X % » | ✅ | Lecture `fleet.ai_extractions` du chauffeur à la date ; confiance = plus faible score. Sinon « Saisie manuelle » |
| Contrôles : net affiché = calculé ; km déclarés vs GPS (orange au-delà de 15 %) | ✅ | GPS : `v_telematics_reconciliation` (km du véhicule ce jour-là), km déclarés = compteur − dernier compteur validé. Écart affiché seulement si la journée est exploitable (même règle que la vue) |
| Commentaire du chauffeur, captures à droite | ✅ | Captures = pièces jointes du rapport (dont les scans rattachés à l'envoi) |
| Rejeter (contour rouge) / **Valider et suivant** | ✅ | Écritures des modales actuelles déplacées dans `useReportReview` / `useExpenseReview` (statut, `rejection_reason`, action_logs, notification). La sélection passe à l'élément suivant ; toast « Rapport validé — X est notifié » (2,6 s) |
| Modifier le rapport | ✅ | Repliable, mêmes champs et même recalcul (`recomputeReportNet`) que la modale |
| Filtre dates sur À valider | ⚠️ | Retiré : la liste montre toutes les soumissions en attente (comme aujourd'hui) ; seul le filtre chauffeur agit |

### Étape 5 — Équipe, Finance, Historique, Paramètres (`Admin.dc.html` 4a–4d)
| Élément maquette | Implémenté | Écart / justification |
|---|---|---|
| 4a Équipe : liste des chauffeurs (état KYC), fiche Profil / Documents / Rémunération / Activité, 4 KPI | ✅ | Documents = `KycAdminTab` actuel filtré sur le chauffeur. Rémunération → page `/admin/drivers` (réglage par chauffeur existant). Activité → Historique filtré. KPI : chauffeurs, actifs, dossiers validés, à vérifier (au lieu de KPI financiers par chauffeur, absents des hooks) |
| 6 vignettes KYC dans la fiche | ⚠️ | Rendu par `KycAdminTab` actuel (non restylé à cette étape) |
| 4b Finance : Encaissements, Décaissements (dépenses + avances), Masse salariale, Marge après salaires | ✅ | `lib/v2/team.ts` (testé) sur `useDashboardKPIs`. Onglets Paiements / Avances actuels dessous |
| Table des salaires, derniers mouvements, export CSV | ⏭ | Restent dans `PaymentsTab` / `AvancesTab` actuels (déplacés, non redessinés) |
| Journal dans Finance | ⚠️ | Laissé dans Paramètres (une seule entrée, pour ne pas dupliquer l'onglet) |
| 4c Historique : grille chauffeurs × jours colorée, détail du jour, bascule liste | ✅ | Détail = panneau de l'étape 4 (mêmes écritures que la modale). « Planning » = `CalendrierTab` actuel |
| 4d Paramètres : menu local | ✅ | Entreprise & marque · Rémunération · Import historique · Journal. **Notifications, Assistant IA, Abonnement** : pas d'écran existant → masqués |

### Étape 6 — Véhicules et GPS (`Admin.dc.html` 2e, 4e, 4f)
| Élément maquette | Implémenté | Écart / justification |
|---|---|---|
| Liste des véhicules avec état du signal (vert < 15 min, jaune < 60 min, gris sans boîtier) | ✅ | `lib/v2/fleet.ts` (testé) sur la lecture GET des boîtiers ; rouge au-delà de 60 min (même règle que la page Boîtiers). Gestion de flotte actuelle (`FleetTab`) dessous |
| Suivi GPS et Boîtiers comme sous-pages de Véhicules | ✅ | Les pages `/admin/suivi` et `/admin/boitiers` s'affichent dans la coque v2 (sidebar, destination Véhicules active) ; leur contenu est inchangé |
| Fiche véhicule (carte, 4 KPI GPS du jour, assurance, visite technique, boîtier) | ⏭ | Carte et KPI GPS : dans `/admin/suivi` actuel ; assurance / visite : dans `FleetTab` actuel. Non redessinés |
| 4e Suivi GPS restylé (En direct / Rejouer, frise 24 h) | ⏭ | Page actuelle conservée telle quelle (fond neutralisé dans la coque) |
| 4f Assistant d'installation en 4 étapes | ⏭ | Le parcours actuel suit déjà ces 4 étapes (Enrôler → RCONF → SMS → Signal, `plan.steps`) ; non redessiné |
