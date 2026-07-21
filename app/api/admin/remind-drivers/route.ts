import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";
import { sendNotification } from "@/lib/notifications";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

const todayStr = () => new Date().toISOString().split("T")[0];

/** Chauffeurs actifs sans rapport (soumis ou validé) pour aujourd'hui. */
async function findMissing(tenantId: string) {
  const today = todayStr();
  const [{ data: drivers }, { data: reports }] = await Promise.all([
    admin.from("profiles").select("id, driver_id, full_name")
      .eq("tenant_id", tenantId).eq("role", "driver").eq("active", true),
    admin.from("daily_reports").select("driver_id")
      .eq("tenant_id", tenantId).eq("date", today).in("status", ["submitted", "approved"]),
  ]);
  const submitted = new Set((reports || []).map((r: any) => r.driver_id));
  return (drivers || []).filter((d: any) => !submitted.has(d.id));
}

export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    const missing = await findMissing(tenantId);
    return NextResponse.json({
      count: missing.length,
      drivers: missing.map((d: any) => ({ id: d.id, name: d.full_name || d.driver_id })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

export async function POST(_req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const missing = await findMissing(tenantId);
    if (missing.length === 0) return NextResponse.json({ reminded: 0, names: [] });

    const results = await Promise.allSettled(
      missing.map((d: any) => {
        const first = (d.full_name || "").split(" ")[0] || "chauffeur";
        return sendNotification(
          tenantId, d.id, "report_reminder",
          "Rappel — rapport du jour",
          `Bonjour ${first}, pensez à soumettre votre rapport d'aujourd'hui.`,
          { url: "/driver" }
        );
      })
    );
    const reminded = results.filter((r) => r.status === "fulfilled").length;
    return NextResponse.json({
      reminded,
      names: missing.map((d: any) => d.full_name || d.driver_id),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
