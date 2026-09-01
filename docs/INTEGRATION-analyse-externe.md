# Injecter une analyse externe dans le rapport d'activité

Le rapport mensuel de M3A Fleet fournit les **chiffres** (recette, commissions,
dépenses, rémunération, net final — calculés par le moteur, jamais recalculés
ailleurs). Un système d'analyse externe peut y ajouter sa **section d'analyse**.

## Principe : push, pas pull

Le système externe **pousse** son analyse quand elle est prête. La génération du
rapport la récupère si elle existe pour la période, sinon le rapport est rendu
sans cette section.

Ce sens est délibéré. Un cron mensuel qui appellerait une API tierce en synchrone
échouerait au premier timeout, et un rapport ne serait pas généré du tout. Ici,
l'indisponibilité du système externe ne dégrade que la section d'analyse.

```
Système multi-agents ──POST──▶ /api/integrations/report-analysis
                                        │
                                        ▼
                              fleet.report_analyses
                                        │
   cron du 1er / console opérateur ─────┴──▶ rapport HTML (section « Analyse »)
```

## Prérequis

1. Migration `migrations/046-report-analyses.sql` appliquée.
2. Variable d'environnement `REPORT_ANALYSIS_SECRET` définie (Vercel), valeur
   longue et aléatoire. Elle vaut pour tous les tenants ; le tenant visé est
   indiqué dans le corps de la requête.

## Envoyer une analyse

`POST /api/integrations/report-analysis`
`Authorization: Bearer $REPORT_ANALYSIS_SECRET`

```json
{
  "tenantSlug": "m3a",
  "dateFrom": "2026-08-01",
  "dateTo": "2026-08-31",
  "source": "multi-agent",
  "title": "Analyse multi-agents",
  "summary": "Marge nette à 18 %, portée par le hors-Yango. Le carburant reste le premier levier.",
  "model": "orchestrateur-v3",
  "blocks": [
    { "type": "heading", "text": "Rentabilité" },
    { "type": "paragraph", "text": "La marge progresse de 4 points sur un mois." },
    { "type": "kpis", "items": [
      { "label": "Marge nette", "value": "18 %", "sub": "vs 14 % en juillet" }
    ]},
    { "type": "bullets", "items": [
      "Le hors-Yango passe de 12 % à 22 % de la recette.",
      "Trois chauffeurs concentrent 61 % du net."
    ]},
    { "type": "insight", "level": "alert", "text": "Carburant à 26 % de la recette — au-dessus du seuil de 24 %." },
    { "type": "table",
      "columns": ["Chauffeur", "Net", "Tendance"],
      "align": ["l", "r", "l"],
      "rows": [["Awa", 320000, "▲ +12 %"], ["Moussa", 180000, "▼ −4 %"]]
    }
  ]
}
```

- `tenantSlug` **ou** `tenantId` (UUID). L'un des deux suffit.
- `source` permet plusieurs producteurs distincts sur une même période.
- Republier la même `(tenant, période, source)` **remplace** l'analyse précédente.
- Réponse : `{ ok, tenantId, period, source, blocks }`.

## Types de blocs

| Type | Champs | Rendu |
|---|---|---|
| `heading` | `text` | Sous-titre de section |
| `paragraph` | `text` | Paragraphe |
| `bullets` | `items[]` | Liste à puces |
| `insight` | `text`, `level` (`info`\|`ok`\|`warn`\|`alert`) | Encadré coloré |
| `kpis` | `items[]` (`label`, `value`, `sub?`) | Tuiles chiffrées |
| `table` | `columns[]`, `rows[][]`, `align?[]` (`l`\|`r`) | Tableau |

Un type inconnu ou un bloc malformé renvoie **400** avec la position du bloc
fautif (`blocs[3] : type « html » inconnu`). Le rapport n'est jamais rendu avec
une section silencieusement tronquée.

## Pas de HTML brut — et pourquoi

Le rapport est servi par `/api/admin/report-file` en `text/html` **sur l'origine
de l'application**, celle qui porte les cookies de session Supabase de l'admin.
Accepter du HTML depuis un producteur externe ferait de cette intégration un
vecteur XSS vers ces sessions. Tout le contenu entrant est donc échappé au rendu,
et le seul balisage possible est celui produit par les blocs ci-dessus.

Si un rendu manque, la bonne réponse est d'ajouter un type de bloc, pas d'ouvrir
une brèche HTML.

## Limites

| | |
|---|---|
| Blocs par analyse | 200 |
| Longueur d'un texte | 4 000 caractères (tronqué au-delà) |
| Éléments d'une liste / de KPIs | 100 |
| Lignes de tableau | 200 |
| Colonnes de tableau | 12 |
| Longueur d'une cellule | 200 caractères |

## Vérifier une intégration

Sans générer de rapport :

```bash
curl -H "Authorization: Bearer $REPORT_ANALYSIS_SECRET" \
  "https://<app>/api/integrations/report-analysis?tenantSlug=m3a"
```

Renvoie les 24 dernières analyses stockées (période, source, modèle, date de
réception, nombre de blocs).

## Ordre d'exploitation

1. Le système externe pousse l'analyse de la période.
2. L'opérateur génère le rapport (console → « Générer »), ou le cron du 1er le fait.
3. Le client ouvre le rapport dans Exporter → 📁 Rapports reçus : la section
   « Analyse » y figure, après « Ce qu'il faut retenir ».

Si l'analyse est poussée **après** la génération, régénérer le rapport : la
console demandera confirmation, puisque le client a déjà reçu la version
précédente.
