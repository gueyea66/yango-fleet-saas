/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * GET /api/admin/analytics — classement, KPI et extractions du gestionnaire.
 *
 *   ?report=catalog                         → rapports disponibles pour ce tenant
 *   ?report=<clé>&dateFrom&dateTo           → aperçu JSON (colonnes + lignes)
 *     [&driverIds=uuid,uuid] [&statut=approved|all] [&format=xlsx]
 *
 * Tenant : toujours celui de la session (requireAdminAuth), jamais un paramètre.
 * Le client service-role ignore la RLS : chaque requête filtre tenant_id.
 * Le fichier Excel suit la même règle de plan que l'export CSV.
 */
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { getPlanLimits } from "@/lib/plans";
import { CAT_AVANCE } from "@/lib/expenseCategories";
import { driverStats, sortStats } from "@/lib/analytics/driverStats";
import {
  REPORTS, isReportKey, classementColumns, classementRow, declarationsRows, depensesRows, paiementsRows,
  syntheseJourRows, kpiJourRows, coursesRows, type ReportResult,
} from "@/lib/analytics/reports";
import { buildXlsx } from "@/lib/analytics/xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DAYS = 366;
const ROW_CAP = 30_000; // plafond de fetchAllRows

const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const sp = new URL(req.url).searchParams;
    const report = sp.get("report") || "catalog";

    // Fleetroom : au moins une commande importée pour ce tenant ?
    // (présence d'une ligne, pas de COUNT exact à chaque appel)
    const { data: anyOrder } = await admin.from("yango_orders").select("order_id").eq("tenant_id", tenantId).limit(1);
    const tenantHasFleetroom = (anyOrder?.length ?? 0) > 0;

    if (report === "catalog") {
      return NextResponse.json({ reports: REPORTS.filter((r) => !r.fleetroom || tenantHasFleetroom), hasFleetroom: tenantHasFleetroom });
    }
    if (!isReportKey(report)) return bad("Rapport inconnu");

    const dateFrom = sp.get("dateFrom") || "", dateTo = sp.get("dateTo") || "";
    if (!ISO.test(dateFrom) || !ISO.test(dateTo) || dateFrom > dateTo) return bad("Période invalide (dateFrom ≤ dateTo, AAAA-MM-JJ)");
    if ((Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000 + 1 > MAX_DAYS) return bad("Période limitée à 366 jours");
    const driverIds = (sp.get("driverIds") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (driverIds.some((id) => !UUID.test(id))) return bad("Identifiant chauffeur invalide");
    const statut = sp.get("statut") === "all" ? "all" : "approved";
    const format = sp.get("format") === "xlsx" ? "xlsx" : "json";

    if (format === "xlsx") {
      const { data: tenant } = await admin.from("tenants").select("plan").eq("id", tenantId).single();
      if (!getPlanLimits(tenant?.plan || "standard").canExportCSV) {
        return bad("L'export Excel est réservé au plan Pro. Passez au plan supérieur pour y accéder.", 403);
      }
    }

    // Chauffeurs du tenant (noms + rattachement Yango)
    const { data: profiles, error: pErr } = await admin.from("profiles")
      .select("id, full_name, driver_id, yango_driver_id, active, account_type")
      .eq("tenant_id", tenantId).eq("role", "driver");
    if (pErr) throw new Error(pErr.message);
    const drivers = (profiles || []).filter((p: any) => !driverIds.length || driverIds.includes(p.id));
    const nameOf = (id: string) => { const p = (profiles || []).find((x: any) => x.id === id); return p?.full_name || p?.driver_id || "Chauffeur"; };
    const byYango = new Map((profiles || []).filter((p: any) => p.yango_driver_id).map((p: any) => [p.yango_driver_id, p]));
    const nameOfYango = (yid: string, fallback?: string | null) => { const p: any = byYango.get(yid); return p?.full_name || fallback || yid; };
    const yangoIds = drivers.map((d: any) => d.yango_driver_id).filter(Boolean) as string[];

    const scopeDrivers = (q: any, col = "driver_id") => (driverIds.length ? q.in(col, driverIds) : q);
    // dépenses : date de dépense, ou date de saisie pour les anciennes lignes sans expense_date
    // (dates validées par ISO ci-dessus : pas d'injection possible dans le filtre)
    const expenseInPeriod = (q: any) => q.or(`and(expense_date.gte.${dateFrom},expense_date.lte.${dateTo}),and(expense_date.is.null,created_at.gte.${dateFrom},created_at.lte.${dateTo}T23:59:59)`);
    // validées (NULL = ancienne ligne, validée) ; « all » ajoute les en attente — jamais les rejetées
    const keepExpenseStatus = (st: string | null) => st == null || st === "approved" || (statut === "all" && st === "submitted");
    const readReports = (cols = "*") => fetchAllRows(() => {
      let q = admin.from("daily_reports").select(cols).eq("tenant_id", tenantId).gte("date", dateFrom).lte("date", dateTo);
      q = statut === "all" ? q.in("status", ["approved", "submitted"]) : q.eq("status", "approved");
      return scopeDrivers(q).order("date").order("id");
    });
    const readOrders = (cols: string) => {
      if (driverIds.length && !yangoIds.length) return Promise.resolve([] as any[]);
      return fetchAllRows(() => {
        let q = admin.from("yango_orders").select(cols).eq("tenant_id", tenantId).gte("jour", dateFrom).lte("jour", dateTo);
        if (driverIds.length) q = q.in("yango_driver_id", yangoIds);
        return q.order("jour").order("order_id");
      });
    };

    let result: Omit<ReportResult, "report" | "title" | "hasFleetroom">;
    let hasFleetroom = false;

    switch (report) {
      case "classement": {
        const [reports, orders, expenses, seeds] = await Promise.all([
          readReports("driver_id,date,status,comment,yango_gross,yango_bonus,off_yango_revenue,yango_trip_count,off_yango_trip_count,net_after_expenses,end_odometer"),
          tenantHasFleetroom ? readOrders("yango_driver_id,jour,status,cancel_reason,started_at,ended_at,distance_m,cash,cashless") : Promise.resolve([]),
          // statut / catégorie filtrés en JS : NULL compte comme validé et hors avance,
          // comme le tableau de bord (un .in / .neq PostgREST écarterait les NULL)
          fetchAllRows(() => scopeDrivers(expenseInPeriod(admin.from("expenses").select("driver_id,amount,category,status,expense_date")
            .eq("tenant_id", tenantId))).order("id"))
            .then((rows: any[]) => rows.filter((e) => keepExpenseStatus(e.status) && e.category !== CAT_AVANCE)),
          // amorce du km compteur : dernière déclaration validée avec compteur avant la
          // période (fenêtre de 180 jours : un chauffeur absent plus longtemps repart à 0)
          fetchAllRows(() => scopeDrivers(admin.from("daily_reports").select("driver_id,date,end_odometer")
            .eq("tenant_id", tenantId).eq("status", "approved").gt("end_odometer", 0)
            .lt("date", dateFrom).gte("date", new Date(Date.parse(dateFrom) - 180 * 86_400_000).toISOString().slice(0, 10)))
            .order("date").order("id")),
        ]);
        const stats = driverStats({ drivers, reports, seeds, expenses, orders });
        hasFleetroom = stats.hasFleetroom;
        const sorted = sortStats(stats.rows, "ca");
        result = { columns: classementColumns(hasFleetroom), rows: sorted.map(classementRow), truncated: reports.length >= ROW_CAP || orders.length >= ROW_CAP };
        break;
      }
      case "declarations": {
        const reports = await readReports("id,driver_id,date,status,source,comment,yango_gross,yango_bonus,off_yango_revenue,yango_trip_count,off_yango_trip_count,commission_amount,net_after_expenses,solde_yango,end_odometer");
        result = { ...declarationsRows(reports, nameOf), truncated: reports.length >= ROW_CAP };
        break;
      }
      case "synthese_jour": {
        const reports = await readReports("driver_id,date,comment,yango_gross,yango_bonus,off_yango_revenue,yango_trip_count,off_yango_trip_count,net_after_expenses");
        result = { ...syntheseJourRows(reports), truncated: reports.length >= ROW_CAP };
        break;
      }
      case "depenses": {
        const expenses = await fetchAllRows(() => {
          let q = admin.from("expenses").select("id,driver_id,expense_date,created_at,category,amount,fuel_liters,status,source,description")
            .eq("tenant_id", tenantId);
          q = expenseInPeriod(q);
          return scopeDrivers(q).order("id");
        }).then((rows: any[]) => rows.filter((e) => keepExpenseStatus(e.status)));
        // nombre de pièces jointes par dépense (uploads.ref_id), par lots
        const pieces = new Map<string, number>();
        const ids = expenses.map((e: any) => e.id);
        for (let i = 0; i < ids.length; i += 300) { // lots séquentiels : pas de rafale de requêtes
          const { data } = await admin.from("uploads").select("ref_id").eq("tenant_id", tenantId).in("ref_id", ids.slice(i, i + 300));
          for (const u of data || []) pieces.set(u.ref_id, (pieces.get(u.ref_id) ?? 0) + 1);
        }
        result = { ...depensesRows(expenses, nameOf, (id) => pieces.get(id) ?? 0), truncated: expenses.length >= ROW_CAP };
        break;
      }
      case "paiements": {
        const payments = await fetchAllRows(() => scopeDrivers(admin.from("payments").select("id,driver_id,payment_date,salary_month,type,amount,notes")
          .eq("tenant_id", tenantId).gte("payment_date", dateFrom).lte("payment_date", dateTo)).order("payment_date").order("id"));
        result = { ...paiementsRows(payments, nameOf), truncated: payments.length >= ROW_CAP };
        break;
      }
      case "kpi_jour":
      case "courses": {
        if (!tenantHasFleetroom) return bad("Aucune donnée Fleetroom pour ce compte", 404);
        const cols = report === "courses"
          ? "order_code,status,cancel_reason,yango_driver_id,driver_name,plate,started_at,ended_at,jour,address_from,address_to,service_class,distance_m,cash,cashless,commission"
          : "yango_driver_id,driver_name,jour,status,cancel_reason,started_at,ended_at,distance_m,cash,cashless";
        const orders = await readOrders(cols);
        hasFleetroom = orders.length > 0;
        result = { ...(report === "courses" ? coursesRows(orders, nameOfYango) : kpiJourRows(orders, nameOfYango)), truncated: orders.length >= ROW_CAP };
        break;
      }
    }

    const title = REPORTS.find((r) => r.key === report)!.label;
    const payload: ReportResult = { report, title, hasFleetroom, ...result! };

    if (format === "xlsx") {
      const buf = await buildXlsx({ ...payload, subtitle: `Du ${dateFrom.split("-").reverse().join("/")} au ${dateTo.split("-").reverse().join("/")}${statut === "all" ? " · validées + en attente" : " · validées"}` });
      const filename = `${report}_${dateFrom}_${dateTo}.xlsx`;
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    console.error("analytics:", err);
    return NextResponse.json({ error: err?.status ? err.message : "Erreur lors de la génération" }, { status: err?.status ?? 500 });
  }
}
