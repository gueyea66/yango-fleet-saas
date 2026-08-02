import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { buildReportHtml, getReportAddonTenants } from "@/lib/reportHtml";

export const dynamic = "force-dynamic";

// Rapport d'activité à la demande (admin client). Service complémentaire :
// activé PAR TENANT depuis la console super admin — indépendant du plan.
// La génération elle-même vit dans lib/reportHtml.ts (partagée avec la
// génération en lot super admin et le cron mensuel).
export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();

    const addonTenants = await getReportAddonTenants();
    if (!addonTenants.includes(tenantId)) {
      return NextResponse.json(
        { error: "Le rapport d'activité est un service complémentaire non activé sur ce compte. Contactez M3A Group pour l'activer." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const now = new Date();
    const defFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const dateFrom = searchParams.get("dateFrom") || defFrom;
    const dateTo = searchParams.get("dateTo") || now.toISOString().slice(0, 10);

    const { html } = await buildReportHtml(tenantId, dateFrom, dateTo);
    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message || "Erreur serveur" }, { status: e.status ?? 500 });
  }
}
