import { NextRequest, NextResponse } from "next/server";
import { runDailyBatch } from "@/lib/ai/batch";
import { isAiEnabled } from "@/lib/ai/killSwitch";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Batch quotidien de la couche IA — déclenché par Vercel Cron (06h00 UTC =
 * 06h00 Dakar, cf. vercel.json). Auth : Authorization: Bearer CRON_SECRET
 * (header envoyé automatiquement par Vercel Cron).
 * Première instruction : kill-switch — flag off → rien n'est lu ni écrit.
 */
async function handle(req: NextRequest) {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  const auth = (req.headers.get("authorization") ?? "").trim();
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!(await isAiEnabled())) {
    return NextResponse.json({ skipped: true, reason: "ai_layer_disabled" });
  }

  const params = new URL(req.url).searchParams;
  const onlyTenant = params.get("tenantId") ?? undefined;
  const forceWeekly = params.get("weekly") === "1"; // force les règles hebdo hors dimanche
  const results = await runDailyBatch(onlyTenant, { forceWeekly });
  return NextResponse.json({ ran: results.length, results });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
