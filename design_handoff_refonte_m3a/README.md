# Handoff : refonte UI M3A Fleet (vague 2/3)

> **Pour lancer l'implémentation autonome, commencer par `MISE-EN-PLACE.md`** : préparation, prompt Claude Code, garde-fou `scripts/ui-guard.sh`, migration `sql/ui-v2-flag.sql`, mise en production et retour arrière.

## Vue d'ensemble
Refonte de la présentation de `gueyea66/yango-fleet-saas` (Next.js 15 + Tailwind 4 + Supabase), qui couvre :
- **l'app chauffeur** (PWA, `app/driver/page.tsx`) ;
- **le gestionnaire** (`app/admin/**`) ;
- **le mode simple propriétaire** (`components/SimpleModeAdmin.tsx`) ;
- **les pages d'accès** (`app/auth/**`, `/register`, `/locked`, `/paiement`) ;
- **le superadmin** (`app/superadmin/**`).

Objectif : l'utilisateur voit d'abord ce qui demande une décision. La navigation est consolidée : 7 → 4 onglets côté chauffeur, 13 → 8 destinations côté gestionnaire. Le rapport du soir est construit autour de l'extraction vision existante.

**Règle absolue (reprise de `docs/AUDIT-REFONTE.md`) : 100 % présentation.** Ne pas modifier les routes API, les requêtes Supabase, la RLS, `lib/calc.ts`, `lib/reportNet.ts`, `useDashboardKPIs`, `usePilotage` ni le schéma. Les 143 tests existants doivent rester verts à chaque étape.

## À propos des fichiers de design
Les fichiers `.dc.html` de ce dossier sont des **références de design en HTML** : ils montrent l'apparence et le comportement attendus. **Ce n'est pas du code de production à copier.** La tâche est de **recréer ces designs dans le code existant**, avec ses conventions : composants React client, Tailwind, variables CSS `--sk-*` / `--fleet-*` / `--tenant-color` de `app/globals.css`, et `lucide-react` (déjà installé).

Pour les ouvrir, servir le dossier en local (`npx serve .`) puis ouvrir un `.dc.html` dans un navigateur. `support.js` et `android-frame.jsx` doivent rester à côté.

## Fidélité
**Haute fidélité.** Couleurs, typo, espacements, rayons et textes sont définitifs. Reproduire au pixel près, en passant par les tokens existants plutôt que des hex en dur. Les chiffres sont des données d'exemple : les brancher sur les hooks et API existants.

Les zones rayées (captures, carte, photos KYC) sont des emplacements d'image. Dans l'app, elles affichent les vraies images : `uploads`, `stored_files` de l'extraction, carte du suivi GPS existant.

---

## Plan d'implémentation
Le détail pas à pas est dans `MIGRATION.md` (tableau ancien → nouvel écran, 8 étapes, fichiers concernés). Résumé :

0. **Fondations** :
   - `body` en Geist (`var(--font-geist-sans)`, déjà chargée dans `app/layout.tsx`) ;
   - chiffres en `var(--font-geist-mono)` + `tabular-nums` ;
   - émojis → icônes Lucide ;
   - composants partagés dans `components/ui/` : `Card`, `Stat`, `Segmented`, `ListRow`, `StatusDot`, `BottomNav`, `FilterBar`, `Badge` (sortir `CalcBadge` / `AiBadge` de `AiBriefingSection`).
1. **Drapeau** `tenant_settings.ui_v2 boolean default false` (migration idempotente, modèle de la 037). Tout le nouveau rendu passe derrière ce drapeau ; l'ancienne UI reste le défaut.
2. App chauffeur → 3. Coque admin → 4. Tableau de bord + `ValidationQueue` partagée → 5. À valider en vue scindée → 6. Équipe / Finance / Historique / Paramètres → 7. Véhicules + GPS → 8. Pages publiques + superadmin.

Une PR par étape. Pour chacune : `tsc`, `npm test`, la checklist `docs/UI-AUDIT-MAQUETTE.md`, et une QA sur téléphone.

---

## Design tokens
Tous existent déjà dans `app/globals.css` (skin **Midnight**, défaut).

