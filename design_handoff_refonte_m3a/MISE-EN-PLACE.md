# Script de mise en place autonome — refonte UI v2

Ce fichier contient tout ce qu'il faut pour que **Claude Code** implémente la refonte seul, sans casser l'app et sans toucher aux données.

---

## A. Préparation (toi, une seule fois, ~10 min)

```bash
# 1. Sauvegarde de la base (filet de sécurité, même si rien n'écrit dans les données)
#    Supabase → Project → Database → Backups → « Create backup »
#    ou : supabase db dump -f backup-avant-ui-v2.sql

# 2. Copier le dossier de passation dans le dépôt
cd yango-fleet-saas
git checkout main && git pull
cp -r ~/Downloads/design_handoff_refonte_m3a ./design_handoff_refonte_m3a
cp design_handoff_refonte_m3a/scripts/ui-guard.sh scripts/ui-guard.sh
chmod +x scripts/ui-guard.sh

# 3. Protéger main sur GitHub : Settings → Branches → Add rule « main »
#    ☑ Require a pull request before merging   ☑ Require status checks (CI)

# 4. Lancer Claude Code à la racine du dépôt
claude
```

Puis colle **le prompt B** ci-dessous.

---

## B. Prompt à coller dans Claude Code

````text
Tu implémentes la refonte UI v2 de M3A Fleet, en autonomie, étape par étape.

