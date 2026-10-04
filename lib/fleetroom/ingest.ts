/**
 * Ingestion des exports Fleetroom → tables brutes → déclarations journalières.
 *
 * Garde-fous contre la double déclaration (voir migrations/072) :
 *  1. même fichier (sha256) déjà déposé → refusé ;
 *  2. lignes brutes dédoublonnées par clé naturelle Yango → un chevauchement
 *     de périodes n'ajoute rien ;
 *  3. les déclarations sont RECALCULÉES depuis le brut (fleetroom_rebuild),
 *     jamais additionnées ; une déclaration saisie par le chauffeur n'est pas
 *     écrasée, l'écart part dans fleetroom_conflicts.
 *
 * Utilisé par la route /api/admin/fleetroom et par scripts/fleetroom-import.ts.
 */
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectKind, parseOrders, parseSoldes, parseTransactions, periodOf, splitCsv,
  type FleetroomKind,
} from "./parse";

export interface FleetroomFile {
  name: string;
  text: string;
  /** Obligatoire pour l'export « soldes » (la date n'est pas dans le fichier). */
  soldesJour?: string;
}

export interface FileResult {
  name: string;
  kind: FleetroomKind | null;
  status: "imported" | "already_imported" | "rejected";
  message?: string;
  rows_total?: number;
  rows_new?: number;
  period?: { from: string | null; to: string | null };
}

export interface IngestResult {
  files: FileResult[];
  rebuild: Record<string, unknown> | null;
  linkedDrivers: string[];
  unknownDrivers: string[];
}

const CHUNK = 1000;

async function insertChunks<T extends object>(
  sb: SupabaseClient, table: string, rows: T[], onConflict: string, ignoreDuplicates: boolean,
): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { data, error } = await sb.schema("fleet").from(table)
      .upsert(rows.slice(i, i + CHUNK), { onConflict, ignoreDuplicates })
      .select(onConflict.split(",")[0]);
    if (error) throw new Error(`${table} (lot ${i / CHUNK + 1}) : ${error.message}`);
    written += data?.length ?? 0;
  }
  return written;
}

/** Rattache les identifiants Yango aux profils du tenant par nom exact (insensible à la casse). */
async function linkDrivers(sb: SupabaseClient, tenantId: string, drivers: Map<string, string>) {
  const { data: profiles, error } = await sb.schema("fleet").from("profiles")
    .select("id, full_name, yango_driver_id").eq("tenant_id", tenantId).eq("role", "driver");
  if (error) throw new Error(`profils : ${error.message}`);
  const known = new Set((profiles ?? []).map((p) => p.yango_driver_id).filter(Boolean));
  const linked: string[] = [];
  const unknown: string[] = [];
  for (const [yid, name] of drivers) {
    if (known.has(yid)) continue;
    const p = (profiles ?? []).find(
      (x) => !x.yango_driver_id && x.full_name?.trim().toLowerCase() === name.trim().toLowerCase(),
    );
    if (!p) { unknown.push(name); continue; }
    const { error: e } = await sb.schema("fleet").from("profiles").update({ yango_driver_id: yid }).eq("id", p.id);
    if (e) throw new Error(`rattachement ${name} : ${e.message}`);
    p.yango_driver_id = yid;
    linked.push(name);
  }
  return { linked, unknown };
}

