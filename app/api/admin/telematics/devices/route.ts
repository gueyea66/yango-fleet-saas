import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import {
  parseRconf,
  buildInstallSms,
  normalizeDeviceId,
  isIpv4,
} from "@/lib/telematics/devices";

/**
 * Gestion des boîtiers GPS par le gestionnaire de flotte.
 *
 *   GET    liste des boîtiers, véhicules disponibles, passerelle, plan de SMS
 *   POST   enrôlement d'un boîtier
 *   PATCH  rattachement, relevé RCONF, activation, confirmation d'installation
 *
 * Le tenant vient TOUJOURS du compte connecté, jamais de la requête.
 * Le mot de passe SMS n'est jamais renvoyé tel quel : seul le plan de SMS,
 * destiné à l'installateur, le contient.
 */

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

type Fail = Error & { status: number };
const fail = (status: number, message: string): never => {
  const e = new Error(message) as Fail;
  e.status = status;
  throw e;
};

function gateway() {
  const ip = process.env.TELEMATICS_GATEWAY_IP?.trim() || null;
  const port = Number(process.env.TELEMATICS_GATEWAY_PORT) || null;
  return {
    ip,
    port,
    host: process.env.TELEMATICS_GATEWAY_HOST?.trim() || null,
    configured: Boolean(ip && isIpv4(ip) && port),
  };
}

/** Retire les numéros de téléphone autorisés (U1, U2, U3) avant stockage. */
function scrubRconf(text: string): string {
  return text.replace(/\bU([123])\s*:\s*[\d\s]*/gi, "U$1:");
}

const DEVICE_COLUMNS =
  "id, vehicle_id, vendor, model, external_id, protocol, label, active, last_seen_at, " +
  "original_server_ip, original_server_port, sms_password, firmware, apn, " +
  "upload_interval_s, rconf_at, installed_at, created_at";

function present(d: Record<string, any>, plates: Map<string, string>) {
  const gw = gateway();
  const plan = buildInstallSms({
    password: d.sms_password,
    gatewayIp: gw.ip,
    gatewayPort: gw.port,
    originalIp: d.original_server_ip,
    originalPort: d.original_server_port,
  });
  return {
    id: d.id,
    externalId: d.external_id,
    vendor: d.vendor,
    model: d.model,
    firmware: d.firmware,
    label: d.label,
    active: d.active,
    vehicleId: d.vehicle_id,
    plate: d.vehicle_id ? plates.get(d.vehicle_id) ?? null : null,
    lastSeenAt: d.last_seen_at,
    rconfAt: d.rconf_at,
    installedAt: d.installed_at,
    originalServer: d.original_server_ip
      ? `${d.original_server_ip}:${d.original_server_port ?? "?"}`
      : null,
    hasPassword: Boolean(d.sms_password),
    uploadIntervalS: d.upload_interval_s,
    plan,
  };
}

async function loadVehicles(tenantId: string) {
  const { data } = await admin
    .from("vehicles")
    .select("id, plate, make, model")
    .eq("tenant_id", tenantId)
    .order("plate");
  return (data ?? []).map((v) => ({
    id: v.id,
    // Des plaques sont stockées avec des espaces parasites : on affiche propre.
    plate: String(v.plate ?? "").trim(),
    name: [v.make, v.model].filter(Boolean).join(" "),
  }));
}

