import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { getPlanLimits } from "@/lib/plans";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

// CSV pensé pour la compta / Excel FR : séparateur ';' + BOM UTF-8 (accents),
// en-têtes lisibles. `columns` = liste ordonnée [entête, valeur].
function toCSV(rows: Record<string, unknown>[], headers: string[]): string {
  const SEP = ";";
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(SEP) || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.join(SEP),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(SEP)),
  ];
  return "﻿" + lines.join("\r\n"); // BOM pour Excel FR
}

const num = (v: unknown) => (v == null ? 0 : Math.round(Number(v)));
const today = () => new Date().toISOString().split("T")[0];

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();

    // Export CSV réservé au plan Pro
    const { data: tenant } = await admin.from("tenants").select("plan").eq("id", tenantId).single();
    const limits = getPlanLimits(tenant?.plan || "standard");
    if (!limits.canExportCSV) {
      return NextResponse.json(
        { error: "L'export CSV est réservé au plan Pro. Passez au plan supérieur pour y accéder." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const resource = searchParams.get("resource") || "reports";
    const dateFrom = searchParams.get("dateFrom") || null;
    const dateTo = searchParams.get("dateTo") || null;
    const driverId = searchParams.get("driverId") || null;

    // Table de correspondance id chauffeur (uuid) -> nom + code, pour un CSV lisible
    const { data: profiles } = await admin
      .from("profiles").select("id, driver_id, full_name")
      .eq("tenant_id", tenantId).eq("role", "driver");
    const nameOf = new Map((profiles || []).map((p: any) => [p.id, p.full_name || p.driver_id || ""]));
    const codeOf = new Map((profiles || []).map((p: any) => [p.id, p.driver_id || ""]));

    let rows: Record<string, unknown>[] = [];
    let headers: string[] = [];
    let filename = "export.csv";

    if (resource === "reports") {
      let q = admin.from("daily_reports")
        .select("date,driver_id,vehicle_id,end_odometer,yango_gross,yango_bonus,off_yango_revenue,commission_amount,net_after_expenses,solde_yango,yango_trip_count,off_yango_trip_count,status,comment")
        .eq("tenant_id", tenantId).or("source.eq.saas,source.is.null")
        .order("date", { ascending: false }).limit(10000);
      if (dateFrom) q = q.gte("date", dateFrom) as any;
      if (dateTo) q = q.lte("date", dateTo) as any;
      if (driverId) q = q.eq("driver_id", driverId) as any;
      const { data } = await q;
      headers = ["Date", "Chauffeur", "Compteur km", "Brut Yango", "Bonus Yango", "Hors Yango",
        "Commission", "Net après charges", "Solde wallet", "Courses Yango", "Courses hors", "Statut", "Commentaire"];
      rows = (data || []).map((r: any) => ({
        "Date": r.date,
        "Chauffeur": nameOf.get(r.driver_id) || r.driver_id,
        "Compteur km": r.end_odometer ?? "",
        "Brut Yango": num(r.yango_gross),
        "Bonus Yango": num(r.yango_bonus),
        "Hors Yango": num(r.off_yango_revenue),
        "Commission": num(r.commission_amount),
        "Net après charges": num(r.net_after_expenses),
        "Solde wallet": num(r.solde_yango),
        "Courses Yango": r.yango_trip_count ?? 0,
        "Courses hors": r.off_yango_trip_count ?? 0,
        "Statut": r.status,
        "Commentaire": r.comment ?? "",
      }));
      filename = `rapports_${today()}.csv`;
    } else if (resource === "expenses") {
      let q = admin.from("expenses")
        .select("expense_date,driver_id,category,amount,description,status")
        .eq("tenant_id", tenantId).order("expense_date", { ascending: false, nullsFirst: false }).limit(10000);
      if (dateFrom) q = q.gte("expense_date", dateFrom) as any;
      if (dateTo) q = q.lte("expense_date", dateTo) as any;
      if (driverId) q = q.eq("driver_id", driverId) as any;
      const { data } = await q;
      headers = ["Date", "Chauffeur", "Catégorie", "Montant", "Description", "Statut"];
      rows = (data || []).map((e: any) => ({
        "Date": e.expense_date ?? "",
        "Chauffeur": nameOf.get(e.driver_id) || e.driver_id || "",
        "Catégorie": e.category ?? "",
        "Montant": num(e.amount),
        "Description": e.description ?? "",
        "Statut": e.status ?? "",
      }));
      filename = `depenses_${today()}.csv`;
    } else if (resource === "payments") {
      let q = admin.from("payments")
        .select("payment_date,salary_month,driver_id,amount,type,notes")
        .eq("tenant_id", tenantId).order("payment_date", { ascending: false, nullsFirst: false }).limit(10000);
      if (dateFrom) q = q.gte("payment_date", dateFrom) as any;
      if (dateTo) q = q.lte("payment_date", dateTo) as any;
      if (driverId) q = q.eq("driver_id", driverId) as any;
      const { data } = await q;
      headers = ["Date paiement", "Mois salaire", "Chauffeur", "Montant", "Type", "Notes"];
      rows = (data || []).map((p: any) => ({
        "Date paiement": p.payment_date ?? "",
        "Mois salaire": p.salary_month ?? "",
        "Chauffeur": nameOf.get(p.driver_id) || p.driver_id || "",
        "Montant": num(p.amount),
        "Type": p.type ?? "",
        "Notes": p.notes ?? "",
      }));
      filename = `paiements_${today()}.csv`;
    } else if (resource === "recap") {
      // Récap comptable consolidé : une ligne par chauffeur (totaux de la période) + TOTAL.
      let repQ = admin.from("daily_reports")
        .select("driver_id,yango_gross,yango_bonus,off_yango_revenue,commission_amount,net_after_expenses")
        .eq("tenant_id", tenantId).eq("status", "approved").or("source.eq.saas,source.is.null").limit(20000);
      if (dateFrom) repQ = repQ.gte("date", dateFrom) as any;
      if (dateTo) repQ = repQ.lte("date", dateTo) as any;
      let expQ = admin.from("expenses").select("driver_id,amount,expense_date").eq("tenant_id", tenantId).limit(20000);
      if (dateFrom) expQ = expQ.gte("expense_date", dateFrom) as any;
      if (dateTo) expQ = expQ.lte("expense_date", dateTo) as any;
      const payQ = admin.from("payments").select("driver_id,amount,payment_date,salary_month").eq("tenant_id", tenantId).limit(20000);
      const [{ data: reps }, { data: exps }, { data: pays }] = await Promise.all([repQ, expQ, payQ]);

      const salaryDate = (p: any) => (p.salary_month ? String(p.salary_month).slice(0, 10) : p.payment_date) || "";
      const inPeriod = (d: string) => (!dateFrom || d >= dateFrom) && (!dateTo || d <= dateTo);

      type Agg = { jours: number; brut: number; bonus: number; hors: number; comm: number; net: number; dep: number; sal: number };
      const acc = new Map<string, Agg>();
      const get = (id: string) => {
        if (!acc.has(id)) acc.set(id, { jours: 0, brut: 0, bonus: 0, hors: 0, comm: 0, net: 0, dep: 0, sal: 0 });
        return acc.get(id)!;
      };
      (reps || []).forEach((r: any) => {
        const a = get(r.driver_id);
        a.jours += 1; a.brut += r.yango_gross || 0; a.bonus += r.yango_bonus || 0;
        a.hors += r.off_yango_revenue || 0; a.comm += r.commission_amount || 0; a.net += r.net_after_expenses || 0;
      });
      (exps || []).forEach((e: any) => { get(e.driver_id).dep += e.amount || 0; });
      (pays || []).filter((p: any) => inPeriod(salaryDate(p))).forEach((p: any) => { get(p.driver_id).sal += p.amount || 0; });

      headers = ["Chauffeur", "Jours", "Brut Yango", "Bonus", "Hors Yango", "Commission",
        "Net après charges", "Dépenses", "Salaire versé", "Net final"];
      const built = Array.from(acc.entries())
        .map(([id, a]) => ({ name: nameOf.get(id) || id, a }))
        .sort((x, y) => x.name.localeCompare(y.name));
      const tot: Agg = { jours: 0, brut: 0, bonus: 0, hors: 0, comm: 0, net: 0, dep: 0, sal: 0 };
      rows = built.map(({ name, a }) => {
        (Object.keys(tot) as (keyof Agg)[]).forEach((k) => (tot[k] += a[k]));
        return {
          "Chauffeur": name, "Jours": a.jours, "Brut Yango": num(a.brut), "Bonus": num(a.bonus),
          "Hors Yango": num(a.hors), "Commission": num(a.comm), "Net après charges": num(a.net),
          "Dépenses": num(a.dep), "Salaire versé": num(a.sal), "Net final": num(a.net - a.dep - a.sal),
        };
      });
      rows.push({
        "Chauffeur": "TOTAL", "Jours": tot.jours, "Brut Yango": num(tot.brut), "Bonus": num(tot.bonus),
        "Hors Yango": num(tot.hors), "Commission": num(tot.comm), "Net après charges": num(tot.net),
        "Dépenses": num(tot.dep), "Salaire versé": num(tot.sal), "Net final": num(tot.net - tot.dep - tot.sal),
      });
      filename = `recap_${dateFrom || "debut"}_${dateTo || today()}.csv`;
    } else if (resource === "drivers") {
      const { data } = await admin.from("profiles").select("driver_id,full_name,email,created_at")
        .eq("tenant_id", tenantId).eq("role", "driver").order("driver_id");
      headers = ["Code", "Nom", "Email", "Créé le"];
      rows = (data || []).map((d: any) => ({
        "Code": d.driver_id ?? "", "Nom": d.full_name ?? "", "Email": d.email ?? "",
        "Créé le": d.created_at?.slice(0, 10) ?? "",
      }));
      filename = `chauffeurs_${today()}.csv`;
    } else {
      return NextResponse.json({ error: "resource invalide. Valeurs : reports, expenses, payments, drivers" }, { status: 400 });
    }

    const csv = toCSV(rows, headers);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