export async function ingestFleetroom(
  sb: SupabaseClient, tenantId: string, files: FleetroomFile[], createdBy?: string,
): Promise<IngestResult> {
  const results: FileResult[] = [];
  const drivers = new Map<string, string>();
  const jours: (string | null)[] = [];

  for (const f of files) {
    const rows = splitCsv(f.text);
    const kind = rows.length ? detectKind(rows[0]) : null;
    if (!kind) {
      results.push({ name: f.name, kind, status: "rejected", message: "Export Fleetroom non reconnu (en-tête inattendu)" });
      continue;
    }
    if (kind === "soldes" && !/^\d{4}-\d{2}-\d{2}$/.test(f.soldesJour ?? "")) {
      results.push({ name: f.name, kind, status: "rejected", message: "Préciser la date du solde (AAAA-MM-JJ)" });
      continue;
    }
    // L'export « soldes » d'un même contenu peut viser deux dates : la date entre dans l'empreinte.
    const sha = createHash("sha256").update(f.text).update(f.soldesJour ?? "").digest("hex");
    const { data: dup } = await sb.schema("fleet").from("fleetroom_imports")
      .select("id, created_at").eq("tenant_id", tenantId).eq("file_sha256", sha).maybeSingle();
    if (dup) {
      results.push({ name: f.name, kind, status: "already_imported", message: `Fichier déjà déposé le ${dup.created_at.slice(0, 10)}` });
      continue;
    }

    let payload: object[] = [];
    let period = { from: null as string | null, to: null as string | null };
    if (kind === "transactions") {
      const tx = parseTransactions(rows);
      tx.forEach((t) => drivers.set(t.yango_driver_id, t.driver_name));
      period = periodOf(tx.map((t) => t.jour));
      payload = tx.map((t) => ({ ...t, order_id: t.order_id ?? "" }));
    } else if (kind === "orders") {
      const od = parseOrders(rows);
      od.forEach((o) => o.yango_driver_id && o.driver_name && !drivers.has(o.yango_driver_id)
        && drivers.set(o.yango_driver_id, o.driver_name));
      period = periodOf(od.map((o) => o.jour));
      payload = od;
    } else {
      const so = parseSoldes(rows, f.soldesJour!);
      period = { from: f.soldesJour!, to: f.soldesJour! };
      payload = so.map((s) => ({ driver_name: s.driver_name, jour: s.jour, solde_debut: s.solde_debut, solde_fin: s.solde_fin }));
    }

    const { data: imp, error: impErr } = await sb.schema("fleet").from("fleetroom_imports").insert({
      tenant_id: tenantId, created_by: createdBy ?? null, kind, file_name: f.name, file_sha256: sha,
      period_from: period.from, period_to: period.to, rows_total: payload.length,
    }).select("id").single();
    if (impErr || !imp) throw new Error(`journal d'import : ${impErr?.message}`);

    const tagged = payload.map((r) => ({ ...r, tenant_id: tenantId, import_id: imp.id }));
    const rowsNew =
      kind === "transactions"
        ? await insertChunks(sb, "yango_transactions", tagged,
            "tenant_id,occurred_at,yango_driver_id,category,amount,order_id", true)
        : kind === "orders"
          // une commande peut changer de statut d'un export à l'autre → mise à jour
          ? await insertChunks(sb, "yango_orders", tagged.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
              "tenant_id,order_id", false)
          : await insertChunks(sb, "yango_balance_snapshots", tagged, "tenant_id,driver_name,jour", false);

    await sb.schema("fleet").from("fleetroom_imports")
      .update({ rows_new: rowsNew, rows_known: payload.length - rowsNew }).eq("id", imp.id);

    jours.push(period.from, period.to);
    results.push({ name: f.name, kind, status: "imported", rows_total: payload.length, rows_new: rowsNew, period });
  }

  const { linked, unknown } = await linkDrivers(sb, tenantId, drivers);

  const p = periodOf(jours);
  // Une nouvelle ancre de solde décale le solde de TOUS les jours du chauffeur,
  // antérieurs (solde du 2 reconstitué depuis celui du 3) comme postérieurs déjà
  // importés : dans ce cas on recalcule tout l'historique.
  const newAnchor = results.some((r) => r.kind === "soldes" && r.status === "imported");
  let rebuild: Record<string, unknown> | null = null;
  if (p.from && p.to) {
    const { data, error } = await sb.schema("fleet").rpc("fleetroom_rebuild", {
      p_tenant: tenantId, p_from: newAnchor ? "2000-01-01" : p.from, p_to: newAnchor ? "2099-12-31" : p.to,
    });
    if (error) throw new Error(`recalcul des déclarations : ${error.message}`);
    rebuild = data as Record<string, unknown>;
  }
  return { files: results, rebuild, linkedDrivers: linked, unknownDrivers: unknown };
}
