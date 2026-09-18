-- ============================================================
-- MIGRATION 060 — RECETTE RAPPORTÉE AU TEMPS DE SERVICE
--
-- Idempotente. ADDITIVE : reconstruit une vue, ne touche à aucune donnée.
--
-- Le rapprochement kilométrique répond à « le chauffeur a-t-il déclaré ce qu'il
-- a roulé ». Il ne répond pas à la question qui décide d'une exploitation :
-- « cette journée a-t-elle rapporté ». Deux chauffeurs qui déclarent 50 000 F
-- ne se valent pas si l'un a tenu douze heures de service et l'autre six.
--
-- D'où deux rapports, construits sur des mesures déjà en base :
--   • recette / heure de service — le temps réellement passé en service, borné
--     par le premier et le dernier mouvement du véhicule ;
--   • recette / km GPS — ce que rapporte le kilomètre réellement parcouru.
--
-- La recette n'est PAS recalculée ici : on lit `gross_earnings`, le montant que
-- l'application a elle-même établi (lib/reportNet.ts, modes « éléments réels »
-- ou « théorique »). Une vue qui referait ce calcul finirait par diverger de
-- l'écran, et deux chiffres contradictoires valent moins qu'un seul.
--
-- Trois honnêtetés :
--   • les journées [REPOS] sont marquées, pour ne jamais tirer une moyenne vers
--     zéro (règle établie en PR #59) ;
--   • un ratio n'est exploitable qu'au-dessus de 30 min de service — sur dix
--     minutes, il produit des milliers de francs par heure qui ne veulent rien
--     dire ;
--   • l'historique importé n'a pas de bornes de service mesurées : il est exclu
--     du rendement, jamais maquillé.
-- ============================================================

DROP VIEW IF EXISTS fleet.v_telematics_reconciliation;

CREATE VIEW fleet.v_telematics_reconciliation AS
WITH daily_prefere AS (
  -- Une seule ligne par véhicule et par jour : le calcul maison d'abord,
  -- l'import seulement à défaut.
  SELECT DISTINCT ON (tenant_id, vehicle_id, day) *
  FROM fleet.telematics_daily
  ORDER BY tenant_id, vehicle_id, day,
           (CASE WHEN method_version LIKE 'import-%' THEN 2 ELSE 1 END),
           computed_at DESC
),
jours AS (
  -- Le temps de service est la seule grandeur nouvelle, et elle se déduit de
  -- bornes déjà mesurées : premier et dernier mouvement constatés.
  SELECT
    d.*,
    CASE
      WHEN d.first_movement_at IS NULL OR d.last_movement_at IS NULL THEN NULL
      -- Un historique importé n'a pas de bornes de service mesurées : ses
      -- horodatages couvrent la fenêtre du fichier, pas une journée de travail.
      -- Sans cette exclusion, la vue annonçait « 27 h de service » pour une
      -- journée de 24 h — un chiffre que personne ne doit voir.
      WHEN d.method_version LIKE 'import-%' THEN NULL
      ELSE round(EXTRACT(EPOCH FROM (d.last_movement_at - d.first_movement_at))::numeric, 0)
    END AS service_s
  FROM daily_prefere d
),
reps AS (
  SELECT
    r.tenant_id,
    r.date,
    r.driver_id,
    r.end_odometer,
    COALESCE(r.vehicle_id, v2.id) AS vehicle_id,
    LAG(r.end_odometer) OVER (PARTITION BY r.driver_id ORDER BY r.date) AS prev_odometer,
    LAG(r.date)         OVER (PARTITION BY r.driver_id ORDER BY r.date) AS prev_date
  FROM fleet.daily_reports r
  LEFT JOIN fleet.vehicles v2 ON v2.driver_id = r.driver_id
  WHERE r.status = 'approved'
    AND r.end_odometer IS NOT NULL
),
declares AS (
  SELECT
    tenant_id, date, driver_id, vehicle_id,
    (date - prev_date)             AS jours_couverts,
    (end_odometer - prev_odometer) AS km_declares
  FROM reps
  WHERE prev_odometer IS NOT NULL
    AND end_odometer >= prev_odometer
),
recettes AS (
  -- Recette du véhicule pour la journée, tous chauffeurs confondus : depuis le
  -- multi-chauffeurs, deux conducteurs peuvent déclarer le même véhicule le
  -- même jour, et c'est bien le véhicule qui a produit la journée.
  --
  -- Le véhicule manquant est retrouvé par sous-requête, pas par jointure : une
  -- jointure sur le chauffeur dupliquerait la ligne s'il conduit plusieurs
  -- véhicules, et la somme compterait deux fois la même recette.
  SELECT
    r.tenant_id,
    r.date,
    COALESCE(
      r.vehicle_id,
      (SELECT v2.id FROM fleet.vehicles v2
        WHERE v2.driver_id = r.driver_id AND v2.tenant_id = r.tenant_id
        LIMIT 1)
    ) AS vehicle_id,
    SUM(r.gross_earnings)                                       AS recette,
    bool_or(COALESCE(r.comment, '') LIKE '%[REPOS]%')           AS repos
  FROM fleet.daily_reports r
  WHERE r.status = 'approved'
  GROUP BY 1, 2, 3
)
SELECT
  d.tenant_id,
  d.vehicle_id,
  v.plate,
  d.day,
  round((d.distance_m / 1000.0)::numeric, 2)                 AS km_gps,
  dc.km_declares,
  dc.jours_couverts,
  CASE WHEN dc.km_declares IS NULL THEN NULL
       ELSE round((d.distance_m / 1000.0)::numeric - dc.km_declares, 2)
  END                                                         AS ecart_km,
  CASE
    WHEN dc.km_declares IS NULL OR dc.km_declares = 0 THEN NULL
    ELSE round(
      100 * ((d.distance_m / 1000.0)::numeric - dc.km_declares) / dc.km_declares, 1)
  END                                                         AS ecart_pct,
  d.coverage,
  d.points,
  d.gaps_s,
  d.trips,
  d.moving_s,
  d.service_s,
  rc.recette,
  COALESCE(rc.repos, false)                                   AS repos,
  -- Ce que rapporte une heure passée en service, et un kilomètre parcouru.
  CASE
    WHEN rc.recette IS NULL OR d.service_s IS NULL OR d.service_s < 1800 THEN NULL
    ELSE round(rc.recette::numeric / (d.service_s::numeric / 3600.0), 0)
  END                                                         AS recette_par_heure_service,
  CASE
    WHEN rc.recette IS NULL OR d.distance_m IS NULL OR d.distance_m < 1000 THEN NULL
    ELSE round(rc.recette::numeric / (d.distance_m::numeric / 1000.0), 0)
  END                                                         AS recette_par_km,
  dc.driver_id,
  -- Origine de la mesure, pour que l'écran ne présente jamais un import
  -- comme une mesure faite par M3A.
  (CASE WHEN d.method_version LIKE 'import-%' THEN 'import' ELSE 'gps' END)
                                                              AS source,
  (
    dc.jours_couverts = 1
    AND (
      (d.method_version LIKE 'import-%' AND d.trips > 0)
      OR (d.coverage >= 0.8 AND d.points >= 100)
    )
  )                                                           AS ecart_exploitable,
  -- Un rendement ne vaut que sur une journée réellement observée, réellement
  -- travaillée, et assez longue pour que le rapport ait un sens.
  (
    rc.recette IS NOT NULL
    AND COALESCE(rc.repos, false) = false
    AND d.service_s >= 1800
    AND d.method_version NOT LIKE 'import-%'
    AND d.coverage >= 0.8
    AND d.points >= 100
  )                                                           AS rendement_exploitable,
  d.method_version
FROM jours d
JOIN fleet.vehicles v ON v.id = d.vehicle_id
LEFT JOIN declares dc
       ON dc.vehicle_id = d.vehicle_id
      AND dc.date       = d.day
      AND dc.tenant_id  = d.tenant_id
LEFT JOIN recettes rc
       ON rc.vehicle_id = d.vehicle_id
      AND rc.date       = d.day
      AND rc.tenant_id  = d.tenant_id;

GRANT SELECT ON fleet.v_telematics_reconciliation TO anon, authenticated, service_role;
