import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
    prices: {
      standard: parseInt(map["price_standard"] || "25000"),
      pro: parseInt(map["price_pro"] || "50000"),
      enterprise: parseInt(map["price_enterprise"] || "100000"),
    },
  });
}
