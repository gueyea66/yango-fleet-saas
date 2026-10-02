import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { chunk, countUploadsByRef, expenseRangeOr, isoDayOrNull } from "@/lib/v2/history";

/* eslint-disable @typescript-eslint/no-explicit-any -- lignes non typées (convention du projet) */

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

/** Paquets d'ids pour le comptage des pièces : garde l'URL PostgREST courte. */
const IDS_PAR_REQUETE = 150;

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();

    const { searchParams } = new URL(req.url);
    const driverId = searchParams.get("driverId") || null;
    const driverIds = (searchParams.get("driverIds") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (driverId && driverIds.length === 0) driverIds.push(driverId);
    const dateFrom = isoDayOrNull(searchParams.get("dateFrom"));
    const dateTo = isoDayOrNull(searchParams.get("dateTo"));
    const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
    const pageSize = Math.min(500, Math.max(10, parseInt(searchParams.get("pageSize") || "300")));
    const offset = (page - 1) * pageSize;

    const dQ = (q: any) => driverIds.length ? q.in("driver_id", driverIds) : q;
    const dateQ = (q: any) => {
      if (dateFrom) q = q.gte("date", dateFrom);
      if (dateTo) q = q.lte("date", dateTo);
      return q;
    };
    const expRange = expenseRangeOr(dateFrom, dateTo);

    // Historique incomplet (retour Abdou 01/10) : sans période, seuls les 300
    // derniers rapports et 500 dernières dépenses remontaient — tout le reste
    // disparaissait sans message. Avec une période, on lit TOUT ce qu'elle
    // contient (fetchAllRows, ordre stable obligatoire) ; sans période, le
    // comportement d'origine reste (rapports paginés, 500 dernières dépenses).
    const reportsBuild = () => dateQ(dQ(admin.from("daily_reports").select("*").eq("tenant_id", tenantId)))
      .order("date", { ascending: false }).order("id", { ascending: true });
    const expensesBuild = () => {
      let q = dQ(admin.from("expenses").select("*").eq("tenant_id", tenantId));
      if (expRange) q = q.or(expRange);
      return q.order("expense_date", { ascending: false, nullsFirst: false }).order("id", { ascending: true });
    };

    const ranged = Boolean(dateFrom || dateTo);
    const [reportsRes, expenses, { data: profiles }] = await Promise.all([
      ranged
        ? fetchAllRows(reportsBuild).then((rows) => ({ data: rows, count: rows.length }))
        : dateQ(dQ(admin.from("daily_reports").select("*", { count: "exact" }).eq("tenant_id", tenantId)))
          .order("date", { ascending: false })
          .range(offset, offset + pageSize - 1),
      // sans période (file de validation) : 500 dernières dépenses, comme avant
      ranged ? fetchAllRows(expensesBuild) : expensesBuild().limit(500).then((r: any) => { if (r.error) throw new Error(r.error.message); return r.data || []; }),
      admin.from("profiles").select("id,full_name,driver_id").eq("tenant_id", tenantId).eq("role", "driver"),
    ]);
    const reports: any[] = reportsRes.data || [];
    const reportsTotal: number = reportsRes.count ?? 0;

    // Indicateur « 📷 n » de la liste : nombre de pièces par ligne, en une
    // passe par paquet d'ids (ref_id), toujours cloisonné au tenant. Les pièces
    // héritées rattachées seulement par leur chemin ne sont pas comptées ici
    // (elles restent visibles dans le panneau de détail).
    const ids = [...reports.map((r: any) => r.id), ...(expenses as any[]).map((e: any) => e.id)].filter(Boolean);
    // lots de 5 requêtes en parallèle au plus (pas de rafale sur PostgREST)
    const uploadRows: { ref_id: string | null }[] = [];
    const parts = chunk(ids, IDS_PAR_REQUETE);
    for (let i = 0; i < parts.length; i += 5) {
      const res = await Promise.all(parts.slice(i, i + 5).map(async (part) => {
        const { data, error } = await admin.from("uploads").select("ref_id")
          .eq("tenant_id", tenantId).in("ref_id", part);
        if (error) { console.error("[admin/reports] comptage des pièces :", error.message); return []; }
        return data || [];
      }));
      uploadRows.push(...res.flat());
    }
    const uploadCounts = countUploadsByRef(uploadRows);

    const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
    const expensesWithProfile = (expenses as any[]).map((e: any) => ({ ...e, _profile: profileMap[e.driver_id] }));
    // Le nom du chauffeur doit accompagner les RAPPORTS aussi (retour Abdou
    // 02/09 : la file de validation n'affichait qu'un bout d'UUID).
    const reportsWithProfile = reports.map((r: any) => ({ ...r, _profile: profileMap[r.driver_id] }));

    return Response.json({
      reports: reportsWithProfile,
      expenses: expensesWithProfile,
      uploadCounts,
      pagination: ranged
        ? { page: 1, pageSize: reportsTotal, total: reportsTotal, totalPages: 1 }
        : { page, pageSize, total: reportsTotal, totalPages: Math.ceil(reportsTotal / pageSize) },
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    return Response.json({ error: err.message }, { status });
  }
}
