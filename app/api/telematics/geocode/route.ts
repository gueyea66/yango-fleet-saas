import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { resoudreAdresses, cleCache } from "@/lib/telematics/geocode";

/**
 * Complète les lieux de départ et d'arrivée des trajets qui n'en ont pas.
 *
 *   POST /api/telematics/geocode   { "limit": 8 }
 *
 * Pourquoi une route séparée du recalcul : le géocodage est lent par
 * construction (le fournisseur gratuit impose une requête par seconde) et ne
 * doit jamais retarder le calcul des kilomètres. On le rejoue autant de fois
 * que nécessaire, chaque passe traitant un petit lot.
 *
 * Sert aussi aux trajets repris d'un autre système : l'export d'un
 * fournisseur ne fournit pas toujours les adresses.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "fleet" } },
  );

function autorise(req: NextRequest): boolean {
  const attendu = process.env.TELEMATICS_INGEST_KEY;
  const fourni = req.headers.get("x-telematics-key")
    ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "")
    ?? "";
  const cron = process.env.CRON_SECRET;
  for (const ref of [attendu, cron]) {
    if (!ref) continue;
    const a = Buffer.from(fourni);
    const b = Buffer.from(ref);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}

export async function POST(req: NextRequest) {
  if (!autorise(req)) return Response.json({ error: "non autorisé" }, { status: 401 });

  let body: { limit?: number; device?: string } = {};
  try {
    const t = await req.text();
    if (t) body = JSON.parse(t);
  } catch { /* corps facultatif */ }

  // 8 trajets = jusqu'à 16 points = ~18 s d'appels : large sous la limite
  // d'exécution, et poli envers le fournisseur.
  const limite = Math.min(Math.max(Number(body.limit) || 8, 1), 20);
  const sql = db();

  // Un boîtier peut être visé explicitement : inutile de dépenser des appels
  // de géocodage sur des données de démonstration.
  let deviceId: string | null = null;
  if (body.device) {
    const { data } = await sql.from("telematics_devices")
      .select("id").eq("external_id", String(body.device)).maybeSingle();
    if (!data) return Response.json({ error: "boîtier inconnu" }, { status: 404 });
    deviceId = data.id;
  }

  let requete = sql
    .from("telematics_trips")
    .select("id, start_latitude, start_longitude, end_latitude, end_longitude, start_address, end_address")
    .or("start_address.is.null,end_address.is.null");
  if (deviceId) requete = requete.eq("device_id", deviceId);

  const { data: trajets, error } = await requete
    .order("started_at", { ascending: false })
    .limit(limite);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!trajets?.length) return Response.json({ restants: 0, renseignes: 0 });

  const points = trajets.flatMap((t) => [
    { lat: t.start_latitude, lon: t.start_longitude },
    { lat: t.end_latitude, lon: t.end_longitude },
  ]);

  const resolus = await resoudreAdresses(points, {
    maxAppels: limite * 2,
    contact: process.env.NEXT_PUBLIC_SUPPORT_EMAIL,
    lire: async (cles) => {
      const out = new Map<string, string>();
      if (!cles.length) return out;
      const { data } = await sql.from("geocode_cache").select("lat, lon, label")
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
  for (const t of trajets) {
    const depart = t.start_address ?? libelle(t.start_latitude, t.start_longitude);
    const arrivee = t.end_address ?? libelle(t.end_latitude, t.end_longitude);
    if (depart === t.start_address && arrivee === t.end_address) continue;
    await sql.from("telematics_trips").update({
      start_address: depart,
      end_address: arrivee,
      // L'origine reflète ce qui a été ajouté : un import complété reste un
      // import pour la part fournie par la plateforme d'origine.
      address_source: t.start_address || t.end_address ? "import+nominatim" : "nominatim",
    }).eq("id", t.id);
    renseignes++;
  }

  let reste = sql
    .from("telematics_trips")
    .select("id", { count: "exact", head: true })
    .or("start_address.is.null,end_address.is.null");
  if (deviceId) reste = reste.eq("device_id", deviceId);
  const { count } = await reste;

  return Response.json({ renseignes, restants: count ?? 0 });
}
