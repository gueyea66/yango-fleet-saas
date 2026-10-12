/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * /api/admin/repos — jour de repos saisi par l'exploitation pour un chauffeur.
 *
 *   POST { driver_id, date, motif? }  → { id, status }
 *
 * Même ligne que la déclaration du chauffeur : un daily_reports « [REPOS] » à
 * zéro. Un valideur l'enregistre validé ; un profil « saisie seule » le dépose
 * en attente (file « À valider »), comme toute saisie opérateur.
 *
 * L'écriture passait par le client navigateur, sans tenant_id : la règle
 * d'isolation la refusait et l'erreur n'était pas lue — le repos semblait
 * enregistré puis n'apparaissait nulle part. Tenant et auteur viennent ici de
 * la session ; client service-role → filtre tenant_id explicite partout.
 */
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { validerRepos } from "@/lib/operateur";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: NextRequest) {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const v = validerRepos(await req.json().catch(() => ({})), new Date().toISOString().slice(0, 10));
    if (!v.ok) return bad(v.error);
    const { driver_id, date, motif } = v.value;

    const [{ data: moi }, { data: chauffeur }] = await Promise.all([
      admin.from("profiles").select("*").eq("id", userId).eq("tenant_id", tenantId).maybeSingle(),
      admin.from("profiles").select("id, account_type").eq("id", driver_id).eq("tenant_id", tenantId).eq("role", "driver").maybeSingle(),
    ]);
    if (!moi) return bad("Profil introuvable", 403);
    if (!chauffeur || chauffeur.account_type === "technical") return bad("Chauffeur inconnu", 404);

    // un rapport rejeté ne bloque pas ; un rapport actif (déclaré, importé, repos) oui
    const { data: existe } = await admin.from("daily_reports").select("id")
      .eq("tenant_id", tenantId).eq("driver_id", driver_id).eq("date", date)
      .in("status", ["submitted", "approved"]).limit(1).maybeSingle();
    if (existe) return bad("Un rapport existe déjà pour ce chauffeur à cette date.", 409);

    // peut_valider absent (avant la migration 075) = tout admin valide
    const valide = (moi as any).peut_valider !== false;
    const { data, error } = await admin.from("daily_reports").insert({
      tenant_id: tenantId, driver_id, date,
      status: valide ? "approved" : "submitted",
      ...(valide ? { approved_by: userId, approved_at: new Date().toISOString() } : {}),
      comment: `[REPOS]${motif ? " " + motif : ""}`,
      gross_earnings: 0, yango_gross: 0, yango_bonus: 0, off_yango_revenue: 0,
      net_after_expenses: 0, commission_rate: 0, commission_amount: 0, expense_count: 0,
    }).select("id, status").single();
    if (error) {
      if (error.code === "23505") return bad("Un rapport validé existe déjà pour ce chauffeur à cette date.", 409);
      // refus métier levé par la base (ex. recettes hors Yango validées ce jour-là) : message tel quel
      if (error.code === "P0001") return bad(error.message, 409);
      return bad("Enregistrement impossible", 500);
    }

    await admin.from("action_logs").insert({
      tenant_id: tenantId, actor_id: userId, actor_role: "admin",
      entity_type: "report", entity_id: data.id, action: valide ? "approved" : "created",
      metadata: { source: "operateur", repos: true, date, driver_id, ...(motif ? { motif } : {}) },
    }).then(() => undefined, () => undefined);
    return NextResponse.json({ id: data.id, status: data.status });
  } catch (err: any) {
    return NextResponse.json({ error: err?.status ? err.message : "Erreur" }, { status: err?.status ?? 500 });
  }
}
