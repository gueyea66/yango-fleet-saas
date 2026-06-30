import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp } from "@/lib/auth/server";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

async function getStoredKey(): Promise<string> {
  const { data } = await adminClient.from("superadmin_settings").select("value").eq("key", "access_key").single();
  // Fallback to env — jamais de valeur hardcodée
  return data?.value ?? process.env.SUPERADMIN_KEY ?? "";
}

export async function POST(req: NextRequest) {
  const { key } = await req.json();
  const storedKey = await getStoredKey();
  const ip = getClientIp(req);
  const ok = checkSuperadminKey(key, storedKey, ip);
  if (!ok) {
    // Ne pas distinguer "rate limited" de "mauvaise clé" (évite l'énumération)
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
