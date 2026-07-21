import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

const INACTIVE_DAYS = 4;   // aucun rapport depuis N jours -> chauffeur inactif
const PENDING_DAYS = 3;    // rapport soumis non valide depuis N jours -> en attente trop long

const daysAgoStr = (n: number) =>
  new Date(Date.now() - n * 86400_000).toISOString().split("T")[0];

/**
 * GET /api/admin/alerts
 * Alertes opérationnelles actionnables, non visibles ailleurs sur le dashboard.
 * Lecture seule.
 */
export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    const today = new Date().toISOString().split("T")[0];

    const [{ data: drivers }, { data: recentReports }, { data: pending }] = await Promise.all([
      admin.from("profiles").select("id, driver_id, full_name, hire_date")
        .eq("tenant_id", tenantId).eq("role", "driver").eq("active", true),
      // rapports des N derniers jours (pour dater la dernière activité par chauffeur)
      admin.from("daily_reports").select("driver_id, date")
        .eq("tenant_id", tenantId).in("status", ["submitted", "approved"])
        .gte("date", daysAgoStr(INACTIVE_DAYS)),
      // rapports soumis (non validés) plus vieux que PENDING_DAYS
      admin.from("daily_reports").select("driver_id, date")
        .eq("tenant_id", tenantId).eq("status", "submitted")
        .lte("date", daysAgoStr(PENDING_DAYS)),
    ]);

    // Chauffeurs actifs sans AUCUN rapport dans la fenêtre récente
    const recentSet = new Set((recentReports || []).map((r: any) => r.driver_id));
    const nameOf = new Map((drivers || []).map((d: any) => [d.id, d.full_name || d.driver_id]));
    // On ne flague pas « inactif » un chauffeur embauché récemment (il n'a pas encore
    // eu la fenêtre pour soumettre) — évite le faux positif du nouveau chauffeur.
    const hiredCutoff = daysAgoStr(INACTIVE_DAYS);
    const inactive = (drivers || [])
      .filter((d: any) => !recentSet.has(d.id) && (!d.hire_date || d.hire_date <= hiredCutoff))
      .map((d: any) => d.full_name || d.driver_id);

    const stalePending = (pending || []).map((r: any) => ({
      name: nameOf.get(r.driver_id) || r.driver_id, date: r.date,
    }));

    const alerts: { kind: string; severity: "warn" | "info"; title: string; detail: string }[] = [];
    if (inactive.length > 0) {
      alerts.push({
        kind: "inactive_drivers", severity: "warn",
        title: `${inactive.length} chauffeur${inactive.length > 1 ? "s" : ""} inactif${inactive.length > 1 ? "s" : ""} (aucun rapport depuis ${INACTIVE_DAYS} j)`,
        detail: inactive.join(", "),
      });
    }
    if (stalePending.length > 0) {
      alerts.push({
        kind: "stale_pending", severity: "info",
        title: `${stalePending.length} rapport${stalePending.length > 1 ? "s" : ""} en attente de validation depuis +${PENDING_DAYS} j`,
        detail: stalePending.map((p) => `${p.name} (${p.date})`).join(", "),
      });
    }

    return NextResponse.json({ alerts, today });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
