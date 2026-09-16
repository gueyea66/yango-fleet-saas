-- ============================================================
-- MIGRATION 050 — COUCHE ANALYTIQUE TÉLÉMATIQUE
--
-- Dépend de la 049. Idempotente : réexécutable sans effet de bord.
-- ADDITIVE : ne modifie aucune table existante du produit.
--
-- Trois tables dérivées, toutes RECALCULABLES depuis les positions brutes.
-- Elles portent `method_version` : quand la méthode d'inférence s'améliore
-- (notamment après calibration du moteur), on efface la version périmée et on
-- rejoue depuis le brut, sans avoir perdu d'historique.
--
-- Conception détaillée : docs/TELEMATICS/02-ANALYTICS-DESIGN.md
-- ============================================================

-- ════════════════ A — TRAJETS ════════════════
-- Un trajet est une INFÉRENCE (déplacement continu entre deux arrêts), pas une
-- mesure. D'où `confidence` et `evidence` obligatoires à côté des chiffres.

CREATE TABLE IF NOT EXISTS fleet.telematics_trips (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  device_id             UUID NOT NULL REFERENCES fleet.telematics_devices(id) ON DELETE CASCADE,
  vehicle_id            UUID REFERENCES fleet.vehicles(id) ON DELETE SET NULL,

  started_at            TIMESTAMPTZ NOT NULL,
  ended_at              TIMESTAMPTZ NOT NULL,
  start_latitude        DOUBLE PRECISION NOT NULL,
  start_longitude       DOUBLE PRECISION NOT NULL,
  end_latitude          DOUBLE PRECISION NOT NULL,
  end_longitude         DOUBLE PRECISION NOT NULL,

  distance_m            DOUBLE PRECISION NOT NULL,
  duration_s            INTEGER NOT NULL,
  moving_s              INTEGER NOT NULL,
  idle_s                INTEGER NOT NULL,
  max_speed_kmh         DOUBLE PRECISION,
  avg_moving_speed_kmh  DOUBLE PRECISION,

  points                INTEGER NOT NULL,
  gaps_s                INTEGER NOT NULL DEFAULT 0,
  jumps_dropped         INTEGER NOT NULL DEFAULT 0,
  confidence            NUMERIC(3,2) NOT NULL,
  evidence              JSONB NOT NULL DEFAULT '{}'::jsonb,

  method_version        TEXT NOT NULL,
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT telematics_trips_order_chk CHECK (ended_at >= started_at),
  CONSTRAINT telematics_trips_conf_chk  CHECK (confidence BETWEEN 0 AND 1),
  UNIQUE (device_id, started_at, method_version)
);

CREATE INDEX IF NOT EXISTS idx_telematics_trips_vehicle_time
  ON fleet.telematics_trips(tenant_id, vehicle_id, started_at DESC);

-- ════════════════ B — ÉVÉNEMENTS DÉRIVÉS ════════════════
-- Socle du Mission Engine (brief §12) : les faits existent AVANT les missions,
-- pour qu'une mission créée demain se raccroche à un passé déjà capté.

CREATE TABLE IF NOT EXISTS fleet.telematics_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  device_id       UUID NOT NULL REFERENCES fleet.telematics_devices(id) ON DELETE CASCADE,
  vehicle_id      UUID REFERENCES fleet.vehicles(id) ON DELETE SET NULL,
  trip_id         UUID REFERENCES fleet.telematics_trips(id) ON DELETE CASCADE,

  type            TEXT NOT NULL,
  -- TRIP_STARTED | TRIP_ENDED | LONG_STOP | GPS_OFFLINE
  -- (et plus tard : ORIGIN_EXIT, DESTINATION_ENTRY, LATE_ARRIVAL…)
  occurred_at     TIMESTAMPTZ NOT NULL,
  latitude        DOUBLE PRECISION,
  longitude       DOUBLE PRECISION,

  confidence      NUMERIC(3,2) NOT NULL DEFAULT 1,
  evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
  method_version  TEXT NOT NULL,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (device_id, type, occurred_at, method_version)
);

