# Lecture de l'API GPSwox → M3A Fleet (NMK)

> Option retenue par Abdou le 12/10/2026 : NMK garde sa plateforme GPSwox et son application ; M3A relit les positions par l'API, avec le compte de NMK. Aucune intervention sur les boîtiers, aucune demande au prestataire GPS. Remplace le relais Traccar de `03-RELAIS-GPSWOX.md`, qui dépendait d'un transfert à configurer par le prestataire.

## Principe

```
Boîtier NMK ──► serveur GPSwox de NMK (inchangé, l'application Gpswox continue de marcher)
                    ▲
                    │  lecture /api/get_devices, une fois par minute
                    │
        /api/telematics/gpswox/poll ──► telematics_positions (tenant NMK) ──► suivi, trajets, km
```

Vérifié le 13/10/2026 sans identifiants : `http://173.249.19.50/api/login` et `/api/get_devices` répondent en JSON (422 et 401), c'est bien une API GPSwox.

## Ce que fait le gestionnaire (écran Véhicules › Boîtiers)

1. **Connecter** : adresse du serveur, identifiant, mot de passe remis par le prestataire. Le mot de passe sert une fois, à obtenir la clé de lecture ; il n'est pas conservé.
2. **Cocher les véhicules à suivre**. Le véhicule M3A est proposé quand la plaque de GPSwox (ou celle écrite dans le nom) désigne un seul véhicule du parc.
3. Le signal apparaît dans la liste des boîtiers et dans Suivi GPS.

Pour ces boîtiers, l'écran ne propose aucun SMS de bascule : les repointer les ferait disparaître de la plateforme d'origine.

## Mise en service

| Étape | Qui | État |
|---|---|---|
| Appliquer `migrations/086-telematics-sources.sql` | sur go d'Abdou | à faire |
| Fusionner et déployer la branche `feat/gps-gpswox` | sur go d'Abdou | à faire |
| Connecter le compte depuis l'écran Boîtiers (admin NMK) | Abdou | à faire |
| Planifier la relève par minute (bloc pg_cron en bas de la 086, clé à déposer dans Vault) | sur go d'Abdou | à faire |

Tant que la relève n'est pas planifiée, le bouton « Relever maintenant » fait une lecture à la demande.

## Limites connues

- **Format non vérifié sur le serveur réel.** Le lecteur (`lib/telematics/gpswox.ts`) suit la documentation GPSwox et tolère ses variantes, mais aucune réponse authentifiée du serveur de NMK n'a encore été lue. La première connexion dira si un champ diffère (IMEI, `timestamp`).
- **Une position par relève.** `get_devices` ne donne que la dernière position : à une relève par minute, un trajet est tracé avec un point par minute, et les kilomètres (calculés de point en point) sont un peu sous-estimés dans les virages. Si l'écart avec le compteur est gênant, étape suivante : relire `/api/get_history`, qui rend tous les points.
- **Pas de rattrapage.** Une coupure de la relève laisse un trou : les positions manquées ne sont pas relues après coup (même remède : `get_history`).
- **État moteur** repris seulement si GPSwox l'envoie en booléen (`engine_status`) ; sinon il reste vide.
- **http sans chiffrement** sur le serveur actuel : la clé de lecture circule en clair entre Vercel et le serveur GPSwox. À faire corriger par le prestataire (https), et prévoir un compte en lecture seule.

## Sécurité

- La clé d'API vit dans `fleet.telematics_sources`, fermée à tout sauf au serveur (RLS sans policy) ; aucune route ne la renvoie.
- Un compte GPSwox n'écrit que dans le parc de l'organisation qui l'a connecté, et seulement pour les boîtiers qu'elle a cochés.
- L'adresse du serveur est contrôlée : les adresses internes sont refusées.
- Déconnecter efface la clé ; boîtiers et positions déjà reçues sont conservés.