**Surfaces**
| Rôle | Token | Hex |
|---|---|---|
| Fond de page / app | `--sk-deep` | `#080a0f` |
| Carte, sidebar, en-têtes | `--sk-bg` | `#0d1117` |
| Bordures de carte, séparateurs, fond de segment actif | `--sk-surface` | `#1e2330` |
| Bordure de bouton secondaire, puce inactive | `--sk-border` | `#343b4f` |

**Texte**
| Rôle | Token | Hex |
|---|---|---|
| Principal | `--sk-t1` | `#f0f2f7` |
| Secondaire (libellés de lignes) | `--sk-t2` | `#8b92a8` |
| Sous-labels, unités (AA) | `--fleet-text-muted` | `#94a3b8` |
| Nav inactive (admin) | — | `#c3c8d6` |
| Suffixes discrets (XOF, km), chevrons | `--sk-t3` | `#555e75` |

**Accents**
| Rôle | Token | Hex |
|---|---|---|
| Action principale, sélection | `--tenant-color` | `#f5a623` (texte dessus : `#080a0f`) |
| Positif / net / onglet chauffeur actif | `--fleet-positive` | `#4ade80` |
| Bouton Valider | — | `#22c55e` (texte `#06210f`) |
| Négatif / charges | `--fleet-negative` | `#ef4444` (texte `#f87171`) |
| Attente / alerte | `--fleet-warning` | `#f97316` (texte `#fb923c`) |
| Progression palier | `--fleet-accent` | `#facc15` |
| Info / km / GPS | `--fleet-info` | `#38bdf8` |
| Net Yango | — | `#60a5fa` |
| Hors Yango | — | `#c084fc` |

**Teintes d'état** (fond / bordure)
- Succès : `rgba(74,222,128,.08)` / `rgba(74,222,128,.25)`
- Attente : `rgba(249,115,22,.08)` / `rgba(249,115,22,.3)`
- Sélection : `rgba(245,166,35,.08–.12)`, avec `box-shadow: inset 2px 0 0 #f5a623` sur les lignes de liste
- IA : `rgba(245,166,35,.14)` + texte `#fbbf24`
- Calculé : `rgba(59,130,246,.15)` + texte `#60a5fa`

**Typographie** : Geist 400/500/600/700, Geist Mono 400/500/600.
| Usage | Taille / graisse |
|---|---|
| Titre de page admin | 24 / 600, letter-spacing -.01em |
| Titre de liste ou de panneau | 20–22 / 600 |
| Titre d'écran mobile | 22–24 / 600 |
| En-tête mobile | 16 / 600 |
| KPI principal (mono) | 34 desktop, 40 mobile propriétaire ; 600 ; -.03em |
| KPI secondaire (mono) | 20–28 / 600 |
| Montant de ligne (mono) | 14–16 |
| Corps | 14–15 |
| Sous-label | 12–13, `#94a3b8` |
| Surtitre | 11 / 600, uppercase, letter-spacing .08em |
| Onglets du bas | 11 |

**Rayons** : 14 (cartes desktop) · 16–18 (cartes mobile) · 12–14 (champs, gros boutons) · 8–10 (boutons desktop, champs compacts) · 7 (segment interne) · 4–6 (badges).

**Espacements** : padding de page admin 24×28 · cartes desktop 14–18 × 18–20 · écran mobile 16 horizontal · gaps 8 / 10 / 12 / 16 / 18.

**Hauteurs** (cibles tactiles mobile ≥ 44 px)
- Mobile : bouton principal 56–58, bouton secondaire 48–56, ligne de liste 52–56, champ 48–52, puce de filtre 44, bottom nav 64 (icône 22, label 11, indicateur actif 2 px en bas sur 40 % de la largeur).
- Desktop : boutons 32–42, segments 34.

**Ombres** : aucune sur les cartes. Toast : `0 10px 30px rgba(0,0,0,.4)`.

**États interactifs**
- Bouton principal au survol : `filter: brightness(1.1)`.
- Bouton contour au survol : bordure `#8b92a8`.
- Tous les boutons : `white-space: nowrap`, `flex: none`, transition .15s.
- Focus clavier : anneau 2 px `--tenant-color` (convention actuelle).

---

## Écrans

