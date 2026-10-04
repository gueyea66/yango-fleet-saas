/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * /api/admin/saisies — saisie opérateur (hors Yango, charges) et validation.
 *
 *   GET    ?statut=submitted|all [&dateFrom&dateTo]  → saisies + charges opérateur, droits de l'appelant
 *   POST   { type: "hors_yango", driver_id, jour, montant, courses?, note? }
 *          { type: "charge", driver_id, date, categorie, montant, description? }  → { id } (preuves ensuite)
 *   PATCH  { type: "hors_yango" | "charge", id, decision: "approved" | "rejected", motif? }
 *
 * Tenant et auteur : toujours ceux de la session (requireAdminAuth). Client
 * service-role → filtre tenant_id explicite partout. Règles de décision dans
 * lib/operateur.ts, doublées en base (migration 075).
 */
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { peutDecider, validerCharge, validerHorsYango, ISO_JOUR } from "@/lib/operateur";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

const MIGRATION_MSG = "Fonction indisponible : la migration 075 (saisie opérateur) n'est pas encore appliquée.";
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const today = () => new Date().toISOString().slice(0, 10);
const migrationManquante = (e: any) => e && (e.code === "42P01" || e.code === "42703" || /saisies_hors_yango|peut_valider|entered_by/.test(e.message || ""));

async function moi(userId: string, tenantId: string) {
  const { data, error } = await admin.from("profiles").select("id, full_name, peut_valider").eq("id", userId).eq("tenant_id", tenantId).single();
  if (error) return { error };
  return { profil: data as { id: string; full_name: string | null; peut_valider: boolean } };
}

/** Le chauffeur appartient-il au tenant ? (jamais d'écriture pour un autre tenant) */
async function chauffeurDuTenant(driverId: string, tenantId: string) {
  const { data } = await admin.from("profiles").select("id, account_type, active").eq("id", driverId).eq("tenant_id", tenantId).eq("role", "driver").maybeSingle();
  // ni compte technique (Founder…), ni chauffeur désactivé
  return !!data && data.account_type !== "technical" && data.active !== false;
}

