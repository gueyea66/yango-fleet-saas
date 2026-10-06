import { NextRequest, NextResponse } from "next/server";
import {
  activeReportTenants, generateAndStoreReport, getReportAddonTenants, getReportPremiumTenants, monthToDateRange,
} from "@/lib/reportHtml";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Point hebdomadaire d'exploitation — Vercel Cron du lundi matin (cf.
 * vercel.json). Même auth que le rapport mensuel : Bearer CRON_SECRET.
 * Pour chaque tenant ACTIF dont l'add-on rapport est activé : le mois en
 * cours du 1er à la veille, stocké + notification à l'admin du client. Le
 * fichier porte la date de fin : chaque lundi laisse son point, le suivi
 * d'une semaine sur l'autre reste consultable dans « Rapports reçus ».
 */
async function handle(req: NextRequest) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = (req.headers.get("authorization") ?? "").trim();
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [addon, premiumList] = await Promise.all([getReportAddonTenants(), getReportPremiumTenants()]);
  const { dateFrom, dateTo } = monthToDateRange();
  // comptes désactivés, échus ou sans activité depuis le 1er : pas de point
  const { active: targets, skipped } = await activeReportTenants(addon, dateFrom, dateTo);
  const generated: string[] = [];
  const errors: { tenantId: string; error: string }[] = [];
  for (const tid of targets) {
    try {
      await generateAndStoreReport(tid, dateFrom, dateTo, { kind: "hebdo", premium: premiumList.includes(tid) });
      generated.push(tid);
    } catch (e) {
      errors.push({ tenantId: tid, error: e instanceof Error ? e.message : "?" });
    }
  }
  return NextResponse.json({ period: { dateFrom, dateTo }, generated: generated.length, skipped, errors });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