### Chauffeur (`Driver.dc.html`, cadre Android 412×892, contenu 396×812)
Structure commune : en-tête `#0d1117` + contenu `#080a0f` + **bottom nav 4 onglets** (Accueil · Rapport · Dépense · Pilotage). Le type `Tab` garde ses 7 valeurs. `repos` et `history` s'ouvrent depuis l'Accueil ; `profil` depuis l'avatar de l'en-tête.

- **1a Accueil** :
  - salutation (date 13 `#94a3b8`, « Bonsoir Moussa » 24/600) ;
  - carte d'état du rapport : pastille orange, bouton principal 58 px « Faire mon rapport » avec icône `ScanLine`, aide « 2 captures Yango Pro + photo du compteur suffisent » ;
  - **carte palier en 4 niveaux** : « IL VOUS MANQUE » (11 uppercase), montant (28 mono `#facc15`), « pour atteindre Palier 1 », « salaire : 230 000 XOF/mois », barre 6 px ;
  - liste : Ajouter une dépense · Repos · Historique (lignes 56 px + chevron).
- **1b Rapport, étape 1 — captures** :
  - trois tuiles d'ajout : Vue « Comparatif », Vue « Argent », Photo du compteur ; pointillés tant que vide, coche verte une fois ajoutée ;
  - bouton « Lire mes captures », actif dès 1 image ;
  - lien « Saisir à la main » ;
  - le bloc n'est monté que si `GET /api/ai/extract-declaration` renvoie 200 ; en 204, on arrive directement sur le formulaire manuel actuel.
- **1c Rapport, étape 2 — vérification** :
  - bandeau vert si `net_affiche` = net Yango calculé par `calc.ts`, orange sinon (« Net lu sur Yango X ≠ calculé Y. Vérifie la carte. ») ;
  - liste des champs lus (Espèces, Carte, Bonus, Commandes, Solde portefeuille, Compteur) ;
  - si `confidences[champ] < 0.75` : fond de ligne `rgba(249,115,22,.07)`, badge « à vérifier » et champ éditable bordé `#f97316` ;
  - champ « Hors Yango aujourd'hui » ;
  - Net du jour (26 mono `#4ade80`) ;
  - bouton « Envoyer le rapport » : même insert qu'aujourd'hui, avec `stored_files` rattachés.
- **2a Rapport envoyé** : pastille check 72 px, texte, récap net du jour et reste pour le palier, boutons « Ajouter une dépense » et « Retour à l'accueil ».
- **1d Dépense** :
  - grille 3 colonnes de tuiles 64 px pour `EXPENSE_CATEGORIES` ; `CAT_AVANCE` masqué sauf `account_type === "technical"` ;
  - montant en grand champ 76 px (34 mono) ;
  - Litres seulement si Carburant ;
  - photo du reçu (recommandée) ;
  - bouton « Envoyer 8 000 XOF » (le montant est dans le libellé).
- **2b Pilotage** : « il faut X XOF / jour pendant N jours restants » (montant restant ÷ jours restants), moyenne actuelle, 4 tuiles (Net validé, Salaire projeté, Courses/jour, Km/jour), barres du net par jour avec ligne d'objectif en pointillé.
- **2c Historique & repos** : calendrier du mois, semaine commençant le lundi ; cases colorées Validé / En attente / Rejeté / Repos ; détail du jour sélectionné ; bouton « Déclarer un jour de repos ».
- **2d Profil** : documents KYC (état de chaque pièce + Ajouter), rappel du soir, thème (`ThemeToggle`), mot de passe, déconnexion.

### Gestionnaire (`Admin.dc.html`, artboards 1280×820)
- **Sidebar** 224 px (`Admin Sidebar.dc.html`) :
  - logo 32 ;
  - 6 entrées principales (Tableau de bord, À valider avec badge compteur orange, Pilotage, Véhicules, Équipe, Finance) ;
  - séparateur, puis Historique et Paramètres ;
  - en bas : carte d'essai (texte + bouton « Renouveler » vert) et utilisateur ;
  - entrée active : fond `rgba(245,166,35,.12)`, texte `#f5a623`.
- **FilterBar** (`Filter Bar.dc.html`) : segment de période (Jour / 7 j / Mois / Année), sélecteur de dates, sélecteur de chauffeur (bordure orange quand filtré). Branchée sur `filterDriverId` et la période de `useDashboardKPIs`. Où la mettre :
  - **période + chauffeur** : Tableau de bord, Pilotage, Finance, Historique ;
  - **dates + chauffeur** : À valider, Véhicules ;
  - **période seule** : Équipe, Suivi GPS (Jour / 7 j), Superadmin.
