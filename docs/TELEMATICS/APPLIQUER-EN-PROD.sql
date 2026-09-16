-- ============================================================
-- M3A FLEET - SOCLE TELEMATIQUE (migrations 049 + 050)
-- A coller dans Supabase Dashboard > SQL Editor > Run.
--
-- ADDITIF : cree uniquement des tables nouvelles prefixees telematics_*.
-- Aucune table existante n'est modifiee, aucune donnee existante touchee.
-- Idempotent : peut etre relance sans effet de bord.
--
-- Pour tout annuler :
--   drop view if exists fleet.v_telematics_reconciliation, fleet.v_telematics_daily_km;
--   drop table if exists fleet.telematics_events, fleet.telematics_trips,
--     fleet.telematics_daily, fleet.telematics_positions, fleet.telematics_devices cascade;
-- ============================================================

-- ============================================================
-- MIGRATION LAB 049 — SOCLE TÉLÉMATIQUE NORMALISÉ
--
-- ⚠️  À exécuter UNIQUEMENT sur le projet Supabase « lab ».
--     Ne PAS appliquer à la production M3A Fleet tant que le modèle n'a pas
--     tenu sur le terrain (décision Abdou du 15/09/2026).
--
-- Idempotente : réexécutable sans effet de bord.
--
-- Principe (brief §6, §7, §21) : le GPS est une SOURCE DE DONNÉES, pas une
-- carte. Le métier ne connaît jamais le fabricant du boîtier — il lit des
-- positions normalisées. Un seul objet VEHICLE, déjà existant : on ne crée
-- aucun véhicule parallèle, on y rattache un boîtier.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS fleet;

-- ── Helpers : présents en prod depuis la 039. La base lab peut ne pas les
--    avoir ; on les crée alors dans leur version minimale, sans jamais
--    écraser ceux de la prod s'ils existent déjà.
DO $$
BEGIN
  IF to_regprocedure('fleet.is_trusted_server()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION fleet.is_trusted_server() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
      AS 'SELECT coalesce(current_setting(''request.jwt.claim.role'', true), '''') = ''service_role''';
    $fn$;
  END IF;
  IF to_regprocedure('fleet.current_tenant_id()') IS NULL THEN
    EXECUTE $fn$
      CREATE FUNCTION fleet.current_tenant_id() RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
      AS 'SELECT tenant_id FROM fleet.profiles WHERE id = auth.uid()';
    $fn$;
  END IF;
END $$;

-- ════════════════ A — BOÎTIERS ════════════════
-- Un boîtier appartient à un tenant et équipe au plus un véhicule à la fois.
-- `vendor` + `external_id` = l'identité côté fabricant (pour SinoTrack :
-- le Device ID imprimé sur le boîtier, celui qui voyage dans la trame H02).

CREATE TABLE IF NOT EXISTS fleet.telematics_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  vehicle_id    UUID REFERENCES fleet.vehicles(id) ON DELETE SET NULL,
  vendor        TEXT NOT NULL,              -- sinotrack | teltonika | concox | simulator
  model         TEXT,                       -- ST-901-868L
  external_id   TEXT NOT NULL,              -- Device ID fabricant (ex. 9170258210)
  protocol      TEXT NOT NULL DEFAULT 'h02',
  sim_msisdn    TEXT,
  label         TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  last_seen_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (vendor, external_id)
);

CREATE INDEX IF NOT EXISTS idx_telematics_devices_tenant
  ON fleet.telematics_devices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_telematics_devices_vehicle
  ON fleet.telematics_devices(vehicle_id);

-- ════════════════ B — POSITIONS NORMALISÉES ════════════════
-- Append-only. Le brut (`raw`) est conservé : c'est la preuve, et c'est ce qui
-- permettra de recalculer après coup quand la sémantique du masque de statut
-- aura été calibrée sur le terrain.
--
-- Champs volontairement NULL tant qu'ils ne sont pas prouvés :
--   ignition   — masque de statut non calibré (cf. 00-GAP-ANALYSIS.md §2.4)
--   odometer_m — le ST-901 n'envoie pas d'odomètre fiable ; la distance est
--                calculée à partir des positions, jamais lue du boîtier.

