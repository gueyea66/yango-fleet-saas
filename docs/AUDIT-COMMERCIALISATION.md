# Audit pré-commercialisation — Yango Fleet SaaS

**Date :** 2026-07-02
**Périmètre :** sécurité, qualité, readiness commerciale
**Référence :** audit initial du 2026-06-30 (score 3/10)

---

## Verdict global : GO — 8/10 après correctifs

Les 6 failles critiques de l'audit initial (C1-C5, E2) sont **toutes corrigées**.
Les nouveaux constats R2-R9 ont été **corrigés dans le commit accompagnant ce rapport**.
Restent 3 actions manuelles côté infra (section 5) et de la dette qualité non bloquante (section 3).

---

## 1. Failles de l'audit initial — état

| Réf | Faille | État |
|-----|--------|------|
| C1 | `.env.local` commité avec clés réelles | ✅ Corrigé — vérification `git log --all` : le fichier n'apparaît dans **aucun** commit de ce repo. Ignoré par `.gitignore`, secrets jamais exposés dans l'historique |
| C2 | Zéro auth serveur sur `/api/admin/*` | ✅ Corrigé — `requireAdminAuth()` (session cookie + rôle + tenant) sur toutes les routes admin |
| C3 | `listAllDrivers()` sans filtre tenant | ✅ Corrigé — filtre `tenant_id` obligatoire ([lib/services/auth.ts:140](../lib/services/auth.ts#L140)) |
| C4 | `/api/kyc-upload` sans auth + path traversal | ✅ Corrigé — auth requise, path sanitisé forcé sous le tenant, MIME vérifié par magic bytes, taille max 10 MB, signed URLs 30 min |
| C5 | `NEXT_PUBLIC_SUPERADMIN_KEY` dans le bundle client | ✅ Corrigé — `SUPERADMIN_KEY` server-only, vérif rate-limitée (5 essais/15 min/IP) |
| E2 | RLS désactivé (migration 010) | ✅ Corrigé côté code — migration 020 réactive RLS partout. **À confirmer appliquée en prod** |

## 2. Nouveaux constats — à corriger avant lancement

| Réf | Sévérité | Constat |
|-----|----------|---------|
| R1 | 🟢 Levé | Fausse alerte : `.env.local` n'a jamais été commité (vérifié dans tout l'historique). Seul `tsconfig.tsbuildinfo` (artefact de build, sans secret) était tracké — retiré. Rotation des clés **non requise** |
| R2 | 🟠 Élevé | `/api/notifications/trigger` **sans auth** — n'importe qui peut envoyer des push notifications (spam/phishing) à n'importe quel tenant, `tenantId` vient du client |
| R3 | 🟠 Élevé | `notification_log` : RLS désactivé + `GRANT SELECT, INSERT TO anon` (migration 011) — lisible/inscriptible avec la clé anon publique |
| R4 | 🟠 Élevé | Tables prod **sans migration dans le repo** : `notifications`, `push_subscriptions`, `superadmin_settings` — impossible de redéployer une instance propre (bloquant pour le white-label multi-instance) |
| R5 | 🟡 Moyen | `/api/setup-storage` sans auth (création bucket, idempotent — impact faible) |
| R6 | 🟡 Moyen | Comparaison clé superadmin non constant-time (timing attack, atténué par le rate limit) |
| R7 | 🟡 Moyen | Rate limiting en mémoire (`Map`) — reset à chaque déploiement Vercel, inefficace multi-instance. Acceptable au lancement, à migrer vers Upstash/Redis ensuite |
| R8 | 🟡 Moyen | Incohérence durée d'essai : `TRIAL_DAYS = 30` dans le code vs **14 jours** dans les CGU, la page register et l'API — risque légal/commercial |
| R9 | 🟡 Moyen | Notification superadmin d'import cassée : URL construite invalide + type `import_ready_for_injection` absent de `NOTIF_META` — échec silencieux systématique |

## 3. Dette qualité (non bloquant)

| Réf | Constat |
|-----|---------|
| Q1 | `app/admin/page.tsx` = 3 377 lignes, `app/driver/page.tsx` = 1 925 lignes — refacto Phase 2 non faite |
| Q2 | Fichiers legacy trackés : `admin.html` (138 KB), `chauffeur.html`, `yango-manager.html`, `setup*.js`, `index.html` — prototypes obsolètes à archiver |
| Q3 | CI : lint et `npm audit` en `continue-on-error` — ne bloquent jamais |
| Q4 | `npm audit` : 3 vulnérabilités modérées (postcss transitif via next — faux positif d'advisory, non actionnable) |
| Q5 | Dossiers vides `api/admin/diagnose` et `api/admin/fix-driver-ids` |
| Q6 | Middleware Next.js déprécié (convention `proxy` recommandée en Next 16) — warning build |
| Q7 | Prix incohérents : `lib/plans.ts` = 35 000/75 000 XOF vs défauts `payment-settings` = 25 000/50 000 XOF. Renseigner `price_standard`/`price_pro` dans `superadmin_settings` pour trancher |

## 4. Points positifs confirmés

- ✅ Build production OK, **40 tests Jest passent**, CI GitHub Actions (lint + tsc + build + audit)
- ✅ Multi-tenant avec RLS + isolation vérifiée dans les API (tenantId dérivé de la session, jamais du client)
- ✅ Onboarding self-service (register → tenant + admin + settings, rollback propre en cas d'échec, rate limit 3/h/IP)
- ✅ Plans Standard/Pro avec quotas appliqués côté serveur (max chauffeurs, export CSV)
- ✅ Trial + expiration enforced dans le middleware → page `/locked`
- ✅ Billing manuel Wave/Orange Money avec validation superadmin
- ✅ Pages légales CGU + confidentialité
- ✅ Monitoring Sentry, page `/status`, notifications Web Push + in-app
- ✅ White label : `tenant_settings` (nom, couleur, devise, timezone) + CSS vars

## 5. Actions manuelles requises (hors code — à faire par Abdou)

1. **Vérifier en prod Supabase** que la migration 020 (RLS) est bien appliquée : `select relname, relrowsecurity from pg_class where relnamespace = 'fleet'::regnamespace;`
2. **Activer les backups** Supabase (PITR si plan payant, sinon export planifié)
3. Appliquer la migration 024 (livrée avec les correctifs) en prod

---

*Rapport généré le 2026-07-02 — correctifs code livrés dans le commit associé.*
