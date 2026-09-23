# Passer de l'UI actuelle à la refonte

Maquettes : `Driver.dc.html`, `Admin.dc.html`, `Owner and Platform.dc.html`.
Règle reprise de vos audits : **100 % présentation**. Aucune route API, requête Supabase, calcul (`lib/calc.ts`) ou schéma ne change. On déplace et on re-stylise des composants qui existent déjà.

---

## 1. Consolidation des écrans

### Chauffeur (7 onglets → 4 + sous-pages)
| Aujourd'hui (`app/driver/page.tsx`) | Refonte |
|---|---|
| Accueil `home` | Accueil (onglet) — maquette 1a |
| Rapport `report` | Rapport (onglet) — captures d'abord 1b → vérification 1c → envoyé 2a |
| Dépense `expense` | Dépense (onglet) — 1d |
| Pilotage `pilotage` | Pilotage (onglet) — 2b |
| Historique `history` + Repos `repos` | **Un** calendrier, ouvert depuis l'Accueil — 2c |
| Profil & KYC `profil` | Avatar de l'en-tête — 2d |

### Gestionnaire (13 onglets → 6 + 2)
| Aujourd'hui (`app/admin/page.tsx`, `tabGroups`) | Refonte |
|---|---|
| Dashboard | Tableau de bord — 2a (simple) / 2b (avancé) |
| Soumissions | À valider — 2c |
| Pilotage (`app/admin/pilotage`) | Pilotage — 2d |
| Véhicules + Boîtiers + Suivi | Véhicules — 2e, 4e, 4f |
| Conducteurs + KYC + Rémunération par chauffeur | Équipe — 4a |
| Paiements + Avances | Finance — 4b |
| Historique + Calendrier | Historique — 4c |
| Paramètres + Rémunération globale + Import historique + Journal | Paramètres — 4d |

### Public / plateforme
`/register` → 5a · `/locked` + `/paiement` → 5b (un seul écran) · `/auth/forgot` + `/auth/reset` → 5c · `/auth/login` → 3b · mode simple → 3a · `/superadmin` → 3c

---

## 2. Déploiement sans risque

- **Drapeau par tenant**, sur le modèle de `ui_mode` (migration 037) : `tenant_settings.ui_v2 boolean default false`. L'ancienne UI reste le défaut. On l'active d'abord pour la flotte M3A, puis client par client.
- **Les identifiants d'onglets ne changent pas** (`pending`, `history`, `calendrier`…). Les nouvelles destinations regroupent les onglets existants en sous-onglets, donc l'état, les liens et les tests restent valables.
- Pour chaque écran livré : checklist `docs/UI-AUDIT-MAQUETTE.md` + `npm test` + QA sur un vrai téléphone en 3G.

---

## 3. Étapes, dans l'ordre

