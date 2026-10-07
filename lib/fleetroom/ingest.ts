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
    // Un bonus crédité un jour sans course est reporté sur la dernière journée
    // travaillée qui le précède (migration 083) : elle peut être antérieure aux
    // fichiers déposés, d'où les 14 jours de marge avant la période.
    const depuis = new Date(Date.parse(`${p.from}T00:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
    rebuild = newAnchor
      ? await rebuildFleetroom(sb, tenantId)
      : await rebuildFleetroom(sb, tenantId, depuis, p.to);
  }
  return { files: results, rebuild, linkedDrivers: linked, unknownDrivers: unknown };
}

/**
 * Recalcul des déclarations, mois par mois.
 *
 * Un seul appel sur tout l'historique dépasse le délai de 8 s d'une requête
 * (constaté sur NMK avec 2025 + 2026 : 167 000 transactions). Le recalcul est
 * idempotent et chaque jour ne dépend que du brut : le découper ne change rien
 * au résultat. Sans bornes, toute la période connue du tenant est recalculée.
 */
export async function rebuildFleetroom(
  sb: SupabaseClient, tenantId: string, from?: string, to?: string,
): Promise<Record<string, unknown>> {
  const db = sb.schema("fleet");
  if (!from || !to) {
    const edge = async (table: string, col: string, ascending: boolean) => {
      const { data, error } = await db.from(table).select(col).eq("tenant_id", tenantId)
        .order(col, { ascending }).limit(1).maybeSingle();
      if (error) throw new Error(`période connue : ${error.message}`);
      return (data as Record<string, string> | null)?.[col] ?? null;
    };
    // les journées « hors Yango seul » peuvent dépasser la dernière transaction
    const bornes = (await Promise.all([
      edge("yango_transactions", "jour", true), edge("yango_transactions", "jour", false),
      edge("daily_reports", "date", false),
    ])).filter((j): j is string => !!j).sort();
    if (bornes.length === 0) return { inserted: 0, updated: 0, conflicts: 0, recharges: 0, unmapped_drivers: [], ecarts_solde: [] };
    from = from ?? bornes[0];
    to = to ?? bornes[bornes.length - 1];
  }

  const total = { inserted: 0, updated: 0, conflicts: 0, recharges: 0 };
  const unmapped = new Set<string>();
  const ecarts: unknown[] = [];
  for (let a = from; a <= to;) {
    const [y, m] = a.split("-").map(Number);
    const finMois = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const b = finMois < to ? finMois : to;
    for (const r of await rebuildRange(sb, tenantId, a, b)) {
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += Number(r[k] ?? 0);
      ((r.unmapped_drivers as string[] | null) ?? []).forEach((n) => unmapped.add(n));
      ecarts.push(...((r.ecarts_solde as unknown[] | null) ?? []));
    }
    a = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  }
  return { ...total, unmapped_drivers: [...unmapped], ecarts_solde: ecarts };
}

/**
 * Un mois peut dépasser le délai à son premier passage (constaté deux fois sur
 * NMK juste après un changement, puis 2 s à la relance) : la plage est alors
 * coupée en deux et rejouée. Le recalcul est idempotent, rien n'est compté deux fois.
 */
async function rebuildRange(
  sb: SupabaseClient, tenantId: string, a: string, b: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await sb.schema("fleet").rpc("fleetroom_rebuild", { p_tenant: tenantId, p_from: a, p_to: b });
  if (!error) return [data as Record<string, unknown>];
  if (a >= b || !/timeout/i.test(error.message)) {
    throw new Error(`recalcul des déclarations (${a} → ${b}) : ${error.message}`);
  }
  const jour = (t: number) => new Date(t).toISOString().slice(0, 10);
  const ta = Date.parse(a), milieu = ta + Math.floor((Date.parse(b) - ta) / 86_400_000 / 2) * 86_400_000;
  return [
    ...await rebuildRange(sb, tenantId, a, jour(milieu)),
    ...await rebuildRange(sb, tenantId, jour(milieu + 86_400_000), b),
  ];
}
