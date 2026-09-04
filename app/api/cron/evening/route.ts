import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isDriverActiveOn } from "@/lib/drivers";
import { getTenantAdminIds, sendNotification, sendTelegramToTenant } from "@/lib/notifications";
import { CAT_AVANCE } from "@/lib/expenseCategories";

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
const AVANCE_STEPS = new Set([7, 14]); // jours depuis la remise de l'avance
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

  let reminders = 0, expiries = 0, plans = 0, avancesAlerts = 0;
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
        await sendTelegramToTenant(t.id, title, body); // canal garanti, 1× par événement
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

      // 4) avances propriétaire non justifiées (Décaissement propriétaire avec
      // destinataire) : alerte admins à J+7 et J+14 exactement (pas de spam) si
      // les charges déclarées par le chauffeur depuis l'avance restent inférieures
      // au montant remis. Neutres pour le résultat — c'est un suivi de cash.
      try {
        const { data: advRows } = await admin.from("expenses")
          .select("advance_driver_id, amount, expense_date, category, status")
          .eq("tenant_id", t.id).eq("category", CAT_AVANCE)
          .not("advance_driver_id", "is", null)
          .gte("expense_date", new Date(Date.now() - 15 * 86_400_000).toISOString().slice(0, 10));
        const dueRows = (advRows || []).filter((a) => {
          if (a.status && a.status !== "approved" && a.status !== "submitted") return false;
          const age = -daysUntil(a.expense_date, today);
          return AVANCE_STEPS.has(age);
        });
        if (dueRows.length) {
          const nameOf = new Map((drivers || []).map((d) => [d.id, d.full_name || "Chauffeur"]));
          for (const a of dueRows) {
            const { data: justRows } = await admin.from("expenses")
              .select("amount, category, status")
              .eq("tenant_id", t.id).eq("driver_id", a.advance_driver_id)
              .neq("category", CAT_AVANCE)
              .gte("expense_date", a.expense_date);
            const justifie = (justRows || [])
              .filter((e) => !e.status || e.status === "approved" || e.status === "submitted")
              .reduce((s, e) => s + (e.amount || 0), 0);
            if (justifie >= (a.amount || 0)) continue;
            const age = -daysUntil(a.expense_date, today);
            await notifyAdmins("advance_unjustified",
              `💸 Avance non justifiée — ${nameOf.get(a.advance_driver_id) || "Chauffeur"}`,
              `Avance de ${(a.amount || 0).toLocaleString("fr-FR")} XOF remise le ${a.expense_date} : seulement ${justifie.toLocaleString("fr-FR")} XOF de charges déclarées depuis (${age} jours). Demandez les justificatifs.`,
              "/admin");
            avancesAlerts++;
          }
        }
      } catch { /* colonne advance_driver_id absente (migration 046 pas encore appliquée) : étape ignorée */ }

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

  return NextResponse.json({ date: today, reminders, expiries, plans, avancesAlerts, errors });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
