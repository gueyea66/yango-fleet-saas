import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { filtrerVraisemblables, invraisemblance } from "@/lib/telematics/vraisemblance";
import { parseH02Stream } from "@/lib/telematics/h02";
import { adaptTraccarPayload, fromH02, toPositionRow, type IngestPosition } from "@/lib/telematics/traccar";

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
    rows.push(toPositionRow(device.id, p));
  }

  // ── 2 bis. Vraisemblance (audit du 18/10/2026, I1) ─────────────────────
  // Un boîtier H02 ne s'authentifie pas : on écarte une heure dans le futur ou trop ancienne, et un saut qui
  // supposerait une vitesse impossible depuis le point enregistré juste avant, pour le même boîtier.
  const parBoitier = new Map<string, typeof rows>();
  for (const r of rows) (parBoitier.get(r.device_id) ?? parBoitier.set(r.device_id, []).get(r.device_id)!).push(r);
  const retenues: typeof rows = [];
  for (const [deviceId, lot] of parBoitier) {
    const premier = lot.map((r) => r.recorded_at).sort()[0];
    const { data: avant } = await db.from("telematics_positions").select("recorded_at, latitude, longitude")
      .eq("device_id", deviceId).eq("valid_fix", true).lt("recorded_at", premier).order("recorded_at", { ascending: false }).limit(1);
    const ref = avant?.[0] ? { recordedAt: new Date(avant[0].recorded_at as string).toISOString(), latitude: Number(avant[0].latitude), longitude: Number(avant[0].longitude) } : null;
    // Un point sans position valide ne sert pas de référence et n'est pas jugé sur sa distance.
    const sansFix = lot.filter((r) => !r.valid_fix);
    const { gardees, refus } = filtrerVraisemblables(lot.filter((r) => r.valid_fix).map((r) => ({ ...r, recordedAt: r.recorded_at })), ref);
    retenues.push(...sansFix.filter((r) => !invraisemblance({ recordedAt: r.recorded_at, latitude: r.latitude, longitude: r.longitude }, null)), ...gardees.map(({ recordedAt: _, ...r }) => r));
    for (const x of refus) rejected.push({ reason: `position écartée : ${x.raison}` });
  }
  rows.length = 0;
  rows.push(...retenues);

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
