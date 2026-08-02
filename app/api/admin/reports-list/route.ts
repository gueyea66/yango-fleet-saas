import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";
import { REPORTS_BUCKET } from "@/lib/reportHtml";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

/** Liste des rapports d'activité poussés pour CE tenant (bucket privé, préfixe tenant). */
export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    const { data, error } = await admin.storage.from(REPORTS_BUCKET)
      .list(tenantId, { sortBy: { column: "created_at", order: "desc" }, limit: 60 });
    if (error) return NextResponse.json({ reports: [] });
    const reports = (data || [])
      .filter((f) => f.name.endsWith(".html"))
      .map((f) => ({ name: f.name, created_at: f.created_at ?? null }));
    return NextResponse.json({ reports });
  } catch (err) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message || "Erreur serveur" }, { status: e.status ?? 500 });
  }
}
