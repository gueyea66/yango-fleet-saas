/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * /api/admin/saisies — saisie opérateur (hors Yango, charges) et validation.
 *
 *   GET    ?statut=submitted|all [&dateFrom&dateTo]  → saisies + charges opérateur, droits de l'appelant
 *   POST   { type: "hors_yango", driver_id, jour, montant, courses?, note? }
 *          { type: "charge", driver_id, date, categorie, montant, description?, confirmer_doublon? }  → { id } (preuves ensuite)
 *          { type: "decaissement", driver_id (compte technique), date, montant, description, advance_driver_id? }  → valideurs seulement
 *   PUT    { type, id, …mêmes champs }  → l'auteur corrige sa saisie encore en attente
 *   DELETE ?type=hors_yango|charge&id=  → l'auteur annule sa saisie encore en attente (preuves comprises)
 *   PATCH  { type: "hors_yango" | "charge", id, decision: "approved" | "rejected", motif? }
 *
 * Un décaissement est une ligne « charge » de catégorie CAT_AVANCE : il suit
 * la même validation (autre admin, preuve obligatoire). Seul le contrôle
 * routier se valide sans preuve (preuveExigee).
 *
 * Tenant et auteur : toujours ceux de la session (requireAdminAuth). Client
 * service-role → filtre tenant_id explicite partout. Règles de décision dans
 * lib/operateur.ts, doublées en base (migration 075).
 */
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { CAT_AVANCE } from "@/lib/expenseCategories";
import { doublonsPossibles, peutDecider, peutModifierSaisie, peutSaisirDecaissement, validerCharge, validerDecaissement, validerHorsYango, ISO_JOUR } from "@/lib/operateur";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

// preuves : même bucket que /api/kyc-upload (client sans schéma pour le storage)
const BUCKET = "kyc-documents";
const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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

/** Compte technique (ex. « Founder ») du tenant : seul porteur d'un décaissement. */
async function compteTechniqueDuTenant(id: string, tenantId: string) {
  const { data } = await admin.from("profiles").select("id, account_type, active").eq("id", id).eq("tenant_id", tenantId).eq("role", "driver").maybeSingle();
  return !!data && data.account_type === "technical" && data.active !== false;
}

