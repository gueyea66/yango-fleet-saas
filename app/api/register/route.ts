import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getClientIp } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

// Rate limit: 3 registrations per IP per hour
const rateMap = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + 3_600_000 });
    return true;
  }
  if (entry.count >= 3) return false;
  entry.count++;
  return true;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Trop de tentatives. Réessayez dans 1 heure." }, { status: 429 });
  }

  let body: { companyName?: string; email?: string; password?: string; currency?: string; slug?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps JSON invalide" }, { status: 400 });
  }

  const { companyName, email, password, currency = "XOF", slug: customSlug } = body;

  if (!companyName || !email || !password) {
    return NextResponse.json({ error: "companyName, email et password sont requis" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Mot de passe trop court (8 caractères minimum)" }, { status: 400 });
  }

  const slug = customSlug ? slugify(customSlug) : slugify(companyName);
  if (!slug) {
    return NextResponse.json({ error: "Nom d'entreprise invalide pour générer un slug" }, { status: 400 });
  }

  // Check slug uniqueness
  const { data: existing } = await adminClient.from("tenants").select("id").eq("slug", slug).single();
  if (existing) {
    return NextResponse.json({ error: `Le slug "${slug}" est déjà pris. Choisissez un autre nom.` }, { status: 409 });
  }

  // 1. Create tenant
  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ slug, name: companyName, plan: "trial", active: true, trial_ends_at: new Date(Date.now() + 14 * 86_400_000).toISOString() })
    .select()
    .single();

  if (tenantError || !tenant) {
    return NextResponse.json({ error: "Erreur création tenant: " + tenantError?.message }, { status: 500 });
  }

  // 2. Create admin user in Supabase Auth
  const { data: authUser, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: companyName, role: "admin" },
  });

  if (authError || !authUser.user) {
    await adminClient.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json({ error: "Erreur création compte: " + authError?.message }, { status: 400 });
  }

  // 3. Create admin profile
  const { error: profileError } = await adminClient.from("profiles").insert({
    id: authUser.user.id,
    tenant_id: tenant.id,
    email,
    full_name: companyName,
    role: "admin",
  });

  if (profileError) {
    await adminClient.auth.admin.deleteUser(authUser.user.id);
    await adminClient.from("tenants").delete().eq("id", tenant.id);
    return NextResponse.json({ error: "Erreur profil: " + profileError.message }, { status: 500 });
  }

  // 4. Create default tenant settings
  await adminClient.from("tenant_settings").insert({
    tenant_id: tenant.id,
    app_name: companyName,
    primary_color: "#f5a623",
    currency,
    timezone: "Africa/Dakar",
  });

  const loginUrl = `https://${slug}.fleet.m3asolutions.com/auth/login`;

  return NextResponse.json({
    ok: true,
    slug,
    loginUrl,
    trialEndsAt: tenant.trial_ends_at,
    message: `Compte créé ! Connectez-vous sur ${loginUrl}`,
  }, { status: 201 });
}
