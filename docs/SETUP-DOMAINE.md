# Configuration du domaine (sous-domaines white label)

**Contexte :** `m3asolutions.com` n'appartient pas à M3A (c'est un site Wix tiers).
Il faut un **domaine dédié** dont on contrôle le DNS pour créer les sous-domaines
clients (`fallou.fleet.mondomaine.com`). Le plus simple : un domaine géré par Vercel.

Le code n'a **plus aucun domaine en dur** — tout passe par la variable
`NEXT_PUBLIC_ROOT_DOMAIN`. Tant qu'elle est vide, l'app tourne en mono-domaine
(pas de sous-domaine par client, le branding s'applique après login).

---

## Étape 1 — Choisir un domaine neutre

Pour du white label, évite un domaine « M3A » (le client final ne doit pas voir ton
fournisseur). Un domaine générique lié à la flotte/mobilité est préférable, par ex. :
`fleetdakar.com`, `flotti.app`, `xarala.app`, `wootiii.com`… (à vérifier disponibles).

Coût : ~12–25 $/an selon l'extension.

## Étape 2 — Acheter et connecter le domaine dans Vercel

1. Vercel → ton projet `yango-fleet-saas` → **Settings → Domains**
2. **Buy** un domaine (Vercel le vend et gère le DNS automatiquement — aucun GoDaddy requis),
   ou **Add** un domaine que tu possèdes déjà.
3. Ajoute le **domaine wildcard** : saisis `*.fleet.<ton-domaine>` (ex `*.fleet.flotti.app`)
   et valide. Vercel crée le certificat SSL wildcard automatiquement.
4. (Option) Ajoute aussi `fleet.<ton-domaine>` (sans slug) qui servira de page d'accueil.

## Étape 3 — Renseigner la variable d'environnement

Vercel → Settings → **Environment Variables** → ajouter :

```
NEXT_PUBLIC_ROOT_DOMAIN = fleet.<ton-domaine>      (ex : fleet.flotti.app)
```

Puis **redéployer** (Deployments → ⋯ → Redeploy) pour que la variable soit prise en compte.

Optionnel, si tu crées des adresses email pro sur ce domaine :
```
NEXT_PUBLIC_SUPPORT_EMAIL = support@<ton-domaine>
NEXT_PUBLIC_PRIVACY_EMAIL = privacy@<ton-domaine>
```

## Étape 4 — Vérifier

- `https://m3a.fleet.<ton-domaine>/auth/login` → doit afficher la page brandée M3A
- `https://demo-fallou.fleet.<ton-domaine>/auth/login` → doit afficher le branding Fallou
- La page d'inscription affiche désormais la bonne URL client
- Les liens créés à l'inscription (`loginUrl`) pointent vers le bon domaine

---

## Comment le routing fonctionne

- Le middleware/loader lit le **premier segment** du hostname comme slug de tenant
  (`fallou.fleet.flotti.app` → tenant `fallou`).
- Sur `localhost`, c'est `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` qui s'applique.
- Le branding public (logo/couleur) est servi par `/api/public/tenant-branding`
  avant même la connexion → la page de login est déjà aux couleurs du client.

## Pour un client qui veut SON propre domaine (offre premium)

Ex : Fallou veut `app.fallou-driver.com` au lieu d'un sous-domaine.
1. Ajouter `app.fallou-driver.com` dans Vercel → Domains.
2. Fallou crée un **CNAME** `app` → `cname.vercel-dns.com` chez SON registrar.
3. Mapper ce domaine au tenant (résolution par domaine complet en plus du slug —
   petite évolution code à prévoir : lookup `tenants.domain`).
