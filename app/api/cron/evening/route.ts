import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isDriverActiveOn } from "@/lib/drivers";
import { getTenantAdminIds, sendNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Rappels du soir (retour Abdou 02/09 — « un vrai système d'alerte ») :
 *  1. chauffeur actif sans rapport AUJOURD'HUI → rappel de soumission (in-app + push) ;
 *  2. assurance / visite technique qui expire → alerte admins à J-30/14/7/3/1/0 ;
 *  3. abonnement / essai qui expire → alerte admins à J-7/3/1.
 * Déclenché par GitHub Actions (20h05 Dakar) — les 2 crons Vercel sont pris.
 * Auth : Authorization: Bearer CRON_SECRET (même convention que le batch IA).
 */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

const EXPIRY_STEPS = new Set([30, 14, 7, 3, 1, 0]);
const PLAN_STEPS = new Set([7, 3, 1]);
const daysUntil = (dateStr: string, today: string) =>
  Math.round((Date.parse(dateStr) - Date.parse(today)) / 86_400_000);

async function handle(req: NextRequest) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = (req.headers.get("authorization") ?? "").trim();
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: tenants } = await admin.from("tenants")
    .select("id, name, plan, active, trial_ends_at, plan_expires_at").eq("active", true);

  let reminders = 0, expiries = 0, plans = 0;
  const errors: string[] = [];

  for (const t of tenants || []) {
    try {
      const [{ data: drivers }, { data: todayReps }, { data: vehicles }] = await Promise.all([
        admin.from("profiles")
          .select("id, full_name, active, account_type, hire_date, contract_end_date")
          .eq("tenant_id", t.id).eq("role", "driver"),
        admin.from("daily_reports").select("driver_id")
          .eq("tenant_id", t.id).eq("date", today).in("status", ["submitted", "approved"]),
        admin.from("vehicles").select("plate, insurance_expiry, visite_expiry")
          .eq("tenant_id", t.id).eq("status", "active"),
      ]);

      // 1) rappel de soumission du jour, chauffeur par chauffeur
      const submitted = new Set((todayReps || []).map((r) => r.driver_id));
      for (const d of drivers || []) {
        if (!isDriverActiveOn(d, today, { requireHired: true })) continue;
        if (submitted.has(d.id)) continue;
        await sendNotification(
          t.id, d.id, "report_reminder",
          "⏰ Rapport du jour",
          `Bonsoir ${(d.full_name || "").split(" ")[0] || "chauffeur"}, pensez à soumettre votre rapport d'aujourd'hui avant de terminer la journée.`,
          { url: "/driver" }
        );
        reminders++;
      }

      // 2) expirations véhicules → admins (paliers, pas de spam quotidien)
      const adminIds = await getTenantAdminIds(t.id);
      const notifyAdmins = async (type: Parameters<typeof sendNotification>[2], title: string, body: string, url: string) => {
        await Promise.allSettled(adminIds.map((aid) => sendNotification(t.id, aid, type, title, body, { url })));
      };
      for (const v of vehicles || []) {
        for (const [field, label] of [["insurance_expiry", "assurance"], ["visite_expiry", "visite technique"]] as const) {
          const exp = (v as Record<string, string | null>)[field];
          if (!exp) continue;
          const dd = daysUntil(exp, today);
          if (!EXPIRY_STEPS.has(dd)) continue;
          await notifyAdmins("vehicle_expiry",
            `🚗 ${label === "assurance" ? "Assurance" : "Visite technique"} — ${v.plate}`,
            dd === 0
              ? `L'${label === "assurance" ? "assurance" : "échéance de visite technique"} du véhicule ${v.plate} expire AUJOURD'HUI.`
              : `${label === "assurance" ? "L'assurance" : "La visite technique"} du véhicule ${v.plate} expire dans ${dd} jour${dd > 1 ? "s" : ""} (${exp}).`,
            "/admin");
          expiries++;
        }
      }

      // 3) abonnement / essai
      const planEnd = t.plan_expires_at ?? t.trial_ends_at;
      if (planEnd) {
        const dd = daysUntil(String(planEnd).slice(0, 10), today);
        if (PLAN_STEPS.has(dd)) {
          await notifyAdmins("plan_expiring", "⚠️ Abonnement bientôt expiré",
            `Votre ${t.plan === "trial" ? "période d'essai" : "abonnement"} expire dans ${dd} jour${dd > 1 ? "s" : ""}. Contactez-nous pour continuer sans interruption.`,
            "/paiement");
          plans++;
        }
      }
    } catch (e) {
      errors.push(`${t.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return NextResponse.json({ date: today, reminders, expiries, plans, errors });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