export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    const [vehicles, { data: devices, error }] = await Promise.all([
      loadVehicles(tenantId),
      admin.from("telematics_devices").select(DEVICE_COLUMNS)
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    ]);
    if (error) fail(500, error.message);

    const plates = new Map(vehicles.map((v) => [v.id, v.plate]));
    const gw = gateway();
    return Response.json({
      gateway: { ip: gw.ip, port: gw.port, host: gw.host, configured: gw.configured },
      vehicles,
      devices: (devices ?? []).map((d) => present(d as Record<string, any>, plates)),
    });
  } catch (err) {
    const e = err as Fail;
    return Response.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const body = await req.json().catch(() => fail(400, "Requête illisible."));

    const externalId = normalizeDeviceId(String(body.externalId ?? ""));
    if (!externalId) {
      fail(400, "Identifiant du boîtier invalide : ce sont les 6 à 20 chiffres imprimés sur l'étiquette.");
    }

    const vehicleId = body.vehicleId ? String(body.vehicleId) : null;
    if (vehicleId) {
      const { data: v } = await admin.from("vehicles").select("id")
        .eq("id", vehicleId).eq("tenant_id", tenantId).maybeSingle();
      if (!v) fail(400, "Ce véhicule n'appartient pas à votre flotte.");
    }

    const rconf = body.rconf ? parseRconf(String(body.rconf)) : null;
    if (rconf?.deviceId && rconf.deviceId !== externalId) {
      fail(400,
        `Le relevé RCONF concerne le boîtier ${rconf.deviceId}, pas ${externalId}. ` +
        "Vérifiez que le SMS vient bien du bon boîtier.");
    }

    const vendor = "sinotrack";
    const { data: existing } = await admin.from("telematics_devices")
      .select("id, tenant_id").eq("vendor", vendor).eq("external_id", externalId).maybeSingle();
    if (existing) {
      // Ne jamais révéler à quelle organisation appartient un boîtier.
      fail(409, existing.tenant_id === tenantId
        ? "Ce boîtier est déjà enrôlé dans votre flotte."
        : "Ce boîtier est déjà rattaché à une autre organisation. Contactez le support M3A.");
    }

    const now = new Date().toISOString();
    const row = {
      tenant_id: tenantId,
      vehicle_id: vehicleId,
      vendor,
      model: rconf?.model ?? (body.model ? String(body.model) : "ST-901"),
      external_id: externalId,
      protocol: "h02",
      label: body.label ? String(body.label).slice(0, 80) : null,
      active: true,
      firmware: rconf?.firmware ?? null,
      sms_password: rconf?.password ?? null,
      original_server_ip: rconf?.serverIp ?? null,
      original_server_port: rconf?.serverPort ?? null,
      apn: rconf?.apn ?? null,
      upload_interval_s: rconf?.uploadIntervalS ?? null,
      rconf_raw: body.rconf ? scrubRconf(String(body.rconf)).slice(0, 2000) : null,
      rconf_at: rconf ? now : null,
    };

    const { data: created, error } = await admin.from("telematics_devices")
      .insert(row).select(DEVICE_COLUMNS).single();
    if (error) fail(500, error.message);

    const vehicles = await loadVehicles(tenantId);
    const plates = new Map(vehicles.map((v) => [v.id, v.plate]));
    return Response.json({
      device: present(created as Record<string, any>, plates),
      warnings: rconf?.warnings ?? [],
    }, { status: 201 });
  } catch (err) {
    const e = err as Fail;
    return Response.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const body = await req.json().catch(() => fail(400, "Requête illisible."));
    const id = String(body.id ?? "");

    const { data: device } = await admin.from("telematics_devices")
      .select("id, external_id, tenant_id").eq("id", id).eq("tenant_id", tenantId).maybeSingle();
    if (!device) fail(404, "Boîtier introuvable dans votre flotte.");

    const patch: Record<string, unknown> = {};
    let warnings: string[] = [];

    switch (body.action) {
      case "link": {
        const vehicleId = body.vehicleId ? String(body.vehicleId) : null;
        if (vehicleId) {
          const { data: v } = await admin.from("vehicles").select("id")
            .eq("id", vehicleId).eq("tenant_id", tenantId).maybeSingle();
          if (!v) fail(400, "Ce véhicule n'appartient pas à votre flotte.");
        }
        patch.vehicle_id = vehicleId;
        break;
      }
      case "rconf": {
        const r = parseRconf(String(body.rconf ?? ""));
        if (r.deviceId && r.deviceId !== device!.external_id) {
          fail(400, `Ce relevé concerne le boîtier ${r.deviceId}, pas ${device!.external_id}.`);
        }
        if (!r.password && !r.serverIp) {
          fail(400, "Ce texte ne ressemble pas à une réponse RCONF.");
        }
        Object.assign(patch, {
          firmware: r.firmware,
          sms_password: r.password,
          original_server_ip: r.serverIp,
          original_server_port: r.serverPort,
          apn: r.apn,
          upload_interval_s: r.uploadIntervalS,
          rconf_raw: scrubRconf(String(body.rconf)).slice(0, 2000),
          rconf_at: new Date().toISOString(),
        });
        // Un RCONF relevé APRÈS bascule pointe vers la passerelle M3A : il ne
        // doit pas écraser le chemin de retour vers la plateforme d'origine.
        const gw = gateway();
        if (gw.ip && r.serverIp === gw.ip) {
          delete patch.original_server_ip;
          delete patch.original_server_port;
          patch.installed_at = new Date().toISOString();
          warnings = ["Bascule confirmée : le boîtier pointe vers M3A. Le chemin de retour d'origine est conservé."];
        }
        warnings = [...warnings, ...r.warnings];
        break;
      }
      case "activate":
        patch.active = true;
        break;
      case "deactivate":
        patch.active = false;
        break;
      default:
        fail(400, "Action inconnue.");
    }

    const { error } = await admin.from("telematics_devices").update(patch).eq("id", id);
    if (error) fail(500, error.message);
    return Response.json({ ok: true, warnings });
  } catch (err) {
    const e = err as Fail;
    return Response.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
