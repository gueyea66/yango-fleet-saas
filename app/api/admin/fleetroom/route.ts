import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";
import { ingestFleetroom, type FleetroomFile } from "@/lib/fleetroom/ingest";
import { analyserDepot } from "@/lib/fleetroom/apercu";

// Un export journalier pèse ~100 Ko ; un mois ~2 Mo. La limite Vercel du corps
// de requête (4,5 Mo) borne un dépôt à ~2 mois : l'historique long passe par
// scripts/fleetroom-import.ts.
export const maxDuration = 300;

const serviceClient = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

/* ── GET — derniers dépôts + nombre d'écarts ouverts ── */
export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    const db = serviceClient.schema("fleet");
    const [imports, conflicts, last] = await Promise.all([
      db.from("fleetroom_imports")
        .select("id, kind, file_name, period_from, period_to, rows_total, rows_new, rows_known, created_at")
        .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(30),
      db.from("fleetroom_conflicts").select("jour", { count: "exact", head: true })
        .eq("tenant_id", tenantId).eq("resolved", false),
      db.from("yango_transactions").select("jour").eq("tenant_id", tenantId)
        .order("jour", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (imports.error) throw imports.error;
    return NextResponse.json({
      imports: imports.data,
      openConflicts: conflicts.count ?? 0,
      lastDay: last.data?.jour ?? null,
    });
  } catch (err) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}

/* ── POST — dépôt des exports (multipart : files[], soldesJour?, mode?, confirme?) ──
 *   mode=analyse : aperçu jour par jour et alertes, RIEN n'est écrit ;
 *   sinon        : intégration, refusée sans confirme=1 (le gestionnaire a vu l'aperçu). */
export async function POST(req: NextRequest) {
  try {
    // Ouvert à tout administrateur, opérateur « saisie seule » compris (décision
    // d'Abdou, 07/10/2026 : l'opérateur dépose chaque matin, le valideur valide les
    // saisies manuelles). Les exports Yango sont une donnée tierce, non une saisie :
    // les déclarations qui en sortent restent directement validées. Garde-fou :
    // aperçu et confirmation obligatoires ; trancher un écart reste réservé au valideur.
    const { tenantId, userId } = await requireAdminAuth();
    const form = await req.formData();
    const soldesJour = (form.get("soldesJour") as string | null) || undefined;
    const files: FleetroomFile[] = [];
    for (const f of form.getAll("files")) {
      if (typeof f === "string") continue;
      files.push({ name: f.name, text: await f.text(), soldesJour });
    }
    if (files.length === 0) {
      return NextResponse.json({ error: "Aucun fichier reçu" }, { status: 400 });
    }
    if (form.get("mode") === "analyse") {
      return NextResponse.json(await analyserDepot(serviceClient, tenantId, files, new Date().toISOString().slice(0, 10)));
    }
    if (form.get("confirme") !== "1") {
      return NextResponse.json({ error: "Confirmation requise : vérifiez l'aperçu avant d'intégrer." }, { status: 400 });
    }
    const result = await ingestFleetroom(serviceClient, tenantId, files, userId);
    return NextResponse.json(result);
  } catch (err) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
