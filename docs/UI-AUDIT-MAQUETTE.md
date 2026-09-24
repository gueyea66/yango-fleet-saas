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
