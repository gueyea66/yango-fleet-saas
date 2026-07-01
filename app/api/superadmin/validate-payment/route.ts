import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

async function getStoredKey(): Promise<string> {
  const { data } = await adminClient.from("superadmin_settings").select("value").eq("key", "access_key").single();
  return data?.value ?? process.env.SUPERADMIN_KEY ?? "";
}

export async function POST(req: NextRequest) {
  const { superadminKey, tenantId, plan = "standard", months = 1 } = await req.json();

  const storedKey = await getStoredKey();
  if (!checkSuperadminKey(superadminKey, storedKey, getClientIp(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!tenantId) return NextResponse.json({ error: "tenantId requis" }, { status: 400 });

  const expiresAt = new Date(Date.now() + months * 30 * 86_400_000).toISOString();

  const { error } = await adminClient.from("tenants").update({
    plan,
    active: true,
    plan_expires_at: expiresAt,
    trial_ends_at: null,
  }).eq("id", tenantId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await adminClient.from("superadmin_settings").upsert(
    { key: `payment_confirmed_${tenantId}`, value: new Date().toISOString(), updated_at: new Date().toISOString() },
    { onConflict: "key" }
  );

  return NextResponse.json({ ok: true, plan, expiresAt });
}