CREATE TABLE IF NOT EXISTS fleet.telematics_positions (
  id            BIGSERIAL PRIMARY KEY,
  tenant_id     UUID NOT NULL REFERENCES fleet.tenants(id) ON DELETE CASCADE,
  device_id     UUID NOT NULL REFERENCES fleet.telematics_devices(id) ON DELETE CASCADE,
  vehicle_id    UUID REFERENCES fleet.vehicles(id) ON DELETE SET NULL,

  recorded_at   TIMESTAMPTZ NOT NULL,       -- horodatage APPAREIL (fait foi)
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  latitude      DOUBLE PRECISION NOT NULL,
  longitude     DOUBLE PRECISION NOT NULL,
  speed_kmh     DOUBLE PRECISION,
  heading       DOUBLE PRECISION,
  altitude_m    DOUBLE PRECISION,
  satellites    SMALLINT,
  valid_fix     BOOLEAN NOT NULL DEFAULT true,

  ignition      BOOLEAN,                    -- NULL = non calibré, jamais deviné
  odometer_m    BIGINT,
  battery_v     NUMERIC,
  external_v    NUMERIC,

  event_type    TEXT,                       -- position | sos | overspeed | ...
  protocol      TEXT NOT NULL DEFAULT 'h02',
  status_raw    TEXT,                       -- masque brut, non interprété
  raw           JSONB,                      -- trame d'origine + champs non mappés

  CONSTRAINT telematics_positions_lat_chk CHECK (latitude  BETWEEN  -90 AND  90),
  CONSTRAINT telematics_positions_lon_chk CHECK (longitude BETWEEN -180 AND 180),

  -- Idempotence (brief §8) : rejouer la même trame ne crée pas de doublon.
  -- Le boîtier réémet en boucle après une coupure réseau ; sans cette clé, un
  -- trajet compté deux fois doublerait les km.
  UNIQUE (device_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_telematics_positions_vehicle_time
  ON fleet.telematics_positions(tenant_id, vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_telematics_positions_device_time
  ON fleet.telematics_positions(device_id, recorded_at DESC);

-- ── Append-only : personne ne réécrit l'histoire d'un véhicule.
CREATE OR REPLACE FUNCTION fleet.guard_telematics_append_only()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'telematics_positions est append-only (% refusé)', TG_OP;
END $$;

DROP TRIGGER IF EXISTS guard_telematics_positions_ud ON fleet.telematics_positions;
CREATE TRIGGER guard_telematics_positions_ud
  BEFORE UPDATE OR DELETE ON fleet.telematics_positions
  FOR EACH ROW EXECUTE FUNCTION fleet.guard_telematics_append_only();

-- ── Cohérence : le véhicule de la position est celui du boîtier, et le
--    tenant suit le boîtier. L'ingestion n'a donc pas à être crue sur parole.
CREATE OR REPLACE FUNCTION fleet.telematics_position_fill()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE d RECORD;
BEGIN
  SELECT tenant_id, vehicle_id INTO d
  FROM fleet.telematics_devices WHERE id = NEW.device_id;

  IF d IS NULL THEN
    RAISE EXCEPTION 'boîtier inconnu';
  END IF;

  NEW.tenant_id  := d.tenant_id;
  NEW.vehicle_id := COALESCE(NEW.vehicle_id, d.vehicle_id);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS telematics_position_fill_i ON fleet.telematics_positions;
CREATE TRIGGER telematics_position_fill_i
  BEFORE INSERT ON fleet.telematics_positions
  FOR EACH ROW EXECUTE FUNCTION fleet.telematics_position_fill();

-- ════════════════ C — RLS ════════════════
-- Lecture réservée à l'organisation propriétaire. Écriture : serveur de
-- confiance uniquement (la passerelle passe par la route d'ingestion, qui
-- utilise la service_role — jamais la clé anon du bundle client).

ALTER TABLE fleet.telematics_devices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.telematics_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telematics_devices_tenant_read ON fleet.telematics_devices;
CREATE POLICY telematics_devices_tenant_read ON fleet.telematics_devices
  FOR SELECT USING (tenant_id = fleet.current_tenant_id());

DROP POLICY IF EXISTS telematics_positions_tenant_read ON fleet.telematics_positions;
CREATE POLICY telematics_positions_tenant_read ON fleet.telematics_positions
  FOR SELECT USING (tenant_id = fleet.current_tenant_id());

GRANT USAGE ON SCHEMA fleet TO anon, authenticated, service_role;
GRANT SELECT ON fleet.telematics_devices, fleet.telematics_positions
  TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON fleet.telematics_devices TO service_role;
GRANT SELECT, INSERT ON fleet.telematics_positions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE fleet.telematics_positions_id_seq TO service_role;

-- ════════════════ D — VUE : KM GPS PAR VÉHICULE ET PAR JOUR ════════════════
-- Distance par la formule de Haversine entre points successifs. Les sauts
-- aberrants (> 3 km entre deux points, soit > 360 km/h à 30 s d'intervalle)
-- sont écartés : ce sont des dérives de fix, pas des kilomètres parcourus.
-- Les points sans fix valide ne comptent jamais.

CREATE OR REPLACE VIEW fleet.v_telematics_daily_km AS
WITH pts AS (
  SELECT
    tenant_id, vehicle_id, device_id, recorded_at, latitude, longitude,
    (recorded_at AT TIME ZONE 'Africa/Dakar')::date AS day_local,
    LAG(latitude)  OVER w AS prev_lat,
    LAG(longitude) OVER w AS prev_lon
  FROM fleet.telematics_positions
  WHERE valid_fix
  WINDOW w AS (PARTITION BY device_id ORDER BY recorded_at)
),
legs AS (
  SELECT
    tenant_id, vehicle_id, device_id, day_local,
    2 * 6371000 * asin(sqrt(
      power(sin(radians(latitude - prev_lat) / 2), 2) +
      cos(radians(prev_lat)) * cos(radians(latitude)) *
      power(sin(radians(longitude - prev_lon) / 2), 2)
    )) AS meters
  FROM pts
  WHERE prev_lat IS NOT NULL
)
SELECT
  tenant_id, vehicle_id, device_id, day_local,
  round((sum(meters) FILTER (WHERE meters <= 3000) / 1000.0)::numeric, 2) AS km_gps,
  count(*) FILTER (WHERE meters > 3000) AS sauts_ecartes,
  count(*) AS points
FROM legs
GROUP BY tenant_id, vehicle_id, device_id, day_local;

GRANT SELECT ON fleet.v_telematics_daily_km TO anon, authenticated, service_role;

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