/** Charges non rejetées du tenant sur ces chauffeurs et ces dates (recherche de doublons, flux chauffeur compris). */
async function chargesVoisines(tenantId: string, driverIds: string[], dates: string[]) {
  if (!driverIds.length || !dates.length) return [] as any[];
  const out: any[] = [];
  for (let i = 0; i < driverIds.length; i += 100) {
    const { data } = await admin.from("expenses").select("id, driver_id, expense_date, category, amount, status, source")
      .eq("tenant_id", tenantId).in("driver_id", driverIds.slice(i, i + 100)).in("expense_date", dates);
    out.push(...(data || []));
  }
  return out;
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
        // « * » : rejection_reason n'existe qu'après la migration 080
        let q = admin.from("expenses").select("*").eq("tenant_id", tenantId).eq("source", "operateur");
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
    // doublons possibles des charges en attente (même chauffeur, date, catégorie, montant)
    const attente = (charges as any[]).filter((c) => c.status === "submitted" && c.category !== CAT_AVANCE);
    const voisines = await chargesVoisines(tenantId, [...new Set(attente.map((c) => c.driver_id))], [...new Set(attente.map((c) => c.expense_date).filter(Boolean))]);
    const doublons = (c: any) => (c.status === "submitted" && c.category !== CAT_AVANCE ? doublonsPossibles(c, voisines) : [])
      .map((d: any) => ({ origine: d.source === "operateur" ? "exploitation" : "chauffeur", status: d.status || "approved" }));
    const noms = Object.fromEntries((profiles || []).map((p: any) => [p.id, p.full_name || p.driver_id || "—"]));
    return NextResponse.json({
      me: { id: me.profil!.id, peut_valider: me.profil!.peut_valider },
      horsYango: (horsYango as any[]).map((s) => ({ ...s, chauffeur: noms[s.driver_id] ?? "—", saisi_par: s.entered_by ? noms[s.entered_by] ?? "—" : null, valide_par: s.approved_by ? noms[s.approved_by] ?? "—" : null })),
      charges: (charges as any[]).map((c) => ({ ...c, rejection_reason: c.rejection_reason ?? null, decaissement: c.category === CAT_AVANCE,
        beneficiaire: c.advance_driver_id ? noms[c.advance_driver_id] ?? "—" : null, doublons: doublons(c), chauffeur: noms[c.driver_id] ?? "—", saisi_par: c.entered_by ? noms[c.entered_by] ?? "—" : null, valide_par: c.approved_by ? noms[c.approved_by] ?? "—" : null, pieces: fichiers[c.id]?.length ?? 0, fichiers: fichiers[c.id] ?? [] })),
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
      // le chauffeur (app) ou un autre opérateur a peut-être déjà déclaré cette dépense
      if (b.confirmer_doublon !== true) {
        const c = { driver_id: v.value.driver_id, expense_date: v.value.date, category: v.value.categorie, amount: v.value.montant };
        const d = doublonsPossibles(c, await chargesVoisines(tenantId, [c.driver_id], [c.expense_date]));
        if (d.length) return NextResponse.json({ doublon: true, error: `Une charge identique existe déjà pour ce chauffeur ce jour-là (${d.some((x: any) => x.source !== "operateur") ? "déclarée par le chauffeur" : "saisie par l'exploitation"}).` }, { status: 409 });
      }
      const { data, error } = await admin.from("expenses").insert({
        tenant_id: tenantId, driver_id: v.value.driver_id, expense_date: v.value.date, category: v.value.categorie,
        amount: v.value.montant, description: v.value.description, status: "submitted", source: "operateur", entered_by: userId,
      }).select("id").single();
      if (error) return migrationManquante(error) ? bad(MIGRATION_MSG, 409) : bad("Enregistrement impossible", 500);
      return NextResponse.json({ id: data.id });
    }
    if (b.type === "decaissement") {
      const me = await moi(userId, tenantId);
      if (me.error) return migrationManquante(me.error) ? bad(MIGRATION_MSG, 409) : bad("Profil introuvable", 403);
      const droit = peutSaisirDecaissement(me.profil!);
      if (!droit.ok) return bad(droit.error, 403);
      const v = validerDecaissement(b, today());
      if (!v.ok) return bad(v.error);
      if (!(await compteTechniqueDuTenant(v.value.driver_id, tenantId))) return bad("Compte de décaissement inconnu", 404);
      if (v.value.advance_driver_id && !(await chauffeurDuTenant(v.value.advance_driver_id, tenantId))) return bad("Chauffeur bénéficiaire inconnu", 404);
      const { data, error } = await admin.from("expenses").insert({
        tenant_id: tenantId, driver_id: v.value.driver_id, expense_date: v.value.date, category: CAT_AVANCE,
        amount: v.value.montant, description: v.value.description, advance_driver_id: v.value.advance_driver_id,
        status: "submitted", source: "operateur", entered_by: userId,
      }).select("id").single();
      if (error) return migrationManquante(error) ? bad(MIGRATION_MSG, 409) : bad("Enregistrement impossible", 500);
      return NextResponse.json({ id: data.id });
    }
    return bad("Type de saisie inconnu");
  } catch (err: any) {
    return NextResponse.json({ error: err?.status ? err.message : "Erreur" }, { status: err?.status ?? 500 });
  }
}

/** Saisie de l'appelant encore en attente, ou la réponse d'erreur à renvoyer. */
async function saisieModifiable(type: unknown, id: unknown, userId: string, tenantId: string) {
  if (typeof id !== "string" || (type !== "hors_yango" && type !== "charge")) return { res: bad("Requête invalide") };
  const table = type === "hors_yango" ? "saisies_hors_yango" : "expenses";
  const cols = table === "expenses" ? "id, status, entered_by, source, category" : "id, status, entered_by";
  const { data: s, error } = await admin.from(table).select(cols).eq("id", id).eq("tenant_id", tenantId).maybeSingle();
  if (error) return { res: migrationManquante(error) ? bad(MIGRATION_MSG, 409) : bad("Lecture impossible", 500) };
  if (!s || (table === "expenses" && (s as any).source !== "operateur")) return { res: bad("Saisie introuvable", 404) };
  const ok = peutModifierSaisie({ userId, saisie: s as any });
  if (!ok.ok) return { res: bad(ok.error, 403) };
  return { table, saisie: s as any };
}

