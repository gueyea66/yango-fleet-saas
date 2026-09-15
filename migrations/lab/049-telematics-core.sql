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
