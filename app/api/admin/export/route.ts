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

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  return [
    headers.join(","),
    ...rows.map(r => headers.map(h => escape(r[h])).join(",")),
  ].join("\n");
}

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();

    // Verify plan allows CSV export
    const { data: tenant } = await admin.from("tenants").select("plan").eq("id", tenantId).single();
    const limits = getPlanLimits(tenant?.plan || "standard");
    if (!limits.canExportCSV) {
      return NextResponse.json(
        { error: "L'export CSV est réservé au plan Pro. Passez au plan supérieur pour accéder à cette fonctionnalité." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const resource = searchParams.get("resource") || "reports";
    const dateFrom = searchParams.get("dateFrom") || null;
    const dateTo = searchParams.get("dateTo") || null;
    const driverId = searchParams.get("driverId") || null;

    let data: Record<string, unknown>[] = [];
    let filename = "export.csv";

    if (resource === "reports") {
      let q = admin.from("daily_reports").select("date,driver_id,vehicle_id,gross_revenue,commission,net_revenue,km_driven,trips_count,fuel_cost,status,notes").eq("tenant_id", tenantId).order("date", { ascending: false }).limit(5000);
      if (dateFrom) q = q.gte("date", dateFrom) as any;
      if (dateTo) q = q.lte("date", dateTo) as any;
      if (driverId) q = q.eq("driver_id", driverId) as any;
      const { data: rows } = await q;
      data = rows || [];
      filename = `rapports_${new Date().toISOString().split("T")[0]}.csv`;
    } else if (resource === "payments") {
      let q = admin.from("payments").select("payment_date,driver_id,amount,type,notes").eq("tenant_id", tenantId).order("payment_date", { ascending: false }).limit(5000);
      if (dateFrom) q = q.gte("payment_date", dateFrom) as any;
      if (dateTo) q = q.lte("payment_date", dateTo) as any;
      if (driverId) q = q.eq("driver_id", driverId) as any;
      const { data: rows } = await q;
      data = rows || [];
      filename = `paiements_${new Date().toISOString().split("T")[0]}.csv`;
    } else if (resource === "drivers") {
      const { data: rows } = await admin.from("profiles").select("driver_id,full_name,email,created_at").eq("tenant_id", tenantId).eq("role", "driver").order("driver_id");
      data = rows || [];
      filename = `chauffeurs_${new Date().toISOString().split("T")[0]}.csv`;
    } else {
      return NextResponse.json({ error: "resource invalide. Valeurs : reports, payments, drivers" }, { status: 400 });
    }

    const csv = toCSV(data);

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
