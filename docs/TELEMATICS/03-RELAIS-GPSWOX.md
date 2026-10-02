# Relais GPSwox → Traccar → M3A Fleet (NMK)

> Option retenue par Abdou le 02/10/2026 : NMK garde sa plateforme GPSwox ; GPSwox nous **transfère une copie** des données de chaque boîtier. Aucune intervention sur les boîtiers.

## Principe

```
Boîtier NMK ──► serveur GPSwox de NMK (inchangé)
                    │  transfert (forward) des trames brutes
                    ▼
              Traccar M3A (port du protocole du boîtier)
                    │  forward JSON, x-telematics-key
                    ▼
     /api/telematics/ingest ──► telematics_devices (tenant NMK) ──► positions, trajets, km
```

Traccar reconnaît le boîtier par son **identifiant** (IMEI) et décode le **protocole** du fabricant. L'ingestion rattache ensuite le boîtier au tenant via `telematics_devices.external_id` : rien d'autre à configurer côté code.

## À obtenir de NMK / du prestataire GPS

| Question | Pourquoi |
|---|---|
| Marque et modèle des boîtiers (ex. Concox GT06N, Teltonika FMB920) | Détermine le **protocole** et donc le port Traccar à ouvrir |
| Le serveur GPSwox de NMK permet-il de **transférer les données** vers un autre serveur (IP:port) ? Par boîtier ou global ? | C'est le cœur de l'option 2 |
| Format transféré : trame brute du boîtier, ou format propre à GPSwox ? | Brut → Traccar le décode tel quel. Format GPSwox → il faudra un adaptateur |
| Liste des boîtiers : IMEI + plaque du véhicule | Enrôlement dans M3A (écran Boîtiers) |

Si le transfert n'existe pas : repli sur l'option 3 (lecture de l'API GPSwox, connecteur à développer).

## Mise en place

1. **Traccar** : ajouter le port du protocole dans `deploy/traccar/traccar.xml` (ex. `<entry key='gt06.port'>5023</entry>`).
   Railway n'expose **qu'un port TCP par service** : un protocole supplémentaire = un service Traccar supplémentaire (même image, même `forward.url`) ou un hébergeur multi-ports. Voir `01-RUNBOOK.md`.
2. **GPSwox** (fait par le prestataire ou l'admin GPSwox de NMK) : transfert vers `IP_TRACCAR:PORT_PROTOCOLE`.
3. **M3A Fleet**, connecté en admin **NMK** → Véhicules › Boîtiers › Ajouter :
   origine « Relayé par une plateforme GPS (ex. GPSwox) », IMEI, protocole, véhicule.
   Un boîtier non enrôlé est refusé à l'ingestion : rien n'entre tant qu'il n'est pas déclaré.
4. **Vérifier** : Suivi GPS montre la position ; Boîtiers affiche « vu il y a … ». Le chien de garde (3 h sans signal) prévient les admins NMK.

## Sécurité

- Le boîtier appartient au tenant qui l'enrôle ; un IMEI déjà enrôlé ailleurs est refusé (sans révéler l'organisation).
- La clé d'ingestion (`TELEMATICS_INGEST_KEY`) reste unique pour tous les tenants : c'est l'enrôlement qui fait l'isolation.
