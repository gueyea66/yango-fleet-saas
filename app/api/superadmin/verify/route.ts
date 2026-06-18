import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export async function POST(req: NextRequest) {
  const { key } = await req.json();
  const { data } = await adminClient.from("superadmin_settings").select("value").eq("key", "access_key").single();
  const storedKey = data?.value ?? process.env.NEXT_PUBLIC_SUPERADMIN_KEY ?? "m3a-super-2026";
  return NextResponse.json({ ok: key === storedKey });
}