### Étape 0 — Fondations (≈ 1–2 j)
1. **Typo** : `app/layout.tsx` charge déjà Geist, mais `globals.css` force `Arial` sur `body`. Remplacer par `font-family: var(--font-geist-sans)`. Chiffres : `var(--font-geist-mono)` + `font-variant-numeric: tabular-nums`.
2. **Couleurs** : les tokens `--sk-*` (skin Midnight) et `--fleet-*` existent déjà. Les maquettes les utilisent tels quels. Seul changement : sous-labels `#555e75` → `--fleet-text-muted` (#94a3b8), prévu dans AUDIT-REFONTE.
3. **Icônes** : `lucide-react` est déjà installé. Remplacer les émojis de `tabGroups` (admin) et `navItems` (chauffeur).
4. **Petits composants partagés** dans `components/ui/` : `Card`, `Stat`, `Segmented`, `ListRow`, `StatusDot`, `BottomNav`, et **`FilterBar`** (période Jour / 7 j / Mois / Année + plage de dates + chauffeur). Il est branché sur les états déjà présents (`filterDriverId`, période de `useDashboardKPIs`) et posé en tête de chaque page : Tableau de bord, À valider, Pilotage, Véhicules, Suivi GPS, Équipe, Finance, Historique, Superadmin. En mode simple mobile, le filtre chauffeur devient une rangée de puces. Sortir `CalcBadge` / `AiBadge` de `components/ai/AiBriefingSection.tsx` pour les réutiliser.

### Étape 1 — App chauffeur (le plus de valeur ; à faire écran sous les yeux)
1. `navItems` : 7 → 4. Le type `Tab` garde ses 7 valeurs ; `repos`, `history` et `profil` sont ouverts depuis l'Accueil ou l'en-tête.
2. `HomeTab` : un seul bouton principal + la carte palier en 4 niveaux (déjà spécifiée).
3. `ReportTab` : si `GET /api/ai/extract-declaration` renvoie 200, l'**étape 1 est le bloc de scan** (déjà codé autour de la ligne 473). Écran de vérification :
   - `confidences[champ] < 0.75` → badge « à vérifier » sur la ligne ;
   - `net_affiche` comparé au net de `calc.ts` → bandeau vert, ou orange en cas d'écart ;
   - `coherence_alerts` affichées au-dessus de la liste ;
   - si la couche IA est coupée (204), on arrive directement sur le formulaire manuel actuel.
   L'envoi reste **identique** (insert `daily_reports` + uploads + `stored_files`).
4. `ExpenseTab` : `EXPENSE_CATEGORIES` en grille de puces ; `CAT_AVANCE` masqué sauf pour `account_type === "technical"` (logique déjà présente). Champ litres seulement si « Carburant ».
5. `HistoryTab` + `ReposTab` → un composant calendrier, mêmes requêtes.
6. Nouvel écran de confirmation après envoi (aucune donnée nouvelle).

### Étape 2 — Coque admin
1. `tabGroups` : 13 entrées → 8 destinations (tableau ci-dessus). Chaque destination affiche ses anciens onglets en sous-onglets.
2. `TrialBanner.tsx` → petite carte en bas de la sidebar.
3. Le filtre « Vue : Tous / chauffeur » (`filterDriverId`) devient un menu déroulant dans l'en-tête.

### Étape 3 — Tableau de bord
1. La `HeroCard` existe déjà : 3 chiffres en tête.
2. **File « À valider »** : `components/SimpleModeAdmin.tsx` contient déjà Valider/Rejeter (statut + `action_logs` + push). L'extraire en `components/ValidationQueue.tsx` et l'utiliser dans le mode simple **et** le dashboard. Aucun doublon de logique.
3. Bascule Simple / Avancé : « Avancé » = les `AccordionSection` actuelles (repliées par défaut).
4. `AiBriefingSection` : inchangé, affiché à côté de la file.
5. **Coûts par poste** (vue simple, et mode simple mobile) : pour chaque catégorie de dépense, montant, **% du CA** (montant ÷ total recettes) et **% des coûts** (montant ÷ total dépenses), plus une ligne Total. Les données viennent de `useDashboardKPIs` (mêmes agrégats que la treemap `TreemapDepenses`), `CAT_AVANCE` exclu comme partout.

### Étape 4 — À valider
La modale de détail devient un panneau à droite de la liste. Même contenu, plus : captures du chauffeur, confiance de l'extraction, écart km GPS (`v_telematics_reconciliation`), bouton « Valider et suivant ».

### Étape 5 — Équipe, Finance, Historique, Paramètres
Surtout du déplacement : `KycAdminTab`, la rémunération par chauffeur (`app/admin/drivers`), `PaymentsTab`, `AvancesTab`, `CalendrierTab`, `ActionLogsTab`, `RemunerationSettingsTab`, `ImportHistoriqueModal` passent dans leurs nouvelles destinations.

### Étape 6 — Véhicules et GPS
Fiche véhicule = `FleetTab` + l'état du boîtier. `app/admin/suivi` et `app/admin/boitiers` deviennent des sous-pages. L'installation passe en assistant 4 étapes (`plan.steps` fournit déjà les SMS).

### Étape 7 — Pages publiques et superadmin
Même coque pour connexion, inscription, mot de passe et accès suspendu. `/locked` affiche directement les formules et les numéros Wave / Orange Money (`/api/public/payment-settings`). Superadmin : réordonner `Dashboard.tsx` (4 chiffres, clients à relancer, puis la table).

---

## 4. Ce qui ne bouge pas
Routes API, RLS, `lib/calc.ts`, `lib/reportNet.ts`, `useDashboardKPIs`, `usePilotage`, les notifications et la couche IA (extraction, briefing). Les 143 tests doivent rester verts à chaque étape.
