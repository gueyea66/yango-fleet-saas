# UI Audit — Quick wins semaine 1

Issu de l'audit UI M3A Fleet (session Pantheon, capture connectée sur le tenant
`demo-audit-98785`). Ce PR applique les correctifs **sûrs et vérifiables sans QA
visuelle**. Les deux restants demandent un coup d'œil sur le rendu réel — ils sont
spécifiés ci-dessous avec les emplacements exacts, prêts à appliquer.

## ✅ Appliqués dans ce PR

### 1. Bandeau d'expiration réduit + réductible — `components/TrialBanner.tsx`
- Hauteur ~52px → ~36px (padding `12px 18px` → `7px 14px`), police 13/12 → 12.5/11.5, `marginBottom` 20 → 12, icône 18 → 14.
- Bouton `×` de fermeture (session) **sauf à ≤ 3 jours** : là le bandeau reste toujours visible pour ne pas rater le renouvellement (règle de l'audit).

### 2. Écran-relais « Conducteurs » supprimé — `app/admin/page.tsx`
- Le clic sur « Conducteurs » (nav desktop + mobile) route désormais **directement** vers `/admin/drivers` (la vraie liste) au lieu d'afficher la page-relais « Cliquez sur le bouton ci-dessus… » (ex-lignes 873-882, désormais hors flux).

## 📋 À appliquer avec QA visuelle (spec exacte)

### 3. Masquer les cartes à zéro du dashboard
**Fichier :** `app/admin/page.tsx` — composant `KPICard` (~ligne 48) et les cartes lignes 431-471.
**Pourquoi pas fait ici :** le masquage sélectif fait reflow la grille (trous possibles) — à valider de visu.
**Marche à suivre :**
1. Ajouter à `KPICard` une prop `hideWhenZero?: boolean`, et un contexte/prop `showAllZeros: boolean`. Si `hideWhenZero && Math.round(value) === 0 && !showAllZeros` → `return null`.
2. Ajouter un state `const [showAllZeros, setShowAllZeros] = useState(false)` et, sous chaque grille, un lien `Afficher tout (N à zéro)` qui bascule le state (compter les cartes masquées).
3. Marquer `hideWhenZero` sur : **Solde consommé** (l.451), **Carburant consommé** (l.452), **Autres dépenses** (l.453), **Salaires** (l.454).
4. **NE PAS** masquer Trésorerie / Encaissements (l.468) même à zéro — un zéro de trésorerie est une info critique (règle de l'audit).

### 4. Doublon « XOF XOF » (E5 Pilotage chauffeur)
**Statut : NON CONFIRMÉ dans le code.** Le rendu de devise est unique partout vérifié :
`components/DriverHome.tsx:81,94` et `app/admin/pilotage/page.tsx` (cartes `value={xof(x)}` + `unit="XOF"` rendu une seule fois, l.340).
**Marche à suivre :** ouvrir l'onglet Pilotage chauffeur en réel. Si un « XOF XOF » apparaît, chercher un endroit où `value` contient déjà `XOF` ET où « XOF » est ré-ajouté à côté (`grep -n "XOF" <fichier de l'écran>`). Sinon, c'est une mauvaise lecture de la capture par l'audit — rien à corriger.

---
_Tests : `npx jest` (61 passés) + `npx tsc --noEmit` (clean) sur ce PR._
