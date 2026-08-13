import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp, rateLimitOk } from "@/lib/auth/server";

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
  const ip = getClientIp(req);
  // Rate-limit persistant (fix V4) : 8 tentatives / 15 min / IP, partagé
  // entre instances serverless. On répond 401 (indistinct d'une mauvaise clé).
  if (!(await rateLimitOk("sa-verify", ip, 8, 900))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { key } = await req.json();
  const storedKey = await getStoredKey();
  const ok = checkSuperadminKey(key, storedKey, ip);
  if (!ok) {
    // Ne pas distinguer "rate limited" de "mauvaise clé" (évite l'énumération)
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
