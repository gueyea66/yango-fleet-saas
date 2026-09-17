import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { fetchAllRows } from "@/lib/fetchAllRows";

/**
 * Lecture télématique pour l'écran de suivi.
 *
 * Passe par le serveur (service_role) comme les autres écrans admin
 * (`/api/admin/kpis`, `/api/admin/pilotage-data`) : le tenant vient du compte
 * authentifié, jamais de la requête. Un admin ne peut lire que sa flotte.
 *
 *   GET /api/admin/telematics?date=2026-09-16&vehicleId=…
 */

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

/** Réduit une trace à ~`max` points en conservant la forme du trajet. */
function sample<T>(rows: T[], max = 1200): T[] {
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(rows[Math.floor(i * step)]);
  const last = rows[rows.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const { searchParams } = new URL(req.url);

    const day = searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const vehicleId = searchParams.get("vehicleId");
    const histDays = 14;
    const histStart = new Date(Date.parse(`${day}T00:00:00Z`) - (histDays - 1) * 86400_000)
      .toISOString().slice(0, 10);

    // ── Boîtiers du tenant, avec leur véhicule ───────────────────────────
    const { data: devices, error: devErr } = await admin
      .from("telematics_devices")
      .select("id, external_id, vendor, model, label, active, last_seen_at, vehicle_id")
      .eq("tenant_id", tenantId);

    if (devErr) {
      // Socle non encore appliqué : l'écran doit le dire, pas planter.
      const missing = /relation .* does not exist/i.test(devErr.message);
      return Response.json(
        { installed: !missing, error: devErr.message, devices: [] },
        { status: missing ? 200 : 500 },
      );
    }

    const { data: vehicles } = await admin
      .from("vehicles")
      .select("id, plate, make, model")
      .eq("tenant_id", tenantId);

    const selected =
      (vehicleId && devices?.find((d) => d.vehicle_id === vehicleId)) ||
      devices?.[0] ||
      null;

    if (!selected) {
      return Response.json({
        installed: true,
        devices: [],
        vehicles: vehicles ?? [],
        day,
        positions: [],
        events: [],
        daily: [],
        reconciliation: [],
      });
    }

    const dayStart = `${day}T00:00:00.000Z`;
    const dayEnd = `${day}T23:59:59.999Z`;

    // ── Trace du jour, dernière position, événements, historique ─────────
    const [positions, events, daily, reconciliation, lastPos, trips] = await Promise.all([
      fetchAllRows(() =>
        admin
          .from("telematics_positions")
          .select("recorded_at, latitude, longitude, speed_kmh, valid_fix")
          .eq("device_id", selected.id)
          .gte("recorded_at", dayStart)
          .lte("recorded_at", dayEnd)
          .order("recorded_at"),
      ),
      admin
        .from("telematics_events")
        .select("type, occurred_at, latitude, longitude, confidence, evidence")
        .eq("device_id", selected.id)
        .gte("occurred_at", dayStart)
        .lte("occurred_at", dayEnd)
        .order("occurred_at")
        .then((r) => r.data ?? []),
      admin
        .from("telematics_daily")
        .select("*")
        .eq("device_id", selected.id)
        .gte("day", histStart)
        .lte("day", day)
        .order("day", { ascending: false })
        .then((r) => r.data ?? []),
      admin
        .from("v_telematics_reconciliation")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("vehicle_id", selected.vehicle_id)
        .gte("day", histStart)
        .lte("day", day)
        .order("day", { ascending: false })
        .then((r) => r.data ?? []),
      admin
        .from("telematics_positions")
        .select("recorded_at, latitude, longitude, speed_kmh, valid_fix")
        .eq("device_id", selected.id)
        .order("recorded_at", { ascending: false })
        .limit(1)
        .then((r) => r.data?.[0] ?? null),
      admin
        .from("telematics_trips")
        .select("id, started_at, ended_at, distance_m, duration_s, moving_s, idle_s, " +
                "max_speed_kmh, avg_moving_speed_kmh, points, gaps_s, jumps_dropped, " +
                "confidence, evidence, start_latitude, start_longitude, end_latitude, end_longitude, " +
                "start_address, end_address, address_source")
        .eq("device_id", selected.id)
        .gte("started_at", dayStart)
        .lte("started_at", dayEnd)
        .order("started_at")
        .then((r) => r.data ?? []),
    ]);

    return Response.json({
      installed: true,
      day,
      devices: (devices ?? []).map((d) => ({
        ...d,
        plate: vehicles?.find((v) => v.id === d.vehicle_id)?.plate ?? null,
      })),
      vehicles: vehicles ?? [],
      selectedDeviceId: selected.id,
      selectedVehicleId: selected.vehicle_id,
      positions: sample(positions ?? []),
      positionCount: positions?.length ?? 0,
      lastPosition: lastPos,
      events,
      trips,
      daily,
      reconciliation,
    });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string };
    return Response.json({ error: e.message ?? "erreur" }, { status: e.status ?? 500 });
  }
}
