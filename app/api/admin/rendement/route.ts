import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { calculerRendement, type OrderRow, type Trace, type Rendement } from "@/lib/analytics/rendement";

/**
 * Rendement de la flotte : créneaux, zones, chauffeurs, coupures déduites.
 *
 *   GET /api/admin/rendement?jours=90     (30 | 90 | 365 | 0 = tout l'historique)
 *
 * Rien n'est stocké : le calcul repart des commandes Yango à chaque demande,
 * donc l'écran suit seul l'arrivée des nouveaux exports et des positions GPS.
 * Le tenant vient TOUJOURS du compte connecté.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

const PAGE = 1000;
const COLONNES =
  "order_id, status, cancel_reason, yango_driver_id, driver_name, plate, started_at, ended_at, " +
  "address_from, address_to, service_class, distance_m, tarif, commission";

/** Le GPS n'éclaire que les coupures récentes : au-delà, la trace n'apprend plus rien d'actionnable. */
const COUPURES_GPS_MAX = 30;
const COUPURES_GPS_JOURS = 21;

// Un an de commandes se relit en quelques secondes : inutile de le refaire à chaque clic de sélecteur.
const cache = new Map<string, { a: number; r: Rendement }>();
const CACHE_MS = 5 * 60_000;

async function toutesLesCommandes(tenantId: string, depuis: string | null): Promise<OrderRow[]> {
  const base = () => {
    let q = admin.from("yango_orders").select(COLONNES, { count: "exact" }).eq("tenant_id", tenantId);
    if (depuis) q = q.gte("jour", depuis);
    return q.order("order_id");
  };
  const { data, count, error } = await base().range(0, PAGE - 1);
  if (error) throw new Error(error.message);
  const pages = Math.ceil((count ?? 0) / PAGE);
  // Pages lues ensemble : en série, un an d'historique ferait quarante allers-retours.
  const suite = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
    base().range((i + 1) * PAGE, (i + 2) * PAGE - 1).then((r) => {
      if (r.error) throw new Error(r.error.message);
      return r.data ?? [];
    })));
  return [...(data ?? []), ...suite.flat()] as unknown as OrderRow[];
}

const plaqueNue = (p: string | null | undefined) => String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Traces GPS couvrant les coupures récentes des véhicules équipés. */
async function tracesDesCoupures(tenantId: string, coupures: Rendement["coupures"]): Promise<Map<string, Trace>> {
  const traces = new Map<string, Trace>();
  const seuil = Date.now() - COUPURES_GPS_JOURS * 86_400_000;
  const recentes = coupures.filter((c) => c.plaque && Date.parse(c.debut) >= seuil).slice(0, COUPURES_GPS_MAX);
  if (!recentes.length) return traces;

  const [{ data: devices }, { data: vehicules }] = await Promise.all([
    admin.from("telematics_devices").select("id, vehicle_id").eq("tenant_id", tenantId).eq("active", true),
    admin.from("vehicles").select("id, plate").eq("tenant_id", tenantId),
  ]);
  const plaqueDe = new Map((vehicules ?? []).map((v) => [v.id as string, plaqueNue(v.plate)]));
  const boitier = new Map<string, string>();
  for (const d of devices ?? []) {
    const p = d.vehicle_id ? plaqueDe.get(d.vehicle_id) : null;
    if (p) boitier.set(p, d.id);
  }

  await Promise.all(recentes.map(async (c) => {
    const id = boitier.get(c.plaque!);
    if (!id) return;
    const points: Trace = [];
    for (let p = 0; p < 4; p++) {
      const { data, error } = await admin.from("telematics_positions")
        .select("recorded_at, latitude, longitude")
        .eq("device_id", id).eq("valid_fix", true)
        .gte("recorded_at", c.debut).lte("recorded_at", c.fin)
        .order("recorded_at").range(p * PAGE, (p + 1) * PAGE - 1);
      if (error || !data?.length) break;
      for (const r of data) points.push({ t: Date.parse(r.recorded_at), lat: r.latitude, lon: r.longitude });
      if (data.length < PAGE) break;
    }
    if (points.length) traces.set(c.plaque!, [...(traces.get(c.plaque!) ?? []), ...points].sort((a, b) => a.t - b.t));
  }));
  return traces;
}

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const demande = Number(new URL(req.url).searchParams.get("jours") ?? 90);
    const jours = [30, 90, 365, 0].includes(demande) ? demande : 90;

    const cle = `${tenantId}|${jours}`;
    const connu = cache.get(cle);
    if (connu && Date.now() - connu.a < CACHE_MS) return Response.json({ fenetre: jours, ...connu.r });

    const depuis = jours ? new Date(Date.now() - jours * 86_400_000).toISOString().slice(0, 10) : null;
    const orders = await toutesLesCommandes(tenantId, depuis);

    // Premier passage pour connaître les coupures, second avec leurs traces GPS.
    const brut = calculerRendement(orders, { maxCoupures: 400 });
    const traces = await tracesDesCoupures(tenantId, brut.coupures);
    const r = traces.size ? calculerRendement(orders, { traces }) : { ...brut, coupures: brut.coupures.slice(0, 40) };

    cache.set(cle, { a: Date.now(), r });
    return Response.json({ fenetre: jours, ...r });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return Response.json({ error: e.message ?? "erreur" }, { status: e.status ?? 500 });
  }
}