export async function GET(req: NextRequest) {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const sp = new URL(req.url).searchParams;
    const statut = sp.get("statut") === "all" ? "all" : "submitted";
    const from = ISO_JOUR.test(sp.get("dateFrom") || "") ? sp.get("dateFrom")! : null;
    const to = ISO_JOUR.test(sp.get("dateTo") || "") ? sp.get("dateTo")! : null;

    const me = await moi(userId, tenantId);
    if (me.error) return migrationManquante(me.error) ? bad(MIGRATION_MSG, 409) : bad("Profil introuvable", 403);

    const [horsYango, charges, { data: profiles }] = await Promise.all([
      fetchAllRows(() => {
        let q = admin.from("saisies_hors_yango").select("*").eq("tenant_id", tenantId);
        if (statut !== "all") q = q.eq("status", "submitted");
        if (from) q = q.gte("jour", from);
        if (to) q = q.lte("jour", to);
        return q.order("jour", { ascending: false }).order("id");
      }),
      fetchAllRows(() => {
        let q = admin.from("expenses").select("id, driver_id, expense_date, category, amount, description, status, entered_by, approved_by, approved_at, created_at")
          .eq("tenant_id", tenantId).eq("source", "operateur");
        if (statut !== "all") q = q.eq("status", "submitted");
        if (from) q = q.gte("expense_date", from);
        if (to) q = q.lte("expense_date", to);
        return q.order("expense_date", { ascending: false }).order("id");
      }),
      admin.from("profiles").select("id, full_name, driver_id, role").eq("tenant_id", tenantId),
    ]);

    // preuves rattachées aux charges (uploads.ref_id), par lots
    const fichiers: Record<string, { file_path: string; file_name: string | null }[]> = {};
    const ids = (charges as any[]).map((c) => c.id);
    for (let i = 0; i < ids.length; i += 150) {
      const { data } = await admin.from("uploads").select("ref_id, file_path, file_name").eq("tenant_id", tenantId).in("ref_id", ids.slice(i, i + 150));
      for (const u of data || []) (fichiers[u.ref_id] ||= []).push({ file_path: u.file_path, file_name: u.file_name });
    }
    const noms = Object.fromEntries((profiles || []).map((p: any) => [p.id, p.full_name || p.driver_id || "—"]));
    return NextResponse.json({
      me: { id: me.profil!.id, peut_valider: me.profil!.peut_valider },
      horsYango: (horsYango as any[]).map((s) => ({ ...s, chauffeur: noms[s.driver_id] ?? "—", saisi_par: s.entered_by ? noms[s.entered_by] ?? "—" : null, valide_par: s.approved_by ? noms[s.approved_by] ?? "—" : null })),
      charges: (charges as any[]).map((c) => ({ ...c, chauffeur: noms[c.driver_id] ?? "—", saisi_par: c.entered_by ? noms[c.entered_by] ?? "—" : null, valide_par: c.approved_by ? noms[c.approved_by] ?? "—" : null, pieces: fichiers[c.id]?.length ?? 0, fichiers: fichiers[c.id] ?? [] })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    if (migrationManquante(err)) return bad(MIGRATION_MSG, 409);
    return NextResponse.json({ error: err?.status ? err.message : "Erreur" }, { status: err?.status ?? 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const b = await req.json().catch(() => ({}));
    if (b.type === "hors_yango") {
      const v = validerHorsYango(b, today());
      if (!v.ok) return bad(v.error);
      if (!(await chauffeurDuTenant(v.value.driver_id, tenantId))) return bad("Chauffeur inconnu", 404);
      const { data, error } = await admin.from("saisies_hors_yango").insert({
        tenant_id: tenantId, driver_id: v.value.driver_id, jour: v.value.jour, montant: v.value.montant,
        courses: v.value.courses ?? 0, note: v.value.note, status: "submitted", entered_by: userId,
      }).select("id").single();
      if (error) return migrationManquante(error) ? bad(MIGRATION_MSG, 409) : bad("Enregistrement impossible", 500);
      return NextResponse.json({ id: data.id });
    }
    if (b.type === "charge") {
      const v = validerCharge(b, today());
      if (!v.ok) return bad(v.error);
      if (!(await chauffeurDuTenant(v.value.driver_id, tenantId))) return bad("Chauffeur inconnu", 404);
      const { data, error } = await admin.from("expenses").insert({
        tenant_id: tenantId, driver_id: v.value.driver_id, expense_date: v.value.date, category: v.value.categorie,
        amount: v.value.montant, description: v.value.description, status: "submitted", source: "operateur", entered_by: userId,
      }).select("id").single();
      if (error) return migrationManquante(error) ? bad(MIGRATION_MSG, 409) : bad("Enregistrement impossible", 500);
      return NextResponse.json({ id: data.id });
    }
    return bad("Type de saisie inconnu");
  } catch (err: any) {
    return NextResponse.json({ error: err?.status ? err.message : "Erreur" }, { status: err?.status ?? 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const b = await req.json().catch(() => ({}));
    const decision = b.decision === "approved" ? "approved" : b.decision === "rejected" ? "rejected" : null;
    if (!decision || typeof b.id !== "string" || !["hors_yango", "charge"].includes(b.type)) return bad("Requête invalide");
    const me = await moi(userId, tenantId);
    if (me.error) return migrationManquante(me.error) ? bad(MIGRATION_MSG, 409) : bad("Profil introuvable", 403);

    const table = b.type === "hors_yango" ? "saisies_hors_yango" : "expenses";
    // « source » n'existe que sur expenses : la demander sur saisies_hors_yango faisait échouer la lecture
    const cols = table === "expenses" ? "id, status, entered_by, source" : "id, status, entered_by";
    const { data: s, error } = await admin.from(table).select(cols).eq("id", b.id).eq("tenant_id", tenantId).maybeSingle();
    if (error) return migrationManquante(error) ? bad(MIGRATION_MSG, 409) : bad("Lecture impossible", 500);
    if (!s || (table === "expenses" && (s as any).source !== "operateur")) return bad("Saisie introuvable", 404);

    let pieces: number | undefined;
    if (b.type === "charge") {
      const { count } = await admin.from("uploads").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("ref_id", b.id);
      pieces = count ?? 0;
    }
    const ok = peutDecider({ decideur: me.profil!, saisie: s as any, decision, piecesJointes: pieces });
    if (!ok.ok) return bad(ok.error, 403);

    const motif = typeof b.motif === "string" ? b.motif.trim().slice(0, 300) || null : null;
    const patch: Record<string, unknown> = { status: decision, approved_by: userId, approved_at: new Date().toISOString() };
    if (table === "saisies_hors_yango") { patch.rejection_reason = decision === "rejected" ? motif : null; patch.updated_at = new Date().toISOString(); }
    // garde de concurrence : seule une saisie encore en attente change d'état
    const { data: upd, error: uErr } = await admin.from(table).update(patch).eq("id", b.id).eq("tenant_id", tenantId).eq("status", "submitted").select("id");
    if (uErr) return bad("Décision non enregistrée", 500);
    if (!upd?.length) return bad("Saisie déjà traitée", 409);

    await admin.from("action_logs").insert({
      tenant_id: tenantId, actor_id: userId, actor_role: "admin",
      entity_type: b.type === "charge" ? "expense" : "saisie_hors_yango", entity_id: b.id, action: decision,
      metadata: { source: "operateur", ...(motif ? { motif } : {}) },
    }).then(() => undefined, () => undefined);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.status ? err.message : "Erreur" }, { status: err?.status ?? 500 });
  }
}
