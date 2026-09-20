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

async function authorize(req: NextRequest, key: string): Promise<boolean> {
  const storedKey = await getStoredKey();
  return checkSuperadminKey(key, storedKey, getClientIp(req));
}

export async function POST(req: NextRequest) {
  const { superadminKey, tenantId, email, password } = await req.json();
  if (!(await authorize(req, superadminKey))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!tenantId || !email || !password) {
    return NextResponse.json({ error: "Champs manquants" }, { status: 400 });
  }

  const { data: user, error: authError } = await adminClient.auth.admin.createUser({
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
    await adminClient.auth.admin.deleteUser(user.user.id);
    return NextResponse.json({ error: "Profil non créé : " + profileError.message }, { status: 400 });
  }

  return NextResponse.json({ id: user.user.id, email });
}

export async function PATCH(req: NextRequest) {
  const { superadminKey, userId, email, password } = await req.json();
  if (!(await authorize(req, superadminKey))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!userId) return NextResponse.json({ error: "userId requis" }, { status: 400 });
  if (password && String(password).length < 8) {
    return NextResponse.json({ error: "Mot de passe trop court (8 caractères minimum)" }, { status: 400 });
  }

  // L'email courant fait foi : le formulaire renvoie toujours le champ, même
  // inchangé. Le renvoyer tel quel à GoTrue n'est pas anodin — une adresse
  // « modifiée » sans email_confirm part en attente de confirmation, l'ancienne
  // reste la seule qui ouvre la session, et la console affiche la nouvelle.
  // L'admin se retrouve alors à taper une adresse qui n'existe pas encore.
  const { data: current, error: readError } = await adminClient.auth.admin.getUserById(userId);
  if (readError || !current?.user) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  const currentEmail = current.user.email ?? "";
  const nextEmail = email ? String(email).trim() : "";
  const emailChanged = !!nextEmail && nextEmail.toLowerCase() !== currentEmail.toLowerCase();

  const updates: Record<string, string | boolean> = {};
  // email_confirm : l'adresse est utilisable immédiatement, sans aller-retour
  // par un email que personne n'attend (et que le SMTP par défaut de Supabase
  // n'enverrait qu'au compte-gouttes).
  if (emailChanged) { updates.email = nextEmail; updates.email_confirm = true; }
  if (password) updates.password = String(password);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ ok: true, email: currentEmail, unchanged: true });
  }

  const { data: updated, error: authError } = await adminClient.auth.admin.updateUserById(userId, updates);
  if (authError) return NextResponse.json({ error: authError.message }, { status: 400 });

  // La ligne `profiles` ne suit QUE si l'email d'authentification a réellement
  // changé — sinon la console annoncerait un identifiant de connexion faux.
  const effectiveEmail = updated?.user?.email ?? currentEmail;
  if (emailChanged && effectiveEmail.toLowerCase() === nextEmail.toLowerCase()) {
    await adminClient.from("profiles").update({ email: effectiveEmail }).eq("id", userId);
  }

  return NextResponse.json({ ok: true, email: effectiveEmail });
}

export async function DELETE(req: NextRequest) {
  const { superadminKey, userId } = await req.json();
  if (!(await authorize(req, superadminKey))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await adminClient.from("profiles").delete().eq("id", userId);
  return NextResponse.json({ ok: true });
}
