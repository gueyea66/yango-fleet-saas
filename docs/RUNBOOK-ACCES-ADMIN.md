# Runbook — « mon identifiant admin ne marche plus »

## Le diagnostic, en une commande

```bash
node scripts/diag-credential-admin.mjs admin@m3a.sn            # sans le mot de passe
node scripts/diag-credential-admin.mjs admin@m3a.sn 'MonMotDePasse'   # reproduit la connexion réelle
node scripts/diag-credential-admin.mjs --tenant m3a            # liste les emails admin connus du tenant
```

Le script a besoin de `NEXT_PUBLIC_SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`
(lus dans `.env.local` s'il est présent), plus `NEXT_PUBLIC_SUPABASE_ANON_KEY`
pour l'étape 4. Il répond par un verdict et le geste correctif.

## Pourquoi ce runbook existe

Une connexion admin franchit **quatre portes**, et trois d'entre elles se
referment sans jamais afficher « mot de passe incorrect » :

| # | Porte | Ce que voit l'utilisateur | Où regarder |
|---|-------|---------------------------|-------------|
| 1 | Compte Supabase Auth (existe, confirmé, non banni, mot de passe bon) | « Invalid login credentials » | `auth.users` |
| 2 | Profil `fleet.profiles` (présent, `role='admin'`, `tenant_id` renseigné) | connexion OK puis écran vide / 403 | `fleet.profiles` |
| 3 | Accès du tenant (actif, pas au-delà de son échéance) | connexion OK puis **/locked**, API en 402 | `fleet.tenants` |
| 4 | La page de login elle-même | message d'erreur | `app/auth/login` |

Les portes 2 et 3 donnent la même impression que la porte 1 — « ça ne marche
plus » — alors que l'authentification, elle, a parfaitement fonctionné.

## Cause racine de l'incident M3A

La migration `011` a ajouté `trial_ends_at TIMESTAMPTZ DEFAULT (now() +
interval '30 days')` sur **tous** les tenants, puis backfillé les lignes
existantes. Le tenant de l'opérateur (`slug='m3a'`, créé par la migration `010`
avec `plan='pro'`, jamais passé par un paiement, donc `plan_expires_at IS
NULL`) a hérité d'une fin d'essai que personne n'avait décidée.

La garde d'accès lisait `plan_expires_at ?? trial_ends_at`. Trente jours plus
tard, l'admin M3A se connectait, Supabase ouvrait la session — et le middleware
le renvoyait sur `/locked`, pendant que toutes les API admin répondaient 402.

Le seul remède offert par la console, « Étendre l'accès », reposait une
échéance à +30 jours : **le problème revenait chaque mois.**

## Ce qui empêche la récidive

- `fleet.tenants.never_expires` (migration `061`) : un accès qui ne doit jamais
  tomber le dit explicitement. Le tenant opérateur est marqué ainsi, et sa
  fausse échéance est effacée. Case à cocher dans `/superadmin` → fiche tenant
  → « Accès & Expiry » → **Accès permanent**.
- Le `DEFAULT` de `trial_ends_at` est supprimé : une durée d'essai est une
  décision métier (`TRIAL_DAYS = 14`), pas un défaut de colonne qui s'applique
  dans le dos de qui insère une ligne. Les deux chemins de création la posent
  déjà explicitement.
- Poser un `plan_expires_at` efface désormais `trial_ends_at` : une seule
  échéance fait foi, plus de deuxième date qui ressurgit.
- La règle d'accès vit dans **`lib/tenant/access.ts`** et nulle part ailleurs.
  Elle était recopiée dans le middleware, dans `assertTenantActive`, dans le
  cron du soir, dans la bannière et dans la console — cinq occasions de
  diverger. `__tests__/tenantAccess.test.ts` épingle le cas M3A.
- La suppression d'un chauffeur résout toujours sa cible dans le tenant de
  l'admin et sur `role='driver'` : un identifiant non reconnu ne peut plus
  faire supprimer le compte Auth portant cet id (un admin compris).
- La modification d'un compte admin depuis `/superadmin` ne renvoie l'email à
  GoTrue que s'il change réellement, avec `email_confirm` — plus de nouvelle
  adresse en attente de confirmation pendant que la console l'affiche comme
  active.
- La page de login traduit le refus de Supabase et dit quoi faire.

## Gestes correctifs selon le verdict

| Verdict du script | Geste |
|---|---|
| accès tenant expiré | `/superadmin` → fiche tenant → **Accès permanent** (tenant opérateur) ou **Étendre** (client qui a payé) |
| tenant suspendu | `/superadmin` → réactiver le tenant |
| mot de passe incorrect | `/superadmin` → ✏️ sur le compte admin → nouveau mot de passe (8 caractères minimum) |
| email non confirmé | `/superadmin` → ✏️ → sauvegarder (repasse `email_confirm`) |
| changement d'email en attente | se connecter avec l'**ancienne** adresse, puis la rechanger depuis `/superadmin` |
| profil absent / `tenant_id` NULL | recréer le profil `role='admin'` avec le bon `tenant_id` |
| compte Auth inexistant | vérifier l'adresse avec `--tenant <slug>`, puis recréer depuis `/superadmin` |

## Après un déploiement

`migrations/061-acces-permanent-et-echeance-fantome.sql` doit être exécuté une
fois dans le SQL Editor Supabase. Le code tolère son absence (les lectures de
`tenants` se font en `select("*")`), mais tant qu'elle n'est pas passée, la
fausse échéance reste en base.

Contrôle :

```sql
SELECT slug, plan, active, never_expires, trial_ends_at, plan_expires_at,
       COALESCE(plan_expires_at, trial_ends_at) AS echeance_qui_fait_foi
  FROM fleet.tenants ORDER BY created_at;
```
