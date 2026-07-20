# UI Audit — Refonte structurelle (vagues 2 & 3)

Suite de l'audit UI M3A Fleet. Les quick wins (vague 1) sont déjà en prod (#12, #13).

## ✅ Appliqué dans ce PR (vérifié : tsc + 61 tests + build OK)

### Dashboard admin — hero bar + accordéons  · `app/admin/page.tsx`
- **Hero bar** en tête : 3 KPIs décisionnels toujours visibles — **Net Final · Total Recettes · Trésorerie Nette** (composant `HeroCard`). C'est la lecture « en 5 secondes ».
- Les 3 sections financières (**Période**, **Résultat opérationnel**, **Trésorerie**) sont désormais des **accordéons repliables** (`AccordionSection`). Seule « Période » est ouverte par défaut ; le reste est replié → dashboard allégé, **rien supprimé** (réversible d'un clic).
- Rappel : le masquage des postes à zéro (#13) est toujours actif dans « Résultat opérationnel ».

### Design tokens · `app/globals.css`
- Palette + échelle typo verrouillées par l'audit, déclarées en `var(--fleet-*)`. **Fondation seule** : aucun rendu changé, migration des hex inline à faire progressivement.

> ⚠️ **À valider de visu** : ouverture/fermeture des accordéons, alignement de la hero bar, cohérence sur mobile. Le code compile et ne touche AUCUNE donnée (affichage pur), mais je ne peux pas voir le rendu.

## 📋 À faire AVEC QA visuelle (pas appliqué à l'aveugle)

### Vue chauffeur — sidebar → bottom navigation 4 onglets · `app/driver/page.tsx`, `components/DriverHome.tsx`
**Pourquoi pas fait ici :** c'est le flux CRITIQUE que les chauffeurs utilisent chaque soir (soumission rapport + dépense). Restructurer sa mise en page sans voir le rendu = risque opérationnel réel. À faire ensemble, écran sous les yeux.
**Spec (maquette = référence) :**
1. Remplacer la sidebar 6 entrées par une **bottom nav sticky 4 onglets** : Accueil · Rapport · Dépense · Pilotage (hauteur 56-64px, onglet actif `--fleet-positive`, indicateur 2px en bas).
2. Carte Palier en hiérarchie 4 niveaux : « IL VOUS MANQUE » (label 11px) / montant (28px, `--fleet-accent`) / « pour atteindre Palier 1 » / « salaire : X XOF/mois » — supprime la soustraction mentale.
3. Repos & Historique deviennent des sous-pages accessibles depuis Accueil.

### Finition premium (vague 3)
- Émojis fonctionnels → icônes vectorielles monochromes (Lucide) — surtout la nav admin (`app/admin/page.tsx` `tabGroups`, les emojis 🚗📈💰…). Swap cosmétique large, à faire écran par écran.
- Empty states designés (Soumissions vide), skeleton loaders (contexte 2G/3G).
- Sous-labels `#555e75` → `var(--fleet-text-muted)` (#94A3B8, contraste WCAG AA).

---
_Données : cette refonte est 100 % présentation (JSX/CSS). Aucune route API, requête Supabase, mutation ou schéma n'est touché — perte de données impossible._
