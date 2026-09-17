import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { buildTrips, METHOD_VERSION, type RawPoint } from "@/lib/telematics/trips";
import { resoudreAdresses, cleCache } from "@/lib/telematics/geocode";

/**
 * Recalcul des données dérivées : positions brutes → trajets, événements,
 * agrégat journalier.
 *
 * Idempotent et rejouable : c'est le point d'entrée qui permet de tout
 * reconstruire quand la méthode d'inférence change (`METHOD_VERSION`). Les
 * positions ne sont jamais touchées — elles sont la preuve.
 *
 *   POST /api/telematics/rebuild
 *   { "deviceId"?: uuid, "from"?: "2026-09-01", "to"?: "2026-09-16" }
 *
 * Authentification : `x-telematics-key`, ou `Authorization: Bearer <CRON_SECRET>`
 * pour un déclenchement planifié.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGE = 1000; // plafond PostgREST : toute lecture doit être paginée

const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "fleet" } },
  );

function constantEquals(provided: string | null, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = Buffer.from(String(provided ?? ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorized(req: NextRequest): boolean {
  if (constantEquals(req.headers.get("x-telematics-key"), process.env.TELEMATICS_INGEST_KEY)) {
    return true;
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  return constantEquals(bearer, process.env.CRON_SECRET);
}

/**
 * Déclenchement planifié (Vercel Cron), qui appelle en GET avec
 * `Authorization: Bearer <CRON_SECRET>`. Sans lui, les trajets ne seraient
 * calculés que sur intervention manuelle — les positions s'accumuleraient en
 * base sans jamais devenir des kilomètres exploitables.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "non autorisé" }, { status: 401 });
  }
  return rebuild({});
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return Response.json({ error: "non autorisé" }, { status: 401 });
  }

  let body: { deviceId?: string; from?: string; to?: string } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return Response.json({ error: "JSON illisible" }, { status: 400 });
  }

  return rebuild(body);
}

async function rebuild(body: { deviceId?: string; from?: string; to?: string }) {
  const sql = db();

  // Par défaut : les 7 derniers jours, fenêtre raisonnable pour un cron
  // quotidien qui rattrape les positions arrivées en retard après une coupure.
  const to = body.to ?? new Date().toISOString().slice(0, 10);
  const from =
    body.from ?? new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const fromTs = `${from}T00:00:00.000Z`;
  const toTs = `${to}T23:59:59.999Z`;

  const { data: devices, error: devErr } = await sql
    .from("telematics_devices")
    .select("id, tenant_id, vehicle_id, external_id")
    .match(body.deviceId ? { id: body.deviceId } : {});

  if (devErr) return Response.json({ error: devErr.message }, { status: 500 });
  if (!devices?.length) return Response.json({ error: "aucun boîtier" }, { status: 404 });

  const report: Record<string, unknown>[] = [];

  for (const device of devices) {
    // ── Lecture paginée des positions (jamais de .limit() implicite à 1000 :
    //    c'est le bug qui avait sous-évalué les charges en septembre) ──
    const points: RawPoint[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await sql
        .from("telematics_positions")
        .select("recorded_at, latitude, longitude, speed_kmh, valid_fix")
        .eq("device_id", device.id)
        .gte("recorded_at", fromTs)
        .lte("recorded_at", toTs)
        .order("recorded_at")
        .range(offset, offset + PAGE - 1);

      if (error) return Response.json({ error: error.message }, { status: 500 });
      if (!data?.length) break;

      for (const p of data) {
        points.push({
          recordedAt: p.recorded_at,
          latitude: p.latitude,
          longitude: p.longitude,
          speedKmh: p.speed_kmh,
          validFix: p.valid_fix,
        });
      }
      if (data.length < PAGE) break;
    }

    if (points.length < 2) {
      report.push({ device: device.external_id, points: points.length, trips: 0, skipped: true });
      continue;
    }

    const { trips, events, daily, discarded } = buildTrips(points);

    // ── Remplacement de la tranche recalculée, pour cette méthode ─────────
    // On supprime avant de réécrire : sinon un trajet qui rétrécit après
    // amélioration de la méthode laisserait un fantôme de l'ancien calcul.
    // Les événements partent en premier : ils référencent les trajets.
    await sql.from("telematics_events").delete()
      .eq("device_id", device.id).eq("method_version", METHOD_VERSION)
      .gte("occurred_at", fromTs).lte("occurred_at", toTs);
    await sql.from("telematics_trips").delete()
      .eq("device_id", device.id).eq("method_version", METHOD_VERSION)
      .gte("started_at", fromTs).lte("started_at", toTs);
    await sql.from("telematics_daily").delete()
      .eq("device_id", device.id).eq("method_version", METHOD_VERSION)
      .gte("day", from).lte("day", to);

    const tripRows = trips.map((t) => ({
      tenant_id: device.tenant_id,
      device_id: device.id,
      vehicle_id: device.vehicle_id,
      started_at: t.startedAt,
      ended_at: t.endedAt,
      start_latitude: t.startLatitude,
      start_longitude: t.startLongitude,
      end_latitude: t.endLatitude,
      end_longitude: t.endLongitude,
      distance_m: t.distanceM,
      duration_s: t.durationS,
      moving_s: t.movingS,
      idle_s: t.idleS,
      max_speed_kmh: t.maxSpeedKmh,
      avg_moving_speed_kmh: t.avgMovingSpeedKmh,
      points: t.points,
      gaps_s: t.gapsS,
      jumps_dropped: t.jumpsDropped,
      confidence: t.confidence,
      evidence: t.evidence,
      method_version: t.methodVersion,
    }));

    const { data: insertedTrips, error: tripErr } = tripRows.length
      ? await sql.from("telematics_trips").insert(tripRows).select("id, started_at")
      : { data: [], error: null };
    if (tripErr) return Response.json({ error: tripErr.message }, { status: 500 });

    // Les événements portent l'identifiant du trajet auquel ils se rapportent.
    const tripIdByStart = new Map((insertedTrips ?? []).map((t) => [t.started_at, t.id]));
    const eventRows = events.map((e) => ({
      tenant_id: device.tenant_id,
      device_id: device.id,
      vehicle_id: device.vehicle_id,
      trip_id:
        e.tripIndex !== null && trips[e.tripIndex]
          ? tripIdByStart.get(trips[e.tripIndex].startedAt) ?? null
          : null,
      type: e.type,
      occurred_at: e.at,
      latitude: e.latitude,
      longitude: e.longitude,
      confidence: e.confidence,
      evidence: e.evidence,
      method_version: e.methodVersion,
    }));

    if (eventRows.length) {
      const { error } = await sql.from("telematics_events").insert(eventRows);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }

    const dailyRows = daily.map((d) => ({
      tenant_id: device.tenant_id,
      device_id: device.id,
      vehicle_id: device.vehicle_id,
      day: d.day,
      distance_m: d.distanceM,
      moving_s: d.movingS,
      idle_s: d.idleS,
      trips: d.trips,
      points: d.points,
      gaps_s: d.gapsS,
      jumps_dropped: d.jumpsDropped,
      coverage: d.coverage,
      first_movement_at: d.firstMovementAt,
      last_movement_at: d.lastMovementAt,
      max_speed_kmh: d.maxSpeedKmh,
      method_version: d.methodVersion,
    }));

    if (dailyRows.length) {
      const { error } = await sql.from("telematics_daily").insert(dailyRows);
      if (error) return Response.json({ error: error.message }, { status: 500 });
    }

    // ── Lieux de départ et d'arrivée ─────────────────────────────────────
    // Un trajet « 07:03 → 09:13, 124 km » ne se lit pas sans savoir d'où à où.
    // Le géocodage est borné et mis en cache : le fournisseur gratuit limite
    // strictement le débit, et le dépasser couperait la fonction pour tous.
    const adresses = await geocoderTrajets(sql, insertedTrips ?? [], trips);

    report.push({
      device: device.external_id,
      points: points.length,
      trips: trips.length,
      events: events.length,
      days: daily.length,
      adresses,
      discarded,
    });
  }

  return Response.json({ methodVersion: METHOD_VERSION, from, to, devices: report });
}

/**
 * Renseigne les lieux de départ et d'arrivée des trajets qui n'en ont pas.
 *
 * Le nombre d'appels est volontairement bas : la fenêtre d'exécution est
 * limitée, et le fournisseur impose une requête par seconde. Les trajets non
 * résolus lors d'une passe le seront à la suivante — un trajet sans adresse
 * reste affiché avec ses coordonnées, jamais avec un lieu inventé.
 */
