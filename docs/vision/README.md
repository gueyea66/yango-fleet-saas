# Vision — Système M3A

Cadre stratégique de référence d'Abdoulaye : l'architecture du groupe (Advisory /
Solutions / Ventures), les règles de tri des opportunités, et les critères du point
de bascule salariat → entrepreneuriat.

## Contenu

| Fichier | Rôle |
|---|---|
| `MASTER-CONTEXT.md` | Le texte source, sans mise en forme. Source de vérité. |
| `systeme-m3a.html`  | Le document interactif : one-pager, diagrammes, filtre à 10 questions, tableau de bord du point de bascule. |

## Le document interactif

Page autonome (aucun build, aucune dépendance runtime). Ouvrir le fichier dans un
navigateur, ou le publier comme artifact.

Trois outils y sont opérationnels :

- **§04 Router un problème** — trois questions, une orientation : consulting, custom
  solution ou produit.
- **§06 Filtre à dix questions** — notation 0-3 par critère, score /30, verdict.
  Trois critères sont bloquants (problème réel, payeur, preuve).
- **§07 Point de bascule** — saisie des chiffres réels, indice pondéré 0-100,
  comparaison salariat / cash-flow de l'écosystème.

Les saisies sont conservées dans le `localStorage` du navigateur : elles restent sur
la machine, ne sont pas partagées et ne sortent pas de la page.

## Mise à jour

Le document est vivant. Toute modification de la stratégie se reporte d'abord dans
`MASTER-CONTEXT.md`, puis dans la page.
