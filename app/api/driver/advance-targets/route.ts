import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { requireAnyAuth } from "@/lib/auth/server";
import { isDriverActiveToday } from "@/lib/drivers";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

/**
 * Destinataires possibles d'une avance propriétaire (« Décaissement
 * propriétaire ») : chauffeurs actifs du tenant. Réservé aux admins et aux
 * comptes techniques (ex. « Founder ») — un chauffeur normal ne voit pas la
 * liste de ses collègues (RLS conservée côté client, ici service role).
 */
export async function GET() {
  try {
    const { tenantId, userId, role } = await requireAnyAuth();

    if (role !== "admin") {
      const { data: me } = await admin.from("profiles")
        .select("account_type").eq("id", userId).single();
      if (me?.account_type !== "technical") {
        return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
      }
    }

    const { data: drivers } = await admin.from("profiles")
      .select("id, full_name, active, account_type, hire_date, contract_end_date")
      .eq("tenant_id", tenantId).eq("role", "driver");

    const targets = (drivers || [])
      .filter((d) => isDriverActiveToday(d))
      .map((d) => ({ id: d.id, full_name: d.full_name || "Chauffeur" }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name, "fr"));

    return NextResponse.json({ targets });
  } catch (err) {
    const e = err as Error & { status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
  }
}