- **2a Tableau de bord, vue simple** :
  - hero de 3 cartes : Net final (34 mono vert + variation vs mois précédent + marge), Total recettes, Trésorerie nette ;
  - grille 2 colonnes : « À valider » (`ValidationQueue`, extraite de `SimpleModeAdmin`) et « Briefing du jour » (`AiBriefingSection` inchangé, badges IA / Calculé, carte Action du jour) ;
  - **Coûts par poste** : pour chaque catégorie, montant, **% du CA** (montant ÷ total recettes) et **% des coûts** (montant ÷ total dépenses, avec mini-barre), plus une ligne Total ; `CAT_AVANCE` exclu ;
  - barres du net par jour.
- **2b Vue avancée** : hero compact, puis les `AccordionSection` existantes (Période ouverte avec les 6 KPI et la barre des dépenses ; Résultat opérationnel, Trésorerie, Aujourd'hui et Récap journalier repliés).
- **2c À valider** :
  - liste 360 px (onglets Rapports / Dépenses ; ligne sélectionnée avec liseré orange) ;
  - panneau de détail : lignes du calcul, contrôles (net affiché = calculé, km déclarés vs GPS), commentaire, captures à droite ;
  - boutons Rejeter (contour rouge) et **Valider et suivant** ;
  - même écriture qu'aujourd'hui : statut + `action_logs` + push.
- **2d Pilotage** : sous-onglets Vue d'ensemble / P&L / Cash flow / Simulation ; 3 KPI (Km parcourus, Coût/km, Net/km) ; table par chauffeur (Jours, Net validé, En attente, Net/km, Écart GPS en orange au-delà de 15 %) ; km par jour.
- **2e Véhicules** : liste avec état du signal (vert < 15 min, jaune < 60 min, gris sans boîtier). Fiche : carte, 4 KPI GPS du jour, assurance, visite technique, boîtier.
- **4e Suivi GPS** : En direct / Rejouer, carte, 4 KPI (Km GPS, Amplitude, En mouvement, Couverture), événements (départ, arrêt long, GPS hors ligne en jaune), frise 24 h des trajets.
- **4f Installer un boîtier** : assistant en 4 étapes (Enrôler → RCONF → SMS → Signal). Les SMS viennent de `plan.steps`, avec bouton Copier et bloc de retour arrière.
- **4a Équipe** : liste des chauffeurs (état KYC) ; fiche avec onglets Profil / Documents / Rémunération / Activité ; 6 vignettes KYC ; 4 KPI.
- **4b Finance** :
  - sous-onglets Paiements / Avances / Journal, export CSV ;
  - 4 KPI :
    - Encaissements ;
    - Décaissements, soit dépenses + avances (`CAT_AVANCE`, qui ne compte qu'en trésorerie) ;
    - Masse salariale ;
    - Marge après salaires ;
  - table des salaires (palier, dû, avances, reste, « Marquer payé ») ;
  - derniers mouvements.
- **4c Historique** : bascule Calendrier / Liste ; grille chauffeurs × jours colorée par statut ; détail du jour.
- **4d Paramètres** : menu local (Entreprise & marque, Rémunération, Import historique, Notifications, Assistant IA, Abonnement, Journal). La rémunération montre les 5 modèles en cartes, la grille des paliers et les commissions.

### Propriétaire, accès, superadmin (`Owner and Platform.dc.html`)
- **3a Mode simple (mobile)** :
  - puces chauffeur 44 px ;
  - « Ce mois, il vous reste » (40 mono vert) avec une phrase de contexte et une barre net / coûts ;
  - À valider (2 lignes + « + N autres ») ;
  - tableau Coûts (XOF, % CA, % coûts, Total) ;
  - lien « Passer en mode avancé » ;
  - nav 3 onglets en orange.
- **3b Connexion** : structure de `app/auth/login/page.tsx` conservée (bascule Gestionnaire / Chauffeur, ID en mono), épurée : sans dégradé ni halo.
- **5a Inscription**, **5c Mot de passe oublié / réinitialisation** : même coque.
- **5b Accès suspendu = paiement** : fusion de `/locked` et `/paiement` ; 3 formules (`lib/plans.ts`), numéros Wave et Orange Money (`/api/public/payment-settings`), bouton « J'ai payé — envoyer la référence ».
- **3c Superadmin** : 4 KPI (MRR/ARR, Clients payants, Conversion, Rapports), bandeau « À relancer » (J-1 rouge, J-3 orange, J-6 ambre), table des clients.

---

## Interactions et comportement
La référence est **`Prototype.dc.html`** : téléphone et gestionnaire côte à côte, reliés.

**Côté chauffeur**
1. Accueil → « Faire mon rapport ».
2. Ajout des captures → « Lire mes captures ».
3. Lecture : spinner de 1,4 s dans le prototype ; dans l'app, c'est le vrai appel POST.
4. Vérification : modifier la Carte recalcule les commissions (15 % + 0,75 %) et le net en direct, et fait basculer le bandeau vert / orange.
5. « Envoyer » → écran de confirmation. Le rapport apparaît en tête de la file du gestionnaire avec le tag NOUVEAU, puis un toast s'affiche.
6. « Saisir à la main » : même écran de vérification, bandeau bleu « Saisie manuelle ».

**Côté gestionnaire**
- **Valider et suivant** : retire l'élément, ajoute son net au « Net final validé » (et affiche « + X à l'instant »), sélectionne l'élément suivant, puis affiche un toast « Rapport validé — Moussa est notifié ».
- **Rejeter** : retire l'élément ; côté chauffeur, l'Accueil affiche « Rapport rejeté — corrige et renvoie ».
- Les puces chauffeur filtrent la file et les KPI.
- La période 7 j / Mois change les KPI.
- File vide : état « Tout est validé ».

**Dépense** : choix de la catégorie, montant ; le bouton reste inactif (« Indique un montant ») tant que le montant vaut 0.

**Divers**
- Toasts : 2,6 s, centrés en bas.
- Mettre en cache l'état de la file (localStorage ou SWR) pour les connexions 2G/3G.
- Prévoir des skeletons plutôt que des spinners sur les listes.

## Gestion d'état
Pas de nouvelle source de données. Ce qu'il faut ajouter en UI :
- `step` du rapport (`capture | reading | review | sent`) ;
- l'extraction courante (`fields`, `confidences`, `coherence_alerts`, `stored_files`) ;
- l'id sélectionné dans la file et le mode Simple / Avancé (préférence par appareil, comme le thème) ;
- période et chauffeur de la FilterBar, en paramètres d'URL (`?p=mois&d=<id>`) pour garder les liens partageables.

## Assets
- Icônes : **lucide-react** (déjà en dépendance). Noms utilisés :

  `House, ClipboardList, Receipt, Gauge, ScanLine, Camera, Paperclip, Bell, UserRound, ChevronRight, ChevronDown, ArrowLeft, ArrowRight, Check, CircleCheck, TriangleAlert, Info, Fuel, BedDouble, History, LayoutDashboard, Inbox, Car, Users, Wallet, Settings, Calendar, List, Plus, X, Upload, Download, MessageSquare, Sparkles, Calculator, RefreshCw, Lock, Eye, LogOut, SlidersHorizontal, Building2, TrendingUp`.
- Logo : `BrandLogo` de `components/brand/BrandShell.tsx` (carré `--tenant-color` + initiales, ou `logo_url`).
- `docs/demo/` contient 2 captures de l'UI actuelle (affichées dans les maquettes « Avant »).

## Fichiers
| Fichier | Contenu |
|---|---|
| `Driver.dc.html` | Chauffeur, 8 écrans |
| `Admin.dc.html` | Gestionnaire, 11 écrans |
| `Admin Sidebar.dc.html`, `Filter Bar.dc.html` | Sous-composants partagés |
| `Owner and Platform.dc.html` | Mode simple, connexion, inscription, mot de passe, accès suspendu, superadmin |
| `Prototype.dc.html` | Parcours cliquable de bout en bout |
| `MIGRATION.md` | Correspondance des écrans et plan en 8 étapes |
| `support.js`, `android-frame.jsx` | Nécessaires pour ouvrir les maquettes, à ne pas porter |