export async function PUT(req: NextRequest) {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const b = await req.json().catch(() => ({}));
    const cible = await saisieModifiable(b.type, b.id, userId, tenantId);
    if (cible.res) return cible.res;

    let patch: Record<string, unknown>;
    if (cible.table === "saisies_hors_yango") {
      const v = validerHorsYango(b, today());
      if (!v.ok) return bad(v.error);
      if (!(await chauffeurDuTenant(v.value.driver_id, tenantId))) return bad("Chauffeur inconnu", 404);
      patch = { driver_id: v.value.driver_id, jour: v.value.jour, montant: v.value.montant, courses: v.value.courses ?? 0, note: v.value.note, updated_at: new Date().toISOString() };
    } else if (cible.saisie.category === CAT_AVANCE) {
      const v = validerDecaissement(b, today());
      if (!v.ok) return bad(v.error);
      if (!(await compteTechniqueDuTenant(v.value.driver_id, tenantId))) return bad("Compte de décaissement inconnu", 404);
      if (v.value.advance_driver_id && !(await chauffeurDuTenant(v.value.advance_driver_id, tenantId))) return bad("Chauffeur bénéficiaire inconnu", 404);
      patch = { driver_id: v.value.driver_id, expense_date: v.value.date, amount: v.value.montant, description: v.value.description, advance_driver_id: v.value.advance_driver_id };
    } else {
      const v = validerCharge(b, today());
      if (!v.ok) return bad(v.error);
      if (!(await chauffeurDuTenant(v.value.driver_id, tenantId))) return bad("Chauffeur inconnu", 404);
      patch = { driver_id: v.value.driver_id, expense_date: v.value.date, category: v.value.categorie, amount: v.value.montant, description: v.value.description };
    }
    // garde de concurrence : validée entre-temps → plus modifiable
    const { data: upd, error } = await admin.from(cible.table!).update(patch).eq("id", b.id).eq("tenant_id", tenantId).eq("status", "submitted").eq("entered_by", userId).select("id");
    if (error) return bad("Correction non enregistrée", 500);
    if (!upd?.length) return bad("Saisie déjà traitée", 409);
    // les preuves suivent le chauffeur de la charge
    if (cible.table === "expenses") await admin.from("uploads").update({ driver_id: patch.driver_id }).eq("tenant_id", tenantId).eq("ref_id", b.id).then(() => undefined, () => undefined);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.status ? err.message : "Erreur" }, { status: err?.status ?? 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { tenantId, userId } = await requireAdminAuth();
    const sp = new URL(req.url).searchParams;
    const id = sp.get("id");
    const cible = await saisieModifiable(sp.get("type"), id, userId, tenantId);
    if (cible.res) return cible.res;

    const { data: del, error } = await admin.from(cible.table!).delete().eq("id", id!).eq("tenant_id", tenantId).eq("status", "submitted").eq("entered_by", userId).select("id");
    if (error) return bad("Annulation impossible", 500);
    if (!del?.length) return bad("Saisie déjà traitée", 409);

    if (cible.table === "expenses") {
      // preuves : lignes d'abord, fichier ensuite s'il n'est plus référencé (cf. /api/kyc-delete)
      const { data: ups } = await admin.from("uploads").select("id, file_path").eq("tenant_id", tenantId).eq("ref_id", id!);
      if (ups?.length) {
        await admin.from("uploads").delete().eq("tenant_id", tenantId).eq("ref_id", id!);
        for (const u of ups) {
          const [a, k] = await Promise.all([
            admin.from("uploads").select("id", { count: "exact", head: true }).eq("file_path", u.file_path),
            admin.from("kyc_documents").select("id", { count: "exact", head: true }).eq("file_path", u.file_path),
          ]);
          if (!a.error && !k.error && (a.count ?? 0) === 0 && (k.count ?? 0) === 0) await storage.storage.from(BUCKET).remove([u.file_path]).then(() => undefined, () => undefined);
        }
      }
    }
    await admin.from("action_logs").insert({
      tenant_id: tenantId, actor_id: userId, actor_role: "admin",
      entity_type: cible.table === "expenses" ? "expense" : "saisie_hors_yango", entity_id: id, action: "deleted",
      metadata: { source: "operateur", motif: "annulée par son auteur avant validation" },
    }).then(() => undefined, () => undefined);
    return NextResponse.json({ ok: true });
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
    const cols = table === "expenses" ? "id, status, entered_by, source, category" : "id, status, entered_by";
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
    patch.rejection_reason = decision === "rejected" ? motif : null;
    if (table === "saisies_hors_yango") patch.updated_at = new Date().toISOString();
    // garde de concurrence : seule une saisie encore en attente change d'état
    const decider = (p: Record<string, unknown>) => admin.from(table).update(p).eq("id", b.id).eq("tenant_id", tenantId).eq("status", "submitted").select("id");
    let { data: upd, error: uErr } = await decider(patch);
    // expenses.rejection_reason arrive avec la migration 080 : sans elle, le motif reste au journal d'actions
    if (uErr && table === "expenses" && (uErr.code === "42703" || uErr.code === "PGRST204")) {
      delete patch.rejection_reason;
      ({ data: upd, error: uErr } = await decider(patch));
    }
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
