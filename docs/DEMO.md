# Guide de démo live — M3A Fleet

**Tenant de démo :** `demo-fallou` (Fallou Driver) · créé le 2026-07-02 · essai jusqu'au 16/07/2026
**Validé de bout en bout le 2026-07-02** par orchestration automatisée (19 captures dans [demo/](demo/)).

## Accès

| Rôle | Identifiant | Mot de passe | URL |
|------|-------------|--------------|-----|
| Admin (client) | `demo@fallou-driver.sn` | `DemoFallou2026!` | `/auth/login` (onglet Admin) |
| Chauffeur | `FD001` (Moussa Diop) | `moussa2026` | `/auth/login` (onglet Conducteur) |
| Superadmin M3A | clé superadmin | — | `/superadmin` |

En local : `npm run dev` → http://localhost:3000 (ou 3002 si port occupé).
En prod : l'URL du tenant une fois le wildcard DNS configuré.

## Avant le rendez-vous (checklist 10 min)

1. `npm run demo` — rejoue tout le parcours automatiquement et vérifie que rien n'est cassé
2. Ouvrir 2 fenêtres : desktop (admin) + fenêtre mobile réduite ou téléphone réel (chauffeur)
3. Se connecter aux deux comptes à l'avance
4. Préparer la console superadmin dans un 3ᵉ onglet (pour montrer le branding white label en live)
5. Si besoin de repartir de zéro : `npm run demo -- --fresh` crée un nouveau chauffeur

## Déroulé conseillé (15-20 min)

1. **Le problème** (2 min) — cahiers, WhatsApp, Excel : montrez que vous connaissez leur quotidien
2. **Côté chauffeur, sur téléphone** (5 min) — le vendeur star :
   - Login avec un simple ID + mot de passe
   - Rapport de fin de journée : recettes Yango + hors-Yango, km, courses → soumis en 60 secondes
   - Dépense carburant avec kilométrage et litres
   - « Chaque soir, chaque chauffeur fait ça depuis son téléphone. Fini les cahiers. »
3. **Côté gestionnaire, sur desktop** (7 min) :
   - Notification de soumission (cloche) → onglet Soumissions
   - Ouvrir le rapport : commission calculée automatiquement (15 % + part partenaire) → Approuver
   - Valider la dépense (photo du reçu possible)
   - Dashboard : recettes vs charges, marge nette en temps réel
   - Pilotage : rentabilité par chauffeur, simulation
4. **White label** (3 min) — LE moment pour Fallou Driver :
   - Console superadmin → carte du tenant → Branding : charger SON logo, SA couleur → recharger la page client : l'app est à ses couleurs
   - « Vos clients ne verront jamais M3A. C'est votre plateforme. »
5. **Prix & next steps** (3 min) — proposition commerciale imprimée (offre A)

## Points d'attention

- Le tenant de démo tourne sur la **base de production** : ne pas y mettre de vraies données client
- Sur localhost le branding affiché est celui du tenant par défaut (`m3a`) — la démo du branding client se fait via le superadmin ou sur le sous-domaine du tenant en prod
- Après la démo, remettre la file de validation à zéro : `npm run demo -- --fresh` puis valider, ou nettoyer dans Soumissions

## Orchestration automatisée

```bash
npm run demo            # rejoue tout le parcours (chauffeur FD001)
npm run demo -- --fresh # avec un nouveau chauffeur FDxxx aléatoire
```

Le script [scripts/demo-orchestration.js](../scripts/demo-orchestration.js) : login admin → création chauffeur →
login chauffeur mobile → rapport + dépense → validations admin → tour de toutes les pages.
Chaque étape produit une capture dans `docs/demo/` — si le script passe, la démo passera.
