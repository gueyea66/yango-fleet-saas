# Runbook GPS — du banc d'essai au K3 en direct

Ordre à respecter. Chaque étape se valide avant la suivante ; le boîtier réel
n'est touché qu'à l'étape 5, et seulement sur go d'Abdou.

---

## 1. Banc d'essai local (aucun coût, aucun risque)

```bash
cd deploy/traccar
docker compose up -d                 # Traccar écoute le 5013

cd ../..
node scripts/h02-simulator.mjs --host 127.0.0.1 --port 5013 --speed 20
```

Vérification : `http://localhost:8082` doit montrer un boîtier `9170258210`
qui remonte, et la console du simulateur défiler ses trames.

À ce stade Traccar reçoit, mais M3A ne stocke rien : le reversement pointe
encore sur `REMPLACER_URL`.

---

## 2. Base lab

1. Créer un projet Supabase dédié (tier gratuit) — **pas** le projet de production.
2. Y exécuter, dans l'ordre, le schéma de base du produit puis `migrations/lab/049-telematics-core.sql`.
3. Renseigner dans `.env.local` du lab :

```
NEXT_PUBLIC_SUPABASE_URL=<projet lab>
SUPABASE_SERVICE_ROLE_KEY=<clé service lab>
TELEMATICS_INGEST_KEY=<openssl rand -hex 32>
```

4. Enrôler le boîtier du K3 (sans lui, toute position est rejetée — c'est voulu) :

```sql
insert into fleet.telematics_devices
  (tenant_id, vehicle_id, vendor, model, external_id, protocol, label)
values
  ((select id from fleet.tenants where slug = 'm3a'),
   (select id from fleet.vehicles where plate = 'AB-872-JG'),
   'sinotrack', 'ST-901-868L', '9170258210', 'h02', 'Kia K3');
```

---

## 3. Chaîne complète en local

Lancer l'app (`npm run dev`), puis pointer Traccar sur elle. `forward.url` doit
être joignable depuis le conteneur : depuis Docker Desktop, utiliser
`http://host.docker.internal:3000/api/telematics/ingest`.

Rejouer le simulateur, puis contrôler :

```sql
select count(*), min(recorded_at), max(recorded_at)
from fleet.telematics_positions;

select * from fleet.v_telematics_daily_km;
```

Test d'idempotence : relancer le **même** trajet simulé. Le nombre de lignes ne
doit pas bouger — sinon les kilomètres seraient comptés deux fois.

---

## 4. Hébergement de la passerelle

Railway, service Docker à partir de `deploy/traccar/`, avec un **TCP proxy** sur
le 5013 (un seul proxy TCP par service). Relever l'hôte et le port publics
attribués : c'est ce couple qui ira dans le boîtier.

`forward.url` pointe alors sur le déploiement qui porte la base lab.

---

## 5. Bascule du K3 — sur go d'Abdou uniquement

### Configuration d'origine relevée le 17/09/2026 (RCONF)

```
ST-901-868L:V4.35, ID:9170258210, UP:0000, MODE:GPRS,
POWER ALARM:ON, OVERSPEED:80, SHAKE ALARM:50, GEOFENCE:OFF, SLEEP:OFF,
ACC ALARM SMS:ON, APN:internet,internet,internet,
IP:45.112.204.246,8090, GPRS UPLOAD TIME:30, TIME ZONE:E00
```

**Retour vers SinoTrack, à tout moment :**

```
8040000 45.112.204.246 8090
```

Mot de passe du boîtier : `0000` (valeur d'usine, confirmée par `UP:0000`).
Le SMS passe par le réseau GSM, pas par Internet : le retour arrière reste
possible même si la passerelle est injoignable.

### Passerelle cible

`iriguchi.proxy.rlwy.net`, port public `14728` (proxy TCP Railway → 5013 H02).

**Avant tout SMS**, relever la configuration actuelle du boîtier pour pouvoir
revenir en arrière :

```
RCONF           → le boîtier répond avec son serveur et son APN actuels
```

Noter la réponse (IP et port SinoTrack d'origine) **avant** de continuer. Sans
cette note, le retour à SinoTrack n'est plus garanti.

Bascule :

```
8040000 <hôte-railway> <port-railway>
```

Retour arrière, à tout moment :

```
8040000 <IP SinoTrack relevée> <port relevé>
```

Le boîtier ne parle qu'à un serveur à la fois : pendant la bascule, le K3
n'apparaît plus dans l'application SinoTrack. C'est normal et réversible.

---

## 6. Calibration de l'état moteur (72 h après la bascule)

Le masque de statut H02 n'est pas interprété tant qu'il n'est pas observé sur
ce boîtier précis. Protocole :

1. Moteur coupé, véhicule à l'arrêt : relever `status_raw` sur 10 minutes.
2. Moteur tournant, véhicule à l'arrêt : relever `status_raw` sur 10 minutes.
3. Comparer les masques : le bit qui change est le candidat « ignition ».
4. Confirmer sur un troisième cycle avant d'écrire la règle.

```sql
select status_raw, count(*), min(recorded_at), max(recorded_at)
from fleet.telematics_positions
where device_id = (select id from fleet.telematics_devices where external_id = '9170258210')
  and recorded_at > now() - interval '3 days'
group by status_raw order by 2 desc;
```

Tant que cette calibration n'est pas faite, `ignition` reste `NULL` et aucune
heure de service n'est affichée. Un faux « moteur allumé » coûterait plus cher
qu'une case vide.

---

## 7. Le premier chiffre qui rapporte

Une fois quelques jours de données réelles accumulées :

```sql
select r.date, v.plate,
       (r.end_odometer - r.start_odometer) as km_declares,
       k.km_gps,
       k.km_gps - (r.end_odometer - r.start_odometer) as ecart
from fleet.daily_reports r
join fleet.vehicles v on v.id = r.vehicle_id
join fleet.v_telematics_daily_km k
  on k.vehicle_id = r.vehicle_id and k.day_local = r.date
order by r.date desc;
```

C'est la promesse du §17 du brief : le km déclaré au compteur face au km
réellement parcouru. Avant d'en tirer une conclusion sur un chauffeur, se
rappeler que le GPS perd des points en zone dense et que l'écart normal
constaté doit d'abord être mesuré sur plusieurs semaines.
