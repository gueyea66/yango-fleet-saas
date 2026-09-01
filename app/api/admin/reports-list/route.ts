import { NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { listStoredReports } from "@/lib/reportHtml";

export const dynamic = "force-dynamic";

/**
 * Liste des rapports d'activité poussés pour CE tenant (bucket privé, préfixe tenant).
 *
 * Une erreur de stockage remonte telle quelle : renvoyer une liste vide sur
 * incident faisait passer une panne de lecture pour « aucun rapport reçu »,
 * indistinguable et impossible à diagnostiquer depuis l'interface.
 */
export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    const reports = (await listStoredReports(tenantId))
      .map((f) => ({ name: f.name, created_at: f.created_at }));
    return NextResponse.json({ reports });
  } catch (err) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message || "Erreur serveur" }, { status: e.status ?? 500 });
  }
}
