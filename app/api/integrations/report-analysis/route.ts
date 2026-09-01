import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { parseBlocks, AnalysisValidationError, LIMITS } from "@/lib/reportAnalysis";

export const dynamic = "force-dynamic";

/**
 * Ingestion de l'analyse externe injectée dans le rapport d'activité.
 *
 * Modèle PUSH : le système d'analyse pousse son résultat quand il est prêt ; la
 * génération du rapport le récupère si présent. Aucun appel sortant depuis le
 * cron mensuel, donc aucune dépendance à la disponibilité du système externe.
 *
 * Auth : Bearer REPORT_ANALYSIS_SECRET (même idiome que CRON_SECRET).
 * Le secret vaut pour tous les tenants — le tenant visé est dans le corps.
 */
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function authorized(req: NextRequest): boolean {
  const secret = (process.env.REPORT_ANALYSIS_SECRET ?? "").trim();
  if (!secret) return false;
  const auth = (req.headers.get("authorization") ?? "").trim();
  return auth === `Bearer ${secret}`;
}

/** Résout le tenant par UUID ou par slug — le producteur externe connaît souvent le slug. */
async function resolveTenant(body: Record<string, unknown>): Promise<string | null> {
  const id = typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  if (id) {
    const { data } = await admin.from("tenants").select("id").eq("id", id).maybeSingle();
    return data?.id ?? null;
  }
  const slug = typeof body.tenantSlug === "string" ? body.tenantSlug.trim() : "";
  if (slug) {
    const { data } = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    return data?.id ?? null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON invalide" }, { status: 400 }); }

  const dateFrom = String(body.dateFrom ?? "");
  const dateTo = String(body.dateTo ?? "");
  if (!DATE.test(dateFrom) || !DATE.test(dateTo)) {
    return NextResponse.json({ error: "dateFrom et dateTo requis au format AAAA-MM-JJ" }, { status: 400 });
  }
  if (dateTo < dateFrom) {
    return NextResponse.json({ error: "dateTo doit être postérieure ou égale à dateFrom" }, { status: 400 });
  }

  const tenantId = await resolveTenant(body);
  if (!tenantId) {
    return NextResponse.json({ error: "tenant introuvable (fournir tenantId ou tenantSlug)" }, { status: 404 });
  }

  let blocks;
  try {
    blocks = parseBlocks(body.blocks);
  } catch (e) {
    if (e instanceof AnalysisValidationError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }

  const summary = body.summary === undefined ? null : String(body.summary).slice(0, LIMITS.text);
  if (blocks.length === 0 && !summary) {
    return NextResponse.json({ error: "analyse vide : fournir `summary` et/ou `blocks`" }, { status: 400 });
  }

  const row = {
    tenant_id: tenantId,
    date_from: dateFrom,
    date_to: dateTo,
    source: String(body.source ?? "external").slice(0, 60) || "external",
    title: body.title === undefined ? null : String(body.title).slice(0, 200),
    summary,
    blocks,
    model: body.model === undefined ? null : String(body.model).slice(0, 120),
    generated_at: typeof body.generatedAt === "string" ? body.generatedAt : new Date().toISOString(),
    received_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from("report_analyses")
    .upsert(row, { onConflict: "tenant_id,date_from,date_to,source" });

  if (error) {
    const missing = /report_analyses|does not exist|schema cache/i.test(error.message);
    return NextResponse.json({
      error: missing
        ? `stockage impossible (${error.message}). La migration 046 est-elle appliquée ?`
        : error.message,
    }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    tenantId,
    period: { dateFrom, dateTo },
    source: row.source,
    blocks: blocks.length,
  });
}

/** Relecture de ce qui est stocké — pour vérifier une intégration sans générer de rapport. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const tenantId = await resolveTenant({
    tenantId: sp.get("tenantId") ?? undefined,
    tenantSlug: sp.get("tenantSlug") ?? undefined,
  });
  if (!tenantId) return NextResponse.json({ error: "tenant introuvable" }, { status: 404 });

  let q = admin.from("report_analyses")
    .select("date_from, date_to, source, title, model, generated_at, received_at, blocks")
    .eq("tenant_id", tenantId)
    .order("date_from", { ascending: false })
    .limit(24);

  const from = sp.get("dateFrom");
  const to = sp.get("dateTo");
  if (from && DATE.test(from)) q = q.eq("date_from", from);
  if (to && DATE.test(to)) q = q.eq("date_to", to);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    analyses: (data || []).map((r) => ({
      period: { dateFrom: r.date_from, dateTo: r.date_to },
      source: r.source,
      title: r.title,
      model: r.model,
      generatedAt: r.generated_at,
      receivedAt: r.received_at,
      blocks: Array.isArray(r.blocks) ? r.blocks.length : 0,
    })),
  });
}
