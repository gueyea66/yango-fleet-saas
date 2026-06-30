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
  return data?.value ?? process.env.SUPERADMIN_KEY ?? "";
}

export async function GET() {
  const key = await getStoredKey();
  return NextResponse.json({ hasCustomKey: !!key });
}

export async function POST(req: NextRequest) {
  const { currentKey, newKey } = await req.json();
  if (!currentKey || !newKey) return NextResponse.json({ error: "Champs manquants" }, { status: 400 });
  if (newKey.length < 16) return NextResponse.json({ error: "Clé trop courte (16 caractères min)" }, { status: 400 });

  const storedKey = await getStoredKey();
  if (!checkSuperadminKey(currentKey, storedKey, getClientIp(req))) {
    return NextResponse.json({ error: "Clé actuelle incorrecte" }, { status: 401 });
  }

  const { error } = await adminClient.from("superadmin_settings")
    .upsert({ key: "access_key", value: newKey, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
