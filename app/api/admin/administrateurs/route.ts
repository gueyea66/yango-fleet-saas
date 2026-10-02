/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * /api/admin/administrateurs — admins du tenant et droit de valider.
 *
 *   GET                         → admins (nom, email, peut_valider) + droits de l'appelant
 *   PATCH { id, peut_valider }  → réservé à un admin valideur ; il reste toujours
 *                                 au moins un valideur dans le tenant.
 */
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

const MIGRATION_MSG = "Fonction indisponible : la migration 075 (saisie opérateur) n'est pas encore appliquée.";
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function admins(tenantId: string) {
  return admin.from("profiles").select("id, full_name, email, peut_valider").eq("tenant_id", tenantId).eq("role", "admin").order("full_name");
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

export async function PATCH(req: NextRequest) {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const b = await req.json().catch(() => ({}));
    if (typeof b.id !== "string" || typeof b.peut_valider !== "boolean") return bad("Requête invalide");
    const { data: list, error } = await admins(tenantId);
    if (error) return error.code === "42703" ? bad(MIGRATION_MSG, 409) : bad("Lecture impossible", 500);
    const me = (list || []).find((a: any) => a.id === userId);
    if (!me?.peut_valider) return bad("Réservé à un administrateur valideur", 403);
    const cible = (list || []).find((a: any) => a.id === b.id);
    if (!cible) return bad("Administrateur introuvable", 404);
    const valideursRestants = (list || []).filter((a: any) => a.peut_valider && a.id !== b.id).length;
    if (!b.peut_valider && valideursRestants === 0) return bad("Il doit rester au moins un administrateur valideur.", 409);
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
