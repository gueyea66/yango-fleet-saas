-- ============================================================
-- MIGRATION 054 — HISTORIQUE IMPORTÉ DEPUIS LA PLATEFORME D'ORIGINE
--
-- Idempotente. Ne crée aucune table : remplace la vue de rapprochement.
--
-- Un client arrive avec des mois d'historique chez son fournisseur GPS
-- (SinoTrack, Wialon, autre). Cet historique vaut de l'argent : croisé aux
-- déclarations, il montre les écarts AVANT même d'avoir basculé un boîtier.
--
-- Ces trajets ne sont pas calculés par nous : ils viennent du fournisseur,
-- qui disposait de la totalité des points. On les distingue donc par leur
-- `method_version` (« import-... ») et on ne leur applique pas les mêmes
-- critères de fiabilité qu'à nos propres calculs :
--   • nos journées exigent une couverture ≥ 80 % ET ≥ 100 points reçus ;
--   • une journée importée est jugée sur la présence de trajets, puisque
--     les points bruts ne sont pas fournis par l'export.
--
-- Quand une journée existe dans les deux mondes, NOS données priment : elles
-- sont vérifiables jusqu'à la position brute.
-- ============================================================

-- La vue gagne une colonne `source` : PostgreSQL refuse de la remplacer en
-- place (CREATE OR REPLACE n'autorise pas l'insertion d'une colonne), on la
-- reconstruit. Aucune donnée n'est concernée — une vue ne stocke rien.
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
  d.method_version
FROM daily_prefere d
JOIN fleet.vehicles v ON v.id = d.vehicle_id
LEFT JOIN declares dc
       ON dc.vehicle_id = d.vehicle_id
      AND dc.date       = d.day
      AND dc.tenant_id  = d.tenant_id;

GRANT SELECT ON fleet.v_telematics_reconciliation TO anon, authenticated, service_role;
