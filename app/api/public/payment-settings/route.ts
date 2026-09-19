import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PLAN_LIMITS } from "@/lib/plans";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export async function GET() {
  const { data } = await adminClient
    .from("superadmin_settings")
    .select("key, value")
    .in("key", ["wave_phone", "om_phone", "price_standard", "price_pro", "price_enterprise", "company_name"]);

  const map: Record<string, string> = {};
  (data ?? []).forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });

  return NextResponse.json({
    wavePhone: map["wave_phone"] || "",
    omPhone: map["om_phone"] || "",
    companyName: map["company_name"] || "M3A Solutions",
    // Repli sur le barème réel (lib/plans.ts) et non des constantes figées :
    // les anciens 25 000 / 50 000 divergeaient des prix réellement facturés
    // (35 000 / 75 000 / 100 000) et sous-affichaient le tarif au prospect.
    prices: {
      standard: parseInt(map["price_standard"] || String(PLAN_LIMITS.standard.priceXOF)),
      pro: parseInt(map["price_pro"] || String(PLAN_LIMITS.pro.priceXOF)),
      enterprise: parseInt(map["price_enterprise"] || String(PLAN_LIMITS.enterprise.priceXOF)),
    },
  });
}
