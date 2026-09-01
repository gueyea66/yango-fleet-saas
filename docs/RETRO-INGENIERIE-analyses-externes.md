# Retrouver comment les analyses externes ont été produites

Reconstitution à partir des deux livrables de juillet 2026 (`rapport202607.pdf`,
`deepdive202607.pdf`) et du code de M3A Fleet. Objectif : retrouver le chemin de
données pour pouvoir reproduire, corriger ou automatiser la chaîne.

## 1. Toutes les métriques viennent de deux sources, et de deux seulement

Chaque chiffre des deux documents se dérive de `fleet.daily_reports` et
`fleet.expenses`. Aucune ne nécessite d'autre table.

| Métrique du deep dive | Dérivée de |
|---|---|
| CA Yango moyen par jour de semaine | `daily_reports.yango_gross` groupé par `ISODOW(date)` |
| Courses / jour | `yango_trip_count` |
| Panier moyen | `yango_gross / yango_trip_count` |
| Hors-app moyen | `off_yango_revenue` |
| « TOTAL jour » | `yango_gross + off_yango_revenue` |
| Semaines S25 → S31 | `to_char(date, 'IYYY-IW')` |
| Km / jour | delta de `end_odometer` d'un jour sur l'autre, par chauffeur |
| CA / km | `yango_gross` ÷ delta odomètre |
| Carburant / km | `expenses` catégorie `Carburant` ÷ delta odomètre |
| Carburant % CA | `expenses` Carburant ÷ recette |
| Hors-app % CA | `off_yango_revenue` ÷ recette |
| Ponction Yango (17,2-17,7 %) | `commission_amount / yango_gross` |
| « 66 rapports » | nombre de lignes `daily_reports` sur la période |

Deux conventions du moteur sont respectées dans les documents, ce qui confirme
que la source est bien l'app et non une saisie parallèle :

- les jours de repos sont **exclus** des calculs — ce sont les rapports dont
  `comment` commence par `[REPOS]` ;
- seuls les rapports `status = 'approved'` alimentent les totaux financiers.

## 2. L'accès s'est très probablement fait par l'export CSV

L'indice décisif : les deux documents écrivent que **« le croisement
chauffeur×véhicule reste à faire »**.

Or `vehicle_id` **est** dans `fleet.daily_reports`, et la requête de
`/api/admin/export?resource=reports` le sélectionne déjà. Mais il n'était pas
écrit dans le CSV : la colonne était récupérée puis abandonnée avant l'écriture
(corrigé depuis — une colonne « Véhicule » est désormais exportée).

Un système branché en direct sur Postgres ou sur l'API REST Supabase aurait eu
`vehicle_id` sans effort. Le fait que ce croisement précis soit resté impossible,
alors que tout le reste a été calculé, désigne l'export CSV comme source.

Chemin correspondant : **Admin → Exporter → « Rapports journaliers »** et
**« Dépenses »**, sur la période voulue.

- `rapports_<date>.csv` : Date, Chauffeur, Compteur km, Brut Yango, Bonus Yango,
  Hors Yango, Commission, Net après charges, Solde wallet, Courses Yango,
  Courses hors, Statut, Commentaire — et désormais Véhicule.
- `depenses_<date>.csv` : Date, Chauffeur, Catégorie, Montant, Description, Statut.

Format Excel FR : séparateur `;`, BOM UTF-8. Réservé au plan **Pro**.

### Pistes si ce n'était pas le CSV

- **Logs Supabase** — Dashboard → Logs → API/Postgres, filtrer sur la période du
  02/08/2026 (date de génération des deux PDF). Le `user_agent` et l'IP
  identifieront le client.
- **`fleet.audit_logs`** — les actions d'export ne sont pas tracées, mais les
  connexions admin le sont.
- **Clés d'API** — Supabase → Settings → API : une clé service role utilisée
  ailleurs qu'en prod indique un accès direct.
- **Dossier de téléchargements** au 02/08/2026 : la présence de
  `rapports_2026-08-02.csv` trancherait immédiatement.

## 3. Reproduire les tableaux du deep dive

À exécuter dans Supabase SQL Editor. Remplacer `:tenant`, `:du`, `:au`.

### Base commune

```sql
CREATE TEMP VIEW jours AS
SELECT r.driver_id, r.date, r.vehicle_id,
       r.yango_gross, r.yango_bonus, r.off_yango_revenue,
       r.commission_amount, r.yango_trip_count, r.end_odometer,
       r.end_odometer - LAG(r.end_odometer)
         OVER (PARTITION BY r.driver_id ORDER BY r.date) AS km
  FROM fleet.daily_reports r
 WHERE r.tenant_id = :tenant
   AND r.date BETWEEN :du AND :au
   AND r.status = 'approved'
   AND COALESCE(r.comment, '') NOT LIKE '[REPOS]%';
```

