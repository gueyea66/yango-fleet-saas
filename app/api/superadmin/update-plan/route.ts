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

export async function POST(req: NextRequest) {
  const { superadminKey, tenantId, plan, active, plan_expires_at } = await req.json();

  const storedKey = await getStoredKey();
  if (!checkSuperadminKey(superadminKey, storedKey, getClientIp(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!tenantId) return NextResponse.json({ error: "tenantId requis" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (plan !== undefined) update.plan = plan;
  if (active !== undefined) update.active = active;
  if (plan_expires_at !== undefined) update.plan_expires_at = plan_expires_at;

  const { error } = await adminClient.from("tenants").update(update).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
