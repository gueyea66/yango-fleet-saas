import { NextRequest, NextResponse } from "next/server";
import {
  generateAndStoreReport, getReportAddonTenants, getReportPremiumTenants, previousMonthRange,
} from "@/lib/reportHtml";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Génération mensuelle automatique des rapports d'activité — Vercel Cron du
 * 1er du mois (cf. vercel.json). Même auth que le batch IA : Bearer CRON_SECRET.
 * Pour chaque tenant dont l'add-on est activé : rapport du mois précédent,
 * stocké + notification à l'admin du client. Les tenants premium reçoivent la
 * narration multi-agent + le deep dive opérations du même mois.
 */
async function handle(req: NextRequest) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = (req.headers.get("authorization") ?? "").trim();
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [targets, premiumList] = await Promise.all([getReportAddonTenants(), getReportPremiumTenants()]);
  const { dateFrom, dateTo } = previousMonthRange();
  const generated: string[] = [];
  const errors: { tenantId: string; error: string }[] = [];
  for (const tid of targets) {
    const premium = premiumList.includes(tid);
    try {
      await generateAndStoreReport(tid, dateFrom, dateTo, { kind: "monthly", premium });
      if (premium) await generateAndStoreReport(tid, dateFrom, dateTo, { kind: "deepdive", premium });
      generated.push(tid);
    } catch (e) {
      errors.push({ tenantId: tid, error: e instanceof Error ? e.message : "?" });
    }
  }
  return NextResponse.json({ period: { dateFrom, dateTo }, generated: generated.length, errors });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
