# M3A Fleet → M3A Modular TMS — Analyse d'écart et plan GPS

Document de travail, branche `feat/telematics-core` (copie isolée `m3a-tms-lab`,
partie de `origin/main` @ 5a44f0e). **Rien de ce qui suit ne touche la production.**

Écrit pour Abdou et pour l'agent qui prendra la suite du développement.

---

## 1. Ce que dit le brief, ce que dit le code

Le brief (§27) demande d'auditer l'existant avant de coder. Fait. Constat en une ligne :
**le socle commun que le brief veut construire existe déjà à 70 % ; la couche télématique
n'existe à 0 %.**

| Objet du brief | État réel dans `yango-fleet-saas` | Verdict |
|---|---|---|
| Tenant / entreprise | `fleet.tenants`, `fleet.tenant_settings`, résolution par sous-domaine (`middleware.ts`) | **KEEP** |
| Utilisateurs, rôles | `fleet.profiles` (admin / driver / technical), `requireAdminAuth()`, gating abonnement 402 | **KEEP** |
| Véhicules | `fleet.vehicles(id, plate, make, model, driver_id, mileage, status, partner_rate, yango_rate, tenant_id)` | **EXTEND** (lien vers boîtier) |
| Chauffeurs | `fleet.profiles` + KYC (`fleet.kyc_documents`) | **KEEP** |
| Dépenses / carburant | `fleet.expenses` avec catégories, litres, reçus | **KEEP** |
| Revenus | `fleet.daily_reports` (CA Yango, bonus, hors-Yango, net) | **KEEP** |
| Documents | `fleet.uploads` + extraction vision IA (`fleet.ai_extractions`) | **KEEP** |
| Audit trail | `fleet.action_logs` / `audit_logs` + gardes SQL (migrations 039, 048) | **KEEP** |
| Reporting / analytics | `lib/calc.ts`, `lib/calcReel.ts`, KPI, report-agent, couche IA | **KEEP** |
| Multi-tenant SaaS | `tenant_id` sur toutes les tables + RLS + triggers `guard_*` | **KEEP** |
| **GPS / télématique** | **aucune table, aucune route, aucun champ lat/lon dans tout le repo** | **CREATE** |
| Mission Engine | inexistant — l'unité de travail est la *journée déclarée*, pas la mission | **CREATE** |
| Business Module Framework | inexistant — le métier Yango est en dur | **REFACTOR, plus tard** |
| Executive Dashboard | `/admin/pilotage` existe mais mono-métier Yango | **EXTEND, plus tard** |

### Les points du brief déjà gagnés

- **§21 (éviter les silos)** : il n'y a jamais eu de `yango_vehicle`. Une seule table
  `vehicles`, une seule table `profiles`. Le piège que le brief redoute n'existe pas ici.
- **§20 (multi-tenant)** : déjà en place, jusqu'aux gardes d'écriture côté base.
- **§23 (auditabilité)** : la culture est déjà là (`lib/calc.ts` est la source de vérité,
  le LLM ne calcule jamais — règle du chantier V3 IA).

### Les points où le brief se trompe de cible

- **§25 Phase 1 « Core cleanup »** : inutile de formaliser Vehicle/Driver/Tenant/Expense,
  c'est fait. La phase 1 réelle, c'est la télématique. On gagne une phase entière.
- **§2 « Business Unit »** : n'existe pas en base. Mais tant qu'un tenant n'a qu'un métier,
  l'ajouter maintenant coûte une migration et ne sert rien. À faire quand le 2ᵉ module arrive.

---

## 2. Le vrai sujet : le GPS

### 2.1 Contraintes physiques constatées (vérifiées, non supposées)

| Fait | Conséquence |
|---|---|
| Le SinoTrack ST-901 parle **H02 en TCP brut** (`*HQ,<serial>,V1,…#`), pas HTTP | **Vercel ne peut pas recevoir le boîtier.** Il faut un process TCP hébergé ailleurs |
| **SinoTrack n'expose aucune API publique** | Impossible de lire la plateforme SinoTrack proprement. Soit export manuel, soit le boîtier pointe chez nous |
| Le boîtier n'a **qu'un seul serveur** (SMS `8040000 <ip> <port>`) | « Rester sur SinoTrack » et « alimenter M3A en live » s'excluent. La bascule est réversible par SMS |
| Upload 30 s | ~2 900 points/jour/véhicule, ~90 k/mois. À 10 véhicules : 900 k lignes/mois |

### 2.2 Architecture retenue — **Traccar comme passerelle**

```
   K3 (SinoTrack ST-901, H02/TCP)      Teltonika, Concox, 200+ autres modèles
                 │                                      │
                 └──────────────┬───────────────────────┘
                                ▼
                        TRACCAR (Docker)            ← process TCP, hors Vercel
                        forward.type = json            Railway, ~5 $/mois
                                │
                                │  POST JSON + clé partagée (forward.header)
                                ▼
                    /api/telematics/ingest          ← Next.js, idempotent
                      adaptateurs : traccar | h02       ← LE point d'abstraction
                                │
                                ▼
                    fleet.telematics_positions      ← append-only, tenant_id, brut conservé
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              EVENT ENGINE            ANALYTICS
        (départ, arrêt, arrivée)   (km réels vs km déclarés)
```

