import { createClient } from "@supabase/supabase-js";
import { sendNotification } from "@/lib/notifications";

/**
 * Surveillance des boîtiers : alerte quand un traceur se tait, et prévient
 * quand il revient.
 *
 * Né d'une panne réelle : la passerelle est restée hors service douze heures
 * sans que personne ne le sache. L'écran le disait, mais personne ne regarde
 * un écran la nuit. Un flux GPS coupé, c'est une flotte qu'on ne suit plus et
 * des kilomètres perdus pour toujours — ils ne se rattrapent pas après coup.
 *
 *   GET  (cron)  → seuil par défaut
 *   POST         → { "heures": 3 }
 *
 * Une seule alerte par épisode de silence : un boîtier muet trois jours ne
 * doit pas envoyer trois cents notifications, sinon plus personne ne les lit.
 */

const db = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "fleet" } },
  );

/** « 45 min », « 12 h », « 3 jours » — lisible dans une notification. */
const duree = (ms: number) => {
  const h = Math.round(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.round(ms / 60000))} min`;
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} jours`;
};

export async function surveiller(heures: number) {
  const sql = db();
  const seuil = Date.now() - heures * 3600_000;

  const { data: devices, error } = await sql
    .from("telematics_devices")
    .select("id, tenant_id, vehicle_id, external_id, label, active, last_seen_at, silence_alerted_at")
    .eq("active", true)
    .not("last_seen_at", "is", null);

  if (error) throw new Error(error.message);

  const silencieux = (devices ?? []).filter((d) =>
    Date.parse(d.last_seen_at) < seuil
    && (!d.silence_alerted_at || Date.parse(d.silence_alerted_at) <= Date.parse(d.last_seen_at)));

  // Un boîtier qui a réémis depuis l'alerte est de retour : on le dit, et on
  // réarme la surveillance pour le prochain épisode.
  const revenus = (devices ?? []).filter((d) =>
    d.silence_alerted_at && Date.parse(d.last_seen_at) > Date.parse(d.silence_alerted_at));

  if (!silencieux.length && !revenus.length) {
    return { surveilles: devices?.length ?? 0, alertes: 0, retours: 0 };
  }

  // Plaques et destinataires, une seule fois pour tout le lot.
  const vehiculeIds = [...new Set([...silencieux, ...revenus].map((d) => d.vehicle_id).filter(Boolean))];
  const { data: vehicules } = vehiculeIds.length
    ? await sql.from("vehicles").select("id, plate").in("id", vehiculeIds)
    : { data: [] };
  const plaque = new Map((vehicules ?? []).map((v) => [v.id, String(v.plate ?? "").trim()]));

  const tenantIds = [...new Set([...silencieux, ...revenus].map((d) => d.tenant_id))];
  const { data: admins } = await sql
    .from("profiles").select("id, tenant_id").in("tenant_id", tenantIds).eq("role", "admin");

  const parTenant = new Map<string, string[]>();
  for (const a of admins ?? []) {
    parTenant.set(a.tenant_id, [...(parTenant.get(a.tenant_id) ?? []), a.id]);
  }

  const nom = (d: { vehicle_id: string | null; label: string | null; external_id: string }) =>
    (d.vehicle_id && plaque.get(d.vehicle_id)) || d.label || `boîtier ${d.external_id}`;

  let alertes = 0;
  for (const d of silencieux) {
    const depuis = duree(Date.now() - Date.parse(d.last_seen_at));
    for (const admin of parTenant.get(d.tenant_id) ?? []) {
      await sendNotification(
        d.tenant_id, admin, "gps_silencieux",
        `${nom(d)} : plus de signal GPS`,
        `Aucune position reçue depuis ${depuis}. Les kilomètres de cette période ne pourront pas être reconstitués.`,
        { url: "/admin/suivi", deviceId: d.id, externalId: d.external_id },
      );
    }
    await sql.from("telematics_devices")
      .update({ silence_alerted_at: new Date().toISOString() }).eq("id", d.id);
    alertes++;
  }

  let retours = 0;
  for (const d of revenus) {
    for (const admin of parTenant.get(d.tenant_id) ?? []) {
      await sendNotification(
        d.tenant_id, admin, "gps_retabli",
        `${nom(d)} : signal GPS rétabli`,
        "Le boîtier émet de nouveau. Le suivi reprend automatiquement.",
        { url: "/admin/suivi", deviceId: d.id, externalId: d.external_id },
      );
    }
    await sql.from("telematics_devices")
      .update({ silence_alerted_at: null }).eq("id", d.id);
    retours++;
  }

  return { surveilles: devices?.length ?? 0, alertes, retours };
}