RÉFÉRENCES (lis-les entièrement avant de coder) :
- design_handoff_refonte_m3a/README.md  → spécifications (tokens, écrans, interactions)
- design_handoff_refonte_m3a/MIGRATION.md → correspondance des écrans et les 8 étapes
- design_handoff_refonte_m3a/*.dc.html → maquettes HTML de référence (à RECRÉER en React/Tailwind, pas à copier)
- design_handoff_refonte_m3a/Prototype.dc.html → comportement attendu (parcours rapport → validation)
- docs/AUDIT-REFONTE.md, docs/UI-AUDIT-MAQUETTE.md → règles existantes du projet

RÈGLES NON NÉGOCIABLES (zéro perte de données, zéro régression) :
1. 100 % présentation. Interdit de modifier : app/api/**, lib/calc.ts, lib/calcReel.ts, lib/reportNet.ts,
   lib/hooks/**, lib/services/**, lib/supabase/**, lib/ai/**, lib/telematics/**, lib/remuneration/**,
   lib/plans.ts, lib/auth/**, middleware.ts, next.config.ts, les .sql existants, migrations/ existantes, __tests__/ existants.
2. Une seule migration autorisée : copier design_handoff_refonte_m3a/sql/ui-v2-flag.sql vers
   migrations/<prochain numéro libre>-ui-v2-flag.sql. Aucune autre instruction SQL. Ne JAMAIS l'exécuter toi-même.
3. Aucune écriture Supabase nouvelle. Les écritures existantes (validation, rejet, insert rapport/dépense,
   uploads, action_logs, notifications) peuvent être DÉPLACÉES dans un composant, jamais réécrites ni ajoutées.
   Même payload, même ordre, même gestion d'erreur.
4. Tout le nouveau rendu passe derrière le drapeau :
   const uiV2 = settings.ui_v2 === true || (typeof window !== "undefined" && localStorage.getItem("m3a-ui") === "v2");
   Si uiV2 est faux → l'UI actuelle s'affiche À L'IDENTIQUE (aucun changement visible).
   Ajouter `ui_v2?: boolean | null` à TenantSettings (lib/tenant/types.ts) ; vérifier que lib/tenant/loader.ts
   récupère bien la colonne (si c'est un select explicite, ajouter ui_v2 à la liste — c'est le SEUL changement permis là).
5. Nouveaux composants dans components/v2/** et components/ui/**. Ne pas éditer les composants actuels
   sauf pour : (a) brancher le drapeau `if (uiV2) return <XxxV2 …/>` en tête de rendu, (b) extraire une logique
   d'écriture existante vers un composant partagé en la déplaçant telle quelle.
6. Couleurs et typo via les tokens de app/globals.css (--sk-*, --fleet-*, --tenant-color). Icônes : lucide-react.
   Pas de nouvelle dépendance npm.
7. Ne jamais merger, ne jamais pousser sur main, ne jamais forcer (--force), ne jamais supprimer de branche distante.

BOUCLE POUR CHAQUE ÉTAPE (0 → 7 de MIGRATION.md) :
  a. git checkout main && git pull && git checkout -b ui-v2/etape-<N>-<nom>
     (étape > 0 : partir de la branche de l'étape précédente si elle n'est pas encore mergée)
  b. Implémenter l'étape, fidèle aux maquettes (mesures, couleurs, textes du README).
  c. Ajouter des tests jest pour la logique pure nouvelle (ex. % du CA / % des coûts, jours restants, mapping
     d'onglets) dans __tests__/v2/*.test.ts. Ne modifie aucun test existant.
  d. Vérifications — TOUTES doivent passer, sinon corrige et recommence (max 3 tentatives, puis arrête-toi et explique) :
       npx tsc --noEmit
       npm run lint
       npm run test:ci
       npm run build
       bash scripts/ui-guard.sh origin/main
  e. Vérifier que l'UI actuelle est intacte avec le drapeau OFF : lancer `npm run dev`, ouvrir /admin et /driver
     avec Playwright (déjà en devDependency), capturer, comparer aux captures prises AVANT l'étape
     (garde-les dans .ui-v2-baseline/, ignoré par git). Écart visible drapeau OFF = échec.
  f. Capturer les nouveaux écrans drapeau ON (localStorage m3a-ui=v2) dans .ui-v2-shots/etape-<N>/.
  g. Commit(s) clairs, git push -u origin <branche>, ouvrir une PR vers main :
       titre  : « UI v2 — étape N : <nom> »
       corps  : ce qui change, fichiers touchés, résultat des 5 vérifications, captures, checklist
                docs/UI-AUDIT-MAQUETTE.md remplie pour les écrans de l'étape, « Drapeau OFF : aucun changement ».
  h. Passer à l'étape suivante.

À LA FIN : un résumé avec la liste des PR dans l'ordre de merge, et ce qui reste à vérifier à la main
(QA téléphone en 3G, extraction vision avec de vraies captures).

Si une règle t'empêche de faire quelque chose que la maquette demande (ex. donnée absente des hooks),
NE CONTOURNE PAS : affiche « — » ou masque l'élément, et note-le dans la PR sous « Écarts ».
Commence par l'étape 0.
````

---

## C. Mise en production (toi, après chaque PR)

1. **Relire la PR** : captures, checklist, les 5 vérifications vertes, « Écarts ».
2. **Merger** dans l'ordre (étape 0, puis 1, …). Vercel déploie ; drapeau OFF partout → personne ne voit de changement.
3. **Migration** (une seule fois, après le merge de l'étape 0) :
   Supabase → SQL Editor → coller `migrations/<n°>-ui-v2-flag.sql` → Run.
   Additive et idempotente : relancer ne fait rien, aucune ligne existante modifiée.
4. **Tester sur ton téléphone sans rien activer pour les clients** : ouvrir l'app, console → `localStorage.setItem("m3a-ui","v2")`, recharger. `removeItem("m3a-ui")` pour revenir.
5. **Activer pour M3A seulement** :
   `UPDATE fleet.tenant_settings SET ui_v2 = true WHERE tenant_id = '<id M3A>';`
6. Après quelques jours sans souci, activer client par client.

## D. Retour arrière (en cas de problème)

| Niveau | Action | Effet |
|---|---|---|
| 1 — immédiat | `UPDATE fleet.tenant_settings SET ui_v2 = false WHERE tenant_id = '<id>';` | UI actuelle revient au prochain chargement |
| 2 — code | GitHub → PR fautive → « Revert » → merger | Déploiement de la version précédente |
| 3 — données | Restaurer le backup de l'étape A | Jamais nécessaire en principe : la refonte n'écrit rien de nouveau |

## E. Pourquoi il n'y a pas de risque de perte de données
- La seule modification de base est **l'ajout** d'une colonne booléenne avec défaut `false`.
- `scripts/ui-guard.sh` **bloque** toute PR qui touche aux API, calculs, hooks, auth, migrations ou tests existants, qui contient du SQL destructeur, ou qui **ajoute** une écriture Supabase.
- Les écritures existantes sont déplacées à l'identique, et les 143 tests existants tournent à chaque étape.
- Drapeau OFF = rendu actuel, vérifié par comparaison de captures avant/après.
- `main` est protégée : rien n'arrive en production sans ta relecture.
