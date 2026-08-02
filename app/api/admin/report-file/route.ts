import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";
import { REPORTS_BUCKET } from "@/lib/reportHtml";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

/**
 * Sert un rapport stocké de CE tenant. `name` est un nom de fichier simple —
 * tout séparateur de chemin est refusé (pas d'accès hors du préfixe tenant).
 */
export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const name = new URL(req.url).searchParams.get("name") || "";
    if (!name || name.includes("/") || name.includes("\\") || name.includes("..") || !name.endsWith(".html")) {
      return NextResponse.json({ error: "nom de fichier invalide" }, { status: 400 });
    }
    const { data, error } = await admin.storage.from(REPORTS_BUCKET).download(`${tenantId}/${name}`);
    if (error || !data) return NextResponse.json({ error: "rapport introuvable" }, { status: 404 });
    return new NextResponse(await data.text(), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message || "Erreur serveur" }, { status: e.status ?? 500 });
  }
}