Le métier ne voit jamais un octet de SinoTrack : il lit `telematics_positions`, qui est
agnostique du fabricant. C'est le §6 du brief, appliqué.

**Pourquoi Traccar plutôt qu'une passerelle maison.** Le brief (§6) exige d'accepter
plusieurs fabricants sans que le métier en dépende. Traccar est exactement cette couche,
déjà écrite et éprouvée : 200+ protocoles, reconnexions, firmwares divergents, commandes
vers les boîtiers. Écrire nous-mêmes le H02 coûte 150 lignes ; écrire Teltonika et Concox
en coûterait dix fois plus, pour réapprendre des bugs déjà corrigés ailleurs. Le jour où
NMK arrive avec ses propres trackers, le support est déjà là.

**Ce que ça n'engage pas.** Le point d'abstraction reste **notre** route d'ingestion, pas
Traccar. Elle accepte deux formats en entrée : le JSON forwardé par Traccar, et des trames
H02 brutes. Si Traccar s'avère lourd ou coûteux, on le remplace par la passerelle maison
sans toucher ni à la base, ni au métier, ni aux écrans.

**Ce qui reste du travail déjà fait.** `lib/telematics/h02.ts` (parser pur, 10 tests verts)
et `scripts/h02-simulator.mjs` restent utiles à trois titres : ils valident la chaîne sans
attendre l'hébergement, ils servent de banc d'essai rejouable, et ils constituent le
chemin de repli si Traccar est écarté.

**Limite d'hébergement constatée** : Railway n'autorise **qu'un seul proxy TCP par
service**. Un service Traccar = un port de protocole exposé. Le 5013 (H02) suffit pour le
K3 et Orlando ; un deuxième fabricant demandera soit un second service, soit un hébergeur
qui expose plusieurs ports.

### 2.3 Décisions prises avec Abdou le 15/09/2026

1. **Passerelle d'abord, bascule du K3 sur son go.** On développe et on valide avec un
   simulateur qui rejoue de vraies trames H02. Le K3 reste sur SinoTrack tant qu'Abdou
   n'a pas envoyé le SMS. Retour arrière : un SMS.
2. **Base « lab » séparée.** Le POC n'écrit pas dans la base de production M3A Fleet :
   ni schéma modifié, ni volume GPS, ni facture Supabase impactée. Fusion dans la prod
   par migration quand le modèle aura tenu quelques semaines.

### 2.4 Ce qu'on ne devine pas

Deux choses ne seront **pas** inventées et resteront `NULL` jusqu'à calibration terrain :

- **L'état du moteur (ignition)**. Le champ `status` H02 est un masque de 4 octets dont la
  sémantique varie d'un fabricant à l'autre. Le décoder au jugé produirait de faux
  « moteur allumé » — donc de fausses heures de service. On stocke le masque brut, et on
  calibre en observant le K3 moteur coupé puis moteur tournant.
- **L'odomètre.** Le ST-901 n'en envoie pas de fiable. La distance sera *calculée* à
  partir des positions successives, et affichée comme telle.

C'est le §13 du brief (confidence engine) : mieux vaut un trou assumé qu'un chiffre faux.

---

## 3. Roadmap GPS (remplace les phases 1-4 du brief)

| Étape | Contenu | État |
|---|---|---|
| **G0** | Copie isolée + analyse d'écart | ✅ fait |
| **G1** | Modèle normalisé `telematics_devices` / `telematics_positions` (append-only, idempotent, multi-tenant) | migration `lab/049` écrite |
| **G2** | Parser H02 pur + tests sur trames réelles | `lib/telematics/h02.ts` |
| **G3** | Passerelle TCP + route d'ingestion + simulateur de trajet Dakar | à faire |
| **G4** | Écran « Suivi » : dernière position, trace du jour, km GPS du jour | à faire |
| **G5** | **Le premier chiffre qui vaut de l'argent** : km GPS vs km déclarés au compteur par le chauffeur, par jour et par véhicule | à faire |
| **G6** | Bascule du K3 (SMS), observation 72 h, calibration ignition | sur go d'Abdou |
| **G7** | Event Engine (départ / arrêt / arrêt long) puis Mission Engine | après G6 |

G5 est le point où le GPS cesse d'être un gadget : M3A Fleet calcule déjà la consommation
au km à partir de l'odomètre **déclaré**. Le jour où le GPS donne le km réel, l'écart
devient mesurable — et c'est exactement la promesse §17 du brief.

---

## 4. Ce que ça coûte

| Poste | Coût mensuel |
|---|---|
| Passerelle TCP (Railway, 1 petit service always-on) | ~5 $ |
| Base lab (Supabase tier gratuit, 2 véhicules) | 0 |
| Carte : OpenStreetMap + Leaflet | 0 |
| **Total POC** | **~5 $/mois** |

À 10 véhicules en production, le volume GPS (900 k lignes/mois) reste sous les limites du
plan Supabase Pro déjà payé, à condition de purger le brut au-delà de 90 jours — à
trancher avant la mise en production, pas maintenant.
