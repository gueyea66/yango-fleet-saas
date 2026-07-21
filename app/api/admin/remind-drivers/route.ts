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

// Les rapports se soumettent EN FIN DE JOURNÉE : le jour en cours n'est pas encore
// dû. La relance porte donc sur la veille (J-1), dernier jour complet.
const refDayStr = () => new Date(Date.now() - 86400_000).toISOString().split("T")[0];

/** Chauffeurs actifs sans rapport (soumis ou validé) pour la veille (J-1). */
async function findMissing(tenantId: string) {
  const ref = refDayStr();
  const [{ data: drivers }, { data: reports }] = await Promise.all([
    admin.from("profiles").select("*")
      .eq("tenant_id", tenantId).eq("role", "driver").eq("active", true),
    admin.from("daily_reports").select("driver_id")
      .eq("tenant_id", tenantId).eq("date", ref).in("status", ["submitted", "approved"]),
  ]);
  const submitted = new Set((reports || []).map((r: any) => r.driver_id));
  // Exclut les comptes techniques et ceux embauchés après le jour de référence.
  return (drivers || []).filter((d: any) =>
    d.account_type !== "technical" && !submitted.has(d.id) && (!d.hire_date || d.hire_date <= ref));
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
          "Rappel — rapport manquant",
          `Bonjour ${first}, votre rapport d'hier n'a pas encore été soumis. Merci de le compléter.`,
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
