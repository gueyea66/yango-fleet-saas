import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPERADMIN_KEY = process.env.NEXT_PUBLIC_SUPERADMIN_KEY || "m3a-super-2026";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export async function POST(req: NextRequest) {
  const { superadminKey, tenantId, plan, active, plan_expires_at } = await req.json();
  if (superadminKey !== SUPERADMIN_KEY) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!tenantId) return NextResponse.json({ error: "tenantId requis" }, { status: 400 });

  const update: Record<string, unknown> = {};
  if (plan !== undefined) update.plan = plan;
  if (active !== undefined) update.active = active;
  if (plan_expires_at !== undefined) update.plan_expires_at = plan_expires_at;

  const { error } = await adminClient.from("tenants").update(update).eq("id", tenantId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
