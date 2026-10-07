/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * /api/admin/administrateurs — admins du tenant et droit de valider.
 *
 *   GET                         → admins (nom, email, peut_valider) + droits de l'appelant
 *   POST  { full_name, email, password, profil }  → un valideur crée un compte
 *                                 gestionnaire : « valideur » ou « operateur » (saisie seule)
 *   PUT   { id, full_name, email, profil }        → un valideur modifie un compte
 *                                 (son propre profil reste modifié par un autre valideur)
 *   PATCH { id, peut_valider }  → réservé à un admin valideur, jamais sur son propre
 *                                 compte ; il reste toujours au moins un valideur
 *                                 actif dans le tenant (lib/operateur peutChangerDroit).
 */
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { peutChangerDroit, validerCompteAdmin } from "@/lib/operateur";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

const MIGRATION_MSG = "Fonction indisponible : la migration 075 (saisie opérateur) n'est pas encore appliquée.";
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function admins(tenantId: string) {
  return admin.from("profiles").select("id, full_name, email, peut_valider, active").eq("tenant_id", tenantId).eq("role", "admin").order("full_name");
}

export async function GET() {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const { data, error } = await admins(tenantId);
    if (error) return error.code === "42703" ? bad(MIGRATION_MSG, 409) : bad("Lecture impossible", 500);
    const me = (data || []).find((a: any) => a.id === userId);
    return NextResponse.json({ me: { id: userId, peut_valider: !!me?.peut_valider }, admins: data || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    return NextResponse.json({ error: err?.status ? err.message : "Erreur" }, { status: err?.status ?? 500 });
  }
}

/** Appelant valideur + liste des admins du tenant, ou la réponse d'erreur. */
async function valideur(tenantId: string, userId: string) {
  const { data: list, error } = await admins(tenantId);
  if (error) return { res: error.code === "42703" ? bad(MIGRATION_MSG, 409) : bad("Lecture impossible", 500) };
  const me = (list || []).find((a: any) => a.id === userId);
  if (!me?.peut_valider) return { res: bad("Réservé à un administrateur valideur.", 403) };
  return { list: (list || []) as any[] };
}

const journal = (tenantId: string, userId: string, entityId: string, action: string, metadata: Record<string, unknown> = {}) =>
  admin.from("action_logs").insert({ tenant_id: tenantId, actor_id: userId, actor_role: "admin", entity_type: "profile", entity_id: entityId, action, metadata })
    .then(() => undefined, () => undefined);

export async function POST(req: NextRequest) {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const v = validerCompteAdmin(await req.json().catch(() => ({})), "creation");
    if (!v.ok) return bad(v.error);
    const ctx = await valideur(tenantId, userId);
    if (ctx.res) return ctx.res;

    // L'adresse ne doit appartenir à aucun compte, de ce tenant ou d'un autre :
    // on ne reprend jamais un compte existant (ce serait une prise de contrôle).
    const { data: deja } = await admin.from("profiles").select("id").eq("email", v.value.email).limit(1);
    if (deja?.length) return bad("Cette adresse e-mail est déjà utilisée.", 409);
    const { data: created, error: authError } = await admin.auth.admin.createUser({
      email: v.value.email, password: v.value.password!, email_confirm: true,
      user_metadata: { full_name: v.value.full_name, role: "admin" },
    });
    if (authError || !created?.user) {
      const pris = /already|exists|registered/i.test(authError?.message || "");
      return bad(pris ? "Cette adresse e-mail est déjà utilisée." : "Création du compte impossible", pris ? 409 : 500);
    }
    const { error: pErr } = await admin.from("profiles").insert({
      id: created.user.id, tenant_id: tenantId, email: v.value.email, full_name: v.value.full_name,
      role: "admin", peut_valider: v.value.profil === "valideur",
    });
    if (pErr) {
      // pas de compte sans profil : il pourrait se connecter sans appartenir à personne
      await admin.auth.admin.deleteUser(created.user.id).then(() => undefined, () => undefined);
      return bad("Création du profil impossible", 500);
    }
    await journal(tenantId, userId, created.user.id, "compte_admin_cree", { profil: v.value.profil });
    return NextResponse.json({ id: created.user.id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.status ? err.message : "Erreur" }, { status: err?.status ?? 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const b = await req.json().catch(() => ({}));
    if (typeof b.id !== "string") return bad("Requête invalide");
    const v = validerCompteAdmin(b, "modification");
    if (!v.ok) return bad(v.error);
    const ctx = await valideur(tenantId, userId);
    if (ctx.res) return ctx.res;
    const cible = ctx.list!.find((a) => a.id === b.id);
    if (!cible) return bad("Administrateur introuvable", 404);

    // changement de profil : mêmes règles que le sélecteur (jamais le sien, toujours un valideur)
    const nouveau = v.value.profil === "valideur";
    if (nouveau !== !!cible.peut_valider) {
      const droit = peutChangerDroit({ acteur: { id: userId, peut_valider: true }, cibleId: b.id, nouveau, admins: ctx.list! });
      if (!droit.ok) return bad(droit.error, 403);
    }
    const emailChange = v.value.email !== String(cible.email || "").toLowerCase();
    if (emailChange) {
      const { data: deja } = await admin.from("profiles").select("id").eq("email", v.value.email).neq("id", b.id).limit(1);
      if (deja?.length) return bad("Cette adresse e-mail est déjà utilisée.", 409);
      const { error: aErr } = await admin.auth.admin.updateUserById(b.id, { email: v.value.email, email_confirm: true });
      if (aErr) return bad(/already|exists|registered/i.test(aErr.message) ? "Cette adresse e-mail est déjà utilisée." : "Changement d'adresse impossible", 409);
    }
    const { error: uErr } = await admin.from("profiles").update({ full_name: v.value.full_name, email: v.value.email, peut_valider: nouveau })
      .eq("id", b.id).eq("tenant_id", tenantId).eq("role", "admin");
    if (uErr) return bad("Modification impossible", 500);
    await journal(tenantId, userId, b.id, "compte_admin_modifie", { ...(emailChange ? { email: true } : {}), ...(nouveau !== !!cible.peut_valider ? { profil: v.value.profil } : {}) });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.status ? err.message : "Erreur" }, { status: err?.status ?? 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const b = await req.json().catch(() => ({}));
    if (typeof b.id !== "string" || typeof b.peut_valider !== "boolean") return bad("Requête invalide");
    const { data: list, error } = await admins(tenantId);
    if (error) return error.code === "42703" ? bad(MIGRATION_MSG, 409) : bad("Lecture impossible", 500);
    const me = (list || []).find((a: any) => a.id === userId);
    const droit = peutChangerDroit({ acteur: { id: userId, peut_valider: !!me?.peut_valider }, cibleId: b.id, nouveau: b.peut_valider, admins: (list || []) as any[] });
    if (!droit.ok) return bad(droit.error, 403);
    const { error: uErr } = await admin.from("profiles").update({ peut_valider: b.peut_valider }).eq("id", b.id).eq("tenant_id", tenantId).eq("role", "admin");
    if (uErr) return bad("Modification impossible", 500);
    await admin.from("action_logs").insert({
      tenant_id: tenantId, actor_id: userId, actor_role: "admin", entity_type: "profile", entity_id: b.id,
      action: b.peut_valider ? "droit_validation_accorde" : "saisie_seule", metadata: {},
    }).then(() => undefined, () => undefined);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.status ? err.message : "Erreur" }, { status: err?.status ?? 500 });
  }
}
