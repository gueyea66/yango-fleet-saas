import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const SUPERADMIN_KEY = process.env.NEXT_PUBLIC_SUPERADMIN_KEY || "m3a-super-2026";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export async function POST(req: NextRequest) {
  const { superadminKey, tenantId, email, password } = await req.json();

  if (superadminKey !== SUPERADMIN_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!tenantId || !email || !password) {
    return NextResponse.json({ error: "Champs manquants" }, { status: 400 });
  }

  const { data: user, error: authError } = await (adminClient.auth.admin as any).createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 });

  await adminClient.from("profiles").insert({
    id: user.user.id,
    tenant_id: tenantId,
    email,
    full_name: email.split("@")[0],
    role: "admin",
  });

  return NextResponse.json({ id: user.user.id, email });
}

export async function DELETE(req: NextRequest) {
  const { superadminKey, userId } = await req.json();
  if (superadminKey !== SUPERADMIN_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { error } = await (adminClient.auth.admin as any).deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await adminClient.from("profiles").delete().eq("id", userId);
  return NextResponse.json({ ok: true });
}