CREATE INDEX IF NOT EXISTS idx_telematics_events_vehicle_time
  ON fleet.telematics_events(tenant_id, vehicle_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_telematics_events_type
  ON fleet.telematics_events(type, occurred_at DESC);

-- ════════════════ C — AGRÉGAT JOURNALIER ════════════════
-- Table et non vue : c'est le plan de travail des analyses lourdes, et il doit
-- rester lisible sans rebalayer des centaines de milliers de positions.

CREATE TABLE IF NOT EXISTS fleet.telematics_daily (
  tenant_id           UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  device_id           UUID NOT NULL REFERENCES fleet.telematics_devices(id) ON DELETE CASCADE,
  vehicle_id          UUID REFERENCES fleet.vehicles(id) ON DELETE SET NULL,
  day                 DATE NOT NULL,

  distance_m          DOUBLE PRECISION NOT NULL DEFAULT 0,
  moving_s            INTEGER NOT NULL DEFAULT 0,
  idle_s              INTEGER NOT NULL DEFAULT 0,
  trips               INTEGER NOT NULL DEFAULT 0,
  points              INTEGER NOT NULL DEFAULT 0,
  gaps_s              INTEGER NOT NULL DEFAULT 0,
  jumps_dropped       INTEGER NOT NULL DEFAULT 0,
  -- Part du temps observé réellement documentée par le boîtier. Sans elle, un
  -- écart de kilométrage n'est pas interprétable (et ne doit pas être montré).
  coverage            NUMERIC(3,2) NOT NULL DEFAULT 0,
  first_movement_at   TIMESTAMPTZ,
  last_movement_at    TIMESTAMPTZ,
  max_speed_kmh       DOUBLE PRECISION,

  method_version      TEXT NOT NULL,
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (device_id, day, method_version)
);

CREATE INDEX IF NOT EXISTS idx_telematics_daily_vehicle_day
  ON fleet.telematics_daily(tenant_id, vehicle_id, day DESC);

-- ════════════════ D — RAPPROCHEMENT : LE CHIFFRE QUI RAPPORTE ════════════════
-- Km réellement parcourus face aux km déclarés au compteur par le chauffeur.
-- La couverture GPS est exposée À CÔTÉ de l'écart, jamais séparément : un
-- écart calculé sur une journée à moitié captée ne prouve rien, et présenter
-- l'un sans l'autre fabriquerait des accusations invérifiables.

-- Règle du km déclaré, alignée sur celle du produit (lib/hooks/usePilotage.ts) :
-- la base de production n'a PAS de `start_odometer`. Le kilométrage d'une
-- journée est donc le DELTA d'odomètre entre deux déclarations successives du
-- MÊME CHAUFFEUR. Reproduire ici une autre règle produirait deux vérités
-- concurrentes dans le même produit.
--
-- Deux réalités de terrain constatées le 15/09/2026 et traitées explicitement :
--   • 73 déclarations sur 160 n'ont pas de `vehicle_id` → repli sur le véhicule
--     actuellement affecté au chauffeur ;
--   • une déclaration peut sauter des jours → le delta couvre alors plusieurs
--     journées et n'est PAS comparable à une journée GPS. `jours_couverts` le
--     dit, et `ecart_exploitable` le refuse.

CREATE OR REPLACE VIEW fleet.v_telematics_reconciliation AS
WITH reps AS (
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
  -- Seules les déclarations validées font foi (même filtre que les KPI).
  WHERE r.status = 'approved'
    AND r.end_odometer IS NOT NULL
),
declares AS (
  SELECT
    tenant_id, date, driver_id, vehicle_id,
    (date - prev_date)                     AS jours_couverts,
    (end_odometer - prev_odometer)         AS km_declares
  FROM reps
  WHERE prev_odometer IS NOT NULL
    AND end_odometer >= prev_odometer      -- un compteur ne recule pas
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
  -- Un écart n'est montrable que si la journée GPS est bien couverte ET que le
  -- delta déclaré porte bien sur cette seule journée. Sinon on affiche les deux
  -- chiffres, jamais leur différence.
  (d.coverage >= 0.8 AND d.points >= 100 AND dc.jours_couverts = 1)
                                                              AS ecart_exploitable,
  d.method_version
FROM fleet.telematics_daily d
JOIN fleet.vehicles v ON v.id = d.vehicle_id
LEFT JOIN declares dc
       ON dc.vehicle_id = d.vehicle_id
      AND dc.date       = d.day
      AND dc.tenant_id  = d.tenant_id;

-- ════════════════ E — ÉCRITURE RÉSERVÉE AU SERVEUR ════════════════
-- Ces tables sont produites par le calcul, jamais par un utilisateur.

CREATE OR REPLACE FUNCTION fleet.guard_telematics_derived()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF fleet.is_trusted_server() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'donnée dérivée : écriture réservée au serveur de calcul';
END $$;

DROP TRIGGER IF EXISTS guard_telematics_trips_iud ON fleet.telematics_trips;
CREATE TRIGGER guard_telematics_trips_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.telematics_trips
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_telematics_derived();

DROP TRIGGER IF EXISTS guard_telematics_events_iud ON fleet.telematics_events;
CREATE TRIGGER guard_telematics_events_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.telematics_events
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_telematics_derived();

DROP TRIGGER IF EXISTS guard_telematics_daily_iud ON fleet.telematics_daily;
CREATE TRIGGER guard_telematics_daily_iud
  BEFORE INSERT OR UPDATE OR DELETE ON fleet.telematics_daily
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_telematics_derived();

-- ════════════════ F — RLS ════════════════
ALTER TABLE fleet.telematics_trips  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.telematics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.telematics_daily  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telematics_trips_tenant_read ON fleet.telematics_trips;
CREATE POLICY telematics_trips_tenant_read ON fleet.telematics_trips
  FOR SELECT USING (tenant_id = fleet.current_tenant_id());

DROP POLICY IF EXISTS telematics_events_tenant_read ON fleet.telematics_events;
CREATE POLICY telematics_events_tenant_read ON fleet.telematics_events
  FOR SELECT USING (tenant_id = fleet.current_tenant_id());

DROP POLICY IF EXISTS telematics_daily_tenant_read ON fleet.telematics_daily;
CREATE POLICY telematics_daily_tenant_read ON fleet.telematics_daily
  FOR SELECT USING (tenant_id = fleet.current_tenant_id());

GRANT SELECT ON fleet.telematics_trips, fleet.telematics_events, fleet.telematics_daily
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON fleet.telematics_trips, fleet.telematics_events, fleet.telematics_daily
  TO service_role;
GRANT SELECT ON fleet.v_telematics_reconciliation TO anon, authenticated, service_role;