### 1. La semaine type

```sql
SELECT to_char(date, 'TMDay')                                AS jour,
       ROUND(AVG(yango_gross))                               AS ca_yango_moy,
       ROUND(AVG(yango_trip_count), 1)                       AS courses_jour,
       ROUND(AVG(yango_gross) / NULLIF(AVG(yango_trip_count), 0)) AS panier_moy,
       ROUND(AVG(off_yango_revenue))                         AS hors_app_moy,
       ROUND(AVG(yango_gross + off_yango_revenue))           AS total_jour
  FROM jours
 GROUP BY EXTRACT(ISODOW FROM date), to_char(date, 'TMDay')
 ORDER BY EXTRACT(ISODOW FROM date);
```

### 2. Le film des semaines

```sql
SELECT to_char(date, 'IYYY-"S"IW')        AS semaine,
       COUNT(DISTINCT driver_id)          AS chauffeurs,
       SUM(yango_gross)                   AS ca_yango,
       SUM(off_yango_revenue)             AS hors_app,
       SUM(yango_gross + off_yango_revenue) AS total,
       SUM(yango_trip_count)              AS courses,
       ROUND(SUM(yango_gross) / NULLIF(SUM(yango_trip_count), 0)) AS panier
  FROM jours
 GROUP BY 1 ORDER BY 1;
```

### 3. Les styles de chauffeur

```sql
WITH carb AS (
  SELECT driver_id, SUM(amount) AS carburant
    FROM fleet.expenses
   WHERE tenant_id = :tenant AND category = 'Carburant'
     AND expense_date BETWEEN :du AND :au
   GROUP BY driver_id
)
SELECT p.full_name,
       COUNT(*)                                      AS jours,
       ROUND(AVG(j.yango_gross + j.off_yango_revenue)) AS ca_jour,
       ROUND(AVG(j.yango_trip_count), 1)             AS courses_j,
       ROUND(AVG(j.yango_gross) / NULLIF(AVG(j.yango_trip_count), 0)) AS panier,
       ROUND(AVG(j.km))                              AS km_jour,
       ROUND(SUM(j.yango_gross) / NULLIF(SUM(j.km), 0), 1)  AS ca_km,
       ROUND(MAX(c.carburant) / NULLIF(SUM(j.km), 0), 1)    AS carburant_km,
       ROUND(100.0 * SUM(j.commission_amount) / NULLIF(SUM(j.yango_gross), 0), 1) AS ponction_yango_pct
  FROM jours j
  JOIN fleet.profiles p ON p.id = j.driver_id
  LEFT JOIN carb c ON c.driver_id = j.driver_id
 GROUP BY p.full_name
 ORDER BY ca_jour DESC;
```

### 4. Le croisement chauffeur × véhicule (celui qui manquait)

```sql
WITH carb AS (
  SELECT driver_id, SUM(amount) AS carburant
    FROM fleet.expenses
   WHERE tenant_id = :tenant AND category = 'Carburant'
     AND expense_date BETWEEN :du AND :au
   GROUP BY driver_id
)
SELECT p.full_name, v.plate, v.make, v.model,
       COUNT(*)                                            AS jours,
       SUM(j.km)                                           AS km,
       ROUND(MAX(c.carburant) / NULLIF(SUM(j.km), 0), 1)   AS carburant_km
  FROM jours j
  JOIN fleet.profiles p ON p.id = j.driver_id
  LEFT JOIN fleet.vehicles v ON v.id = j.vehicle_id
  LEFT JOIN carb c ON c.driver_id = j.driver_id
 GROUP BY p.full_name, v.plate, v.make, v.model
 ORDER BY carburant_km DESC NULLS LAST;
```

Réserve : `carburant_km` répartit ici le carburant du chauffeur sur tous ses
kilomètres. Si un chauffeur a changé de véhicule dans la période, il faut d'abord
rattacher chaque dépense à un véhicule — `fleet.expenses` ne porte pas de
`vehicle_id`, seul le `vehicle_id` du rapport du jour permet l'imputation.

## 4. Ce que les documents disent manquer

Le deep dive identifie trois champs absents du rapport quotidien, nécessaires
au « palier suivant » : **note Yango du jour**, **nombre d'annulations**,
**heures de début et de fin de service**. Aucun n'existe dans
`fleet.daily_reports` aujourd'hui — c'est une évolution de schéma et de
formulaire, pas un problème d'accès aux données.

## 5. Automatiser plutôt que rejouer à la main

Une fois la chaîne retrouvée, le résultat n'a plus à repartir en PDF manuel :
`POST /api/integrations/report-analysis` accepte l'analyse en blocs structurés et
la publie dans l'app — en section du rapport mensuel, ou en document autonome
pour un deep dive à cheval sur deux mois. Voir
`docs/INTEGRATION-analyse-externe.md`.
