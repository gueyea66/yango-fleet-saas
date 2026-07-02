# SETUP FINAL — Yango Fleet SaaS
> 3 étapes manuelles pour mettre en production. Tout le code est prêt.

---

## Étape 1 — Git push

```powershell
cd "C:\Users\Abdou\Desktop\vadde meccum\Yango Business\yango-fleet-saas"
git push -u origin main
```

Le repo `gueyea66/yango-fleet-saas` est déjà créé sur GitHub. Le commit `572a9da` est en attente.

---

## Étape 2 — SQL migration sur Supabase

**Projet cible :** `tlcgoxinhtzmtgkmsaip` (M3A solution — vide)

1. Ouvrir [supabase.com](https://supabase.com) → projet `tlcgoxinhtzmtgkmsaip`
2. Aller dans **SQL Editor**
3. Coller le contenu de : `migrations/010-multitenant-schema.sql`
4. Cliquer **Run**

Ce script crée :
- Tables : `tenants`, `tenant_settings`, `remuneration_config`
- Ajoute `tenant_id UUID` sur toutes les tables existantes
- Seed le tenant M3A par défaut
- Désactive RLS (isolation au niveau app)

Après exécution, récupérer dans **Settings → API** :
- `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
- `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

---

## Étape 3 — Déploiement Vercel

1. Aller sur [vercel.com](https://vercel.com) → **New Project**
2. Importer `gueyea66/yango-fleet-saas`
3. Framework : **Next.js** (auto-détecté)
4. Ajouter les variables d'environnement :

| Variable | Valeur |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | (depuis Supabase étape 2) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | (depuis Supabase étape 2) |
| `SUPABASE_SERVICE_ROLE_KEY` | (depuis Supabase étape 2) |
| `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` | `m3a` |
| `NEXT_PUBLIC_SUPERADMIN_KEY` | `m3a-super-2026` ← changer en prod |

5. Cliquer **Deploy**

---

## Après déploiement

- Superadmin : `https://votre-app.vercel.app/superadmin`  
  Mot de passe : `m3a-super-2026`

- Pour un nouveau client → superadmin → "Nouveau client" → slug `alpha` → subdomain `alpha.votre-app.vercel.app`

- Pour configurer un vrai domaine : Vercel → Settings → Domains → `alpha.fleet.VOTRE-DOMAINE.com`

---

## Livraisons

| Fichier | Description |
|---|---|
| `C:\Users\Abdou\Desktop\M3A-Yango-Fleet-Manager.html` | Présentation client |
| `C:\Users\Abdou\Desktop\M3A-Fleet-SaaS-TechDoc.html` | Documentation technique |
| `C:\Users\Abdou\Desktop\M3A-Fleet-SaaS-Guide-Utilisateur.html` | Guide utilisateur M3A |
| `migrations/010-multitenant-schema.sql` | Migration DB multi-tenant |
| `lib/tenant/` | Détection et contexte tenant |
| `lib/supabase/tenanted.ts` | Queries isolées par tenant |
| `lib/remuneration/engine.ts` | Moteur de rémunération |
| `components/brand/BrandShell.tsx` | Branding dynamique par client |
| `app/superadmin/page.tsx` | Panel superadmin |
