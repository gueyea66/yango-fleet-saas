import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { parseH02Stream } from "@/lib/telematics/h02";
import { adaptTraccarPayload, fromH02, type IngestPosition } from "@/lib/telematics/traccar";

/**
 * Ingestion télématique — LE point d'abstraction du fabricant (brief §6).
 *
 * Accepte deux sources, et le métier ne sait jamais laquelle a servi :
 *   1. Traccar (`forward.type=json`)  → { position: {...}, device: {...} }
 *   2. Trames H02 brutes              → { frames: ["*HQ,…#", …] } ou text/plain
 *
 * Authentification : clé partagée en en-tête `x-telematics-key`, comparée en
 * temps constant. Aucune session utilisateur — l'appelant est une machine.
 *
 * Idempotence (brief §8) : l'unicité (device_id, recorded_at) est portée par
 * la base. Un boîtier qui réémet son tampon après une coupure réseau ne crée
 * pas de doublon, donc ne double pas les kilomètres.
 */

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const MAX_POSITIONS = 500;

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "fleet" } },
  );

function keyOk(provided: string | null): boolean {
  const expected = process.env.TELEMATICS_INGEST_KEY;
  if (!expected) return false;
  const a = Buffer.from(String(provided ?? ""));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!keyOk(req.headers.get("x-telematics-key"))) {
    return Response.json({ error: "clé d'ingestion invalide" }, { status: 401 });
  }

  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    return Response.json({ error: "charge trop volumineuse" }, { status: 413 });
  }

  // ── 1. Normalisation, quelle que soit la source ────────────────────────
  const positions: IngestPosition[] = [];
  const rejected: { reason: string }[] = [];

  const contentType = req.headers.get("content-type") || "";
  let parsed: unknown = null;
  if (contentType.includes("json")) {
    try {
      parsed = JSON.parse(body);
    } catch {
      return Response.json({ error: "JSON illisible" }, { status: 400 });
    }
  }

  const collectFrames = (frames: string[]) => {
    for (const frame of frames) {
      const { results } = parseH02Stream(frame.endsWith("#") ? frame : `${frame}#`);
      for (const r of results) {
        if (r.ok) positions.push(fromH02(r.position));
        else rejected.push({ reason: r.reason });
      }
    }
  };

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.frames)) {
      collectFrames(obj.frames.filter((f): f is string => typeof f === "string"));
    } else {
      const r = adaptTraccarPayload(obj);
      if (r.ok) positions.push(r.position);
      else rejected.push({ reason: r.reason });
    }
  } else if (body.includes("*")) {
    collectFrames([body]);
  } else {
    return Response.json({ error: "format non reconnu" }, { status: 400 });
  }

  if (positions.length === 0) {
    return Response.json({ accepted: 0, inserted: 0, rejected }, { status: 422 });
  }
  if (positions.length > MAX_POSITIONS) {
    return Response.json({ error: "trop de positions par appel" }, { status: 413 });
  }

  // ── 2. Résolution du boîtier ───────────────────────────────────────────
  // Un boîtier doit être enrôlé au préalable (table telematics_devices) :
  // une position dont on ignore le véhicule et l'organisation n'a aucune
  // valeur métier, et créer le boîtier à la volée ouvrirait la porte à
  // l'injection de données par n'importe quel émetteur connaissant la clé.
  const db = admin();
  const externalIds = [...new Set(positions.map((p) => p.externalId))];

  const { data: devices, error: devErr } = await db
    .from("telematics_devices")
    .select("id, external_id, tenant_id, vehicle_id, active")
    .in("external_id", externalIds);

  if (devErr) {
    return Response.json({ error: "lecture des boîtiers impossible" }, { status: 500 });
  }

  const byExternal = new Map<string, { id: string; active: boolean }>();
  const ambiguous = new Set<string>();
  for (const d of devices ?? []) {
    if (byExternal.has(d.external_id)) ambiguous.add(d.external_id);
    byExternal.set(d.external_id, { id: d.id, active: d.active });
  }

  const rows = [];
  for (const p of positions) {
    if (ambiguous.has(p.externalId)) {
      rejected.push({ reason: `boîtier ${p.externalId} en double, correspondance ambiguë` });
      continue;
    }
    const device = byExternal.get(p.externalId);
    if (!device) {
      rejected.push({ reason: `boîtier ${p.externalId} non enrôlé` });
      continue;
    }
    if (!device.active) {
      rejected.push({ reason: `boîtier ${p.externalId} désactivé` });
      continue;
    }
    rows.push({
      device_id: device.id,
      // tenant_id et vehicle_id sont volontairement absents : le trigger
      // BEFORE INSERT les pose à partir du boîtier enrôlé. L'appelant n'est
      // jamais cru sur parole sur l'organisation à laquelle il écrit.
      recorded_at: p.recordedAt,
      latitude: p.latitude,
      longitude: p.longitude,
      speed_kmh: p.speedKmh,
      heading: p.heading,
      altitude_m: p.altitudeM,
      satellites: p.satellites,
      valid_fix: p.validFix,
      ignition: p.ignition,
      odometer_m: p.odometerM,
      battery_v: p.batteryV,
      external_v: p.externalV,
      event_type: p.eventType,
      protocol: p.protocol,
      status_raw: p.statusRaw,
      raw: p.raw,
    });
  }

  if (rows.length === 0) {
    return Response.json({ accepted: positions.length, inserted: 0, rejected }, { status: 422 });
  }

  // ── 3. Écriture idempotente ────────────────────────────────────────────
  const { data: inserted, error: insErr } = await db
    .from("telematics_positions")
    .upsert(rows, { onConflict: "device_id,recorded_at", ignoreDuplicates: true })
    .select("id");

  if (insErr) {
    return Response.json({ error: `écriture refusée : ${insErr.message}` }, { status: 500 });
  }

  const seenAt = new Date().toISOString();
  await db
    .from("telematics_devices")
    .update({ last_seen_at: seenAt })
    .in("id", [...new Set(rows.map((r) => r.device_id))]);

  return Response.json({
    accepted: positions.length,
    inserted: inserted?.length ?? 0,
    duplicates: rows.length - (inserted?.length ?? 0),
    rejected,
  });
}
