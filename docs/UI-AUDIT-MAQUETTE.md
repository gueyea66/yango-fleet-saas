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
| Bloc « À valider » avec bouton Valider par déclaration | ✅ | Même flux d'approbation que l'onglet Soumissions (update `daily_reports.status`) |
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
