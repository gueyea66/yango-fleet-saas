# Registre des gaps — Yango Fleet SaaS

**Mis à jour :** 2026-07-02 · Complément de [AUDIT-COMMERCIALISATION.md](AUDIT-COMMERCIALISATION.md)
Pattern chassé : fonctionnalités « construites mais jamais branchées » et logiques incomplètes.

---

## ✅ Corrigés aujourd'hui (commit branding/white-label)

| Gap | Correctif |
|-----|-----------|
| Aucun moyen de renseigner le logo client (`logo_url` en base depuis la migration 010, jamais exploité) | API `/api/superadmin/branding` (upload PNG/JPEG/WebP 2 MB max, magic bytes, bucket public `branding`) + éditeur Branding dans la carte tenant superadmin |
| `BrandLogo` affiché nulle part | Branché : login, sidebar admin (desktop+mobile), portail driver (3 emplacements), pilotage (2) |
| Login hardcodé « Yango Fleet » + badge « Y » + couleur fixe | 100 % tenant-brandé (logo, nom, couleur primaire) |
| **RLS bloque le branding anonyme** : la page de login ne pouvait jamais afficher le branding (policy `tenants` exige une session) | API publique `/api/public/tenant-branding?slug=` (champs whitelistés, cache CDN 5 min) + loader réécrit |
| Sidebar admin affichait « Abdoulaye G. » en dur pour tous les clients | Nom réel de l'admin connecté |
| Page d'accueil `/` = page de dev « initialization complete » | Redirection vers `/auth/login` |
| Aucun « mot de passe oublié » | Pages `/auth/forgot` + `/auth/reset` (Supabase resetPasswordForEmail) + lien sur le login |
| `TrialBanner` écrit mais jamais monté, bouton vers WhatsApp placeholder `221770000000` | Rendu autonome (self-loading), lien `/paiement`, monté sur le dashboard admin — le client est maintenant prévenu dès J-14 |
| Drivers : notifications insérées en base mais **illisibles** (pas de cloche, API admin-only) | `NotificationBell` ajouté au portail driver (mobile + desktop) ; API déjà ouverte aux drivers (commit précédent) |
| `/auth/register` legacy : créait un compte Supabase **orphelin** (sans tenant ni profil), contournait l'onboarding | Redirection vers `/register` |
| Essai : défauts superadmin encore à 30 j et prix 25k/50k | Alignés : 14 j, 35 000/75 000 XOF |
| Titre statique « Yango Fleet Manager », `lang="en"` | « Fleet Manager » neutre, `lang="fr"` |

## 🔴 P1 — avant de signer un client white label

| # | Gap | Détail / action |
|---|-----|-----------------|
| G1 | **Notifications d'expiration jamais envoyées automatiquement** | `plan_expiring`/`payment_due` existent dans `NOTIF_META` mais aucun scheduler ne les déclenche. La bannière in-app couvre le besoin à la connexion ; pour le push il faut un Vercel Cron (`vercel.json` → route `/api/cron/expiry-check`) |
| G2 | **SMTP** : le reset password s'appuie sur l'email Supabase par défaut (~3 emails/h, expéditeur `noreply@mail.app.supabase.io`) | Configurer un SMTP custom (Resend/Brevo) dans Supabase Auth → emails fiables + expéditeur brandé |
| G3 | **Domaine dédié à acquérir (Vercel) + wildcard** | `m3asolutions.com` n'appartient pas à M3A (site Wix tiers). Domaine désormais configurable via `NEXT_PUBLIC_ROOT_DOMAIN` (plus aucun hardcode). Action Abdou : acheter un domaine neutre dans Vercel → Domains, ajouter `*.fleet.<domaine>`, renseigner la variable. Voir [SETUP-DOMAINE.md](SETUP-DOMAINE.md) |
| G4 | ✅ Fait le 02/07 : bucket `branding` créé, migrations 024/025 appliquées en prod (lockdown superadmin_settings + rotation clé) |

## 🟡 P2 — dans les 30 jours

| # | Gap | Détail |
|---|-----|--------|
| G5 | Devise hardcodée : **146 occurrences** « FCFA/XOF » dans 8 fichiers alors que `tenant_settings.currency` existe | Créer `useCurrency()` (symbole + format depuis le tenant) et remplacer progressivement — bloquant seulement pour un client hors zone franc |
| G6 | Flags de plan non appliqués : `canMultiVehicle`, `canAccessAPI` (et `canSalaryAdvance`, true partout) | Enforcement API quand ces features deviennent différenciantes commercialement |
| G7 | Pas de manifest PWA (promesse « épingler comme une app ») | `manifest.json` + icônes ; idéalement dynamique par tenant |
| G8 | Rate limiting en mémoire (register, superadmin) | Migrer vers Upstash Redis |
| G9 | Prix en double : `PLAN_LIMITS` (code) vs `superadmin_settings` (DB) | Source unique : DB avec fallback code |
| G10 | Pas d'emails transactionnels (bienvenue, confirmation paiement, échéance) | Brancher Resend après G2 |

## 🟢 P3 — dette / confort

- Refacto `app/admin/page.tsx` (3 400 lignes) et `driver/page.tsx` (1 900)
- Convention `middleware` → `proxy` (Next 16)
- Fichiers legacy racine (`admin.html`, `chauffeur.html`, `yango-manager.html`, `setup*`) à archiver
- Suppression définitive d'un tenant : procédure SQL manuelle (SOP-09) — pas de bouton superadmin (avec double confirmation) 
- Lint + `npm audit` encore en `continue-on-error` dans la CI
- `PLAN_COLORS`/types plan : nettoyer les valeurs legacy `starter`/`enterprise`
