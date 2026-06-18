import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

async function getStoredKey(): Promise<string> {
  const { data } = await adminClient.from("superadmin_settings").select("value").eq("key", "access_key").single();
  return data?.value ?? process.env.NEXT_PUBLIC_SUPERADMIN_KEY ?? "m3a-super-2026";
}

export async function POST(req: NextRequest) {
  const { superadminKey, tenantId, email, password } = await req.json();
  const storedKey = await getStoredKey();
  if (superadminKey !== storedKey) {
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

  const { error: profileError } = await adminClient.from("profiles").insert({
    id: user.user.id,
    tenant_id: tenantId,
    email,
    full_name: email.split("@")[0],
    role: "admin",
  });

  if (profileError) {
    await (adminClient.auth.admin as any).deleteUser(user.user.id);
    return NextResponse.json({ error: "Profil non créé : " + profileError.message }, { status: 400 });
  }

  return NextResponse.json({ id: user.user.id, email });
}

export async function DELETE(req: NextRequest) {
  const { superadminKey, userId } = await req.json();
  const storedKey = await getStoredKey();
  if (superadminKey !== storedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { error } = await (adminClient.auth.admin as any).deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await adminClient.from("profiles").delete().eq("id", userId);
  return NextResponse.json({ ok: true });
}