async function geocoderTrajets(
  sql: ReturnType<typeof db>,
  inserted: { id: string; started_at: string }[],
  trips: { startedAt: string; startLatitude: number; startLongitude: number;
           endLatitude: number; endLongitude: number }[],
): Promise<number> {
  if (!inserted.length) return 0;

  const parDebut = new Map(trips.map((t) => [t.startedAt, t]));
  const points: { lat: number; lon: number }[] = [];
  for (const row of inserted) {
    const t = parDebut.get(row.started_at);
    if (!t) continue;
    points.push({ lat: t.startLatitude, lon: t.startLongitude });
    points.push({ lat: t.endLatitude, lon: t.endLongitude });
  }

  const resolus = await resoudreAdresses(points, {
    maxAppels: 12,
    contact: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    lire: async (cles) => {
      const out = new Map<string, string>();
      if (!cles.length) return out;
      const { data } = await sql
        .from("geocode_cache")
        .select("lat, lon, label")
        .in("lat", [...new Set(cles.map((c) => c.lat))])
        .in("lon", [...new Set(cles.map((c) => c.lon))]);
      for (const r of data ?? []) out.set(`${Number(r.lat)},${Number(r.lon)}`, r.label);
      return out;
    },
    ecrire: async (lieux) => {
      await sql.from("geocode_cache").upsert(
        lieux.map((l) => ({ lat: l.lat, lon: l.lon, label: l.label, provider: "nominatim" })),
        { onConflict: "lat,lon" },
      );
    },
  });

  const libelle = (lat: number, lon: number) => {
    const c = cleCache(lat, lon);
    return resolus.get(`${c.lat},${c.lon}`) ?? null;
  };

  let renseignes = 0;
  for (const row of inserted) {
    const t = parDebut.get(row.started_at);
    if (!t) continue;
    const depart = libelle(t.startLatitude, t.startLongitude);
    const arrivee = libelle(t.endLatitude, t.endLongitude);
    if (!depart && !arrivee) continue;
    await sql.from("telematics_trips").update({
      start_address: depart,
      end_address: arrivee,
      address_source: "nominatim",
    }).eq("id", row.id);
    renseignes++;
  }
  return renseignes;
}
