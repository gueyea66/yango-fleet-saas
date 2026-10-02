/**
 * Historique admin v2 : une seule liste pour les déclarations (daily_reports)
 * et les déclarations de charge (expenses), tous statuts confondus.
 *
 * Retour Abdou 01/10 : « je ne vois pas l'historique des déclarations et
 * déclarations de charge ainsi que les photos ». La grille ne montrait que les
 * rapports, les charges étaient cachées derrière « Voir en liste », et aucune
 * ligne ne disait si une photo était jointe.
 *
 * Logique pure (filtres, tri, comptage des pièces, nature d'un fichier) : testée
 * dans __tests__/v2/history.test.ts.
 */
import { inRange, type PeriodRange } from "./periodFilter";

/* eslint-disable @typescript-eslint/no-explicit-any -- lignes non typées (convention du projet) */

export type HistoryKind = "report" | "expense";
export type HistoryStatus = "submitted" | "approved" | "rejected";
export type HistoryTypeFilter = "all" | HistoryKind;
export type HistoryStatusFilter = "all" | HistoryStatus;

export type HistoryRow = {
  kind: HistoryKind;
  id: string;
  driverId: string;
  /** AAAA-MM-JJ : date déclarée (rapport) ou date de la dépense (repli : envoi). */
  date: string;
  status: HistoryStatus;
  amount: number;
  /** Nombre de pièces jointes connues (0 si inconnu). */
  photos: number;
  repos: boolean;
  raw: any;
};

/** Statut normalisé ; `null` = ligne à écarter (archivée, remplacée). */
export function normStatus(s: unknown): HistoryStatus | null {
  if (s == null || s === "" || s === "submitted" || s === "pending") return "submitted";
  if (s === "approved" || s === "rejected") return s;
  return null;
}

export const isReposReport = (r: any) => typeof r?.comment === "string" && r.comment.startsWith("[REPOS]");

const expenseDate = (e: any): string => String(e?.expense_date || e?.created_at || "").slice(0, 10);

export function buildHistoryRows(
  reports: any[],
  expenses: any[],
  opts: {
    type?: HistoryTypeFilter;
    status?: HistoryStatusFilter;
    range?: PeriodRange | null;
    driverIds?: string[];
    counts?: Record<string, number>;
  } = {},
): HistoryRow[] {
  const { type = "all", status = "all", range, driverIds = [], counts = {} } = opts;
  const rows: HistoryRow[] = [];
  const keep = (driverId: string, date: string, st: HistoryStatus | null) =>
    st != null
    && (status === "all" || st === status)
    && (!driverIds.length || driverIds.includes(driverId))
    && (!range || inRange(date, range));

  if (type !== "expense") {
    for (const r of reports) {
      const st = normStatus(r.status);
      const date = String(r.date || "").slice(0, 10);
      if (!keep(r.driver_id, date, st)) continue;
      const repos = isReposReport(r);
      rows.push({
        kind: "report", id: r.id, driverId: r.driver_id, date, status: st!,
        amount: repos ? 0 : Number(r.net_after_expenses ?? r.gross_earnings ?? 0) || 0,
        photos: counts[r.id] ?? 0, repos, raw: r,
      });
    }
  }
  if (type !== "report") {
    for (const e of expenses) {
      const st = normStatus(e.status);
      const date = expenseDate(e);
      if (!keep(e.driver_id, date, st)) continue;
      rows.push({
        kind: "expense", id: e.id, driverId: e.driver_id, date, status: st!,
        amount: Number(e.amount ?? 0) || 0, photos: counts[e.id] ?? 0, repos: false, raw: e,
      });
    }
  }
  return sortHistoryRows(rows);
}

/** Plus récent d'abord : date déclarée, puis heure d'envoi, puis id (ordre stable). */
export function sortHistoryRows(rows: HistoryRow[]): HistoryRow[] {
  const sent = (r: HistoryRow) => String(r.raw?.created_at || "");
  return [...rows].sort((a, b) =>
    b.date.localeCompare(a.date) || sent(b).localeCompare(sent(a)) || b.id.localeCompare(a.id));
}

/** Compteurs pour les filtres (Tous / En attente / Validées / Rejetées). */
export function historyStatusCounts(rows: HistoryRow[]): Record<HistoryStatusFilter, number> {
  const c = { all: rows.length, submitted: 0, approved: 0, rejected: 0 };
  for (const r of rows) c[r.status] += 1;
  return c;
}

/** Nombre de pièces par ligne liée (`uploads.ref_id`). */
export function countUploadsByRef(uploads: { ref_id?: string | null }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const u of uploads) if (u.ref_id) out[u.ref_id] = (out[u.ref_id] ?? 0) + 1;
  return out;
}

/** Découpe une liste d'ids en paquets (filtre `.in(...)` sans URL trop longue). */
export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * Nature d'une pièce pour l'affichage. HEIC/HEIF (photos iPhone) : aucun
 * navigateur courant hors Safari ne sait les afficher dans un <img> — on
 * propose un lien d'ouverture / téléchargement plutôt qu'une vignette cassée.
 */
export type FileKind = "image" | "heic" | "pdf" | "other";
export function fileKind(name?: string | null, mime?: string | null): FileKind {
  const n = String(name || "").toLowerCase();
  const m = String(mime || "").toLowerCase();
  if (/\.(heic|heif)$/.test(n) || m === "image/heic" || m === "image/heif") return "heic";
  if (/\.(jpe?g|png|gif|webp|avif|bmp)$/.test(n) || (m.startsWith("image/") && !n.includes("."))) return "image";
  if (/\.pdf$/.test(n) || m === "application/pdf") return "pdf";
  return "other";
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Date AAAA-MM-JJ valide, sinon null (rien d'autre n'entre dans un filtre PostgREST). */
export const isoDayOrNull = (s: string | null | undefined): string | null => (s && ISO_DAY.test(s) ? s : null);

const nextDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

/**
 * Filtre `.or(...)` des dépenses sur une période : `expense_date` quand elle
 * est saisie, sinon la date d'envoi (`created_at`, horodatage → borne haute
 * exclusive au lendemain). `null` = pas de borne.
 */
export function expenseRangeOr(from?: string | null, to?: string | null): string | null {
  const f = isoDayOrNull(from);
  const t = isoDayOrNull(to);
  if (!f && !t) return null;
  const onDate = [f && `expense_date.gte.${f}`, t && `expense_date.lte.${t}`].filter(Boolean).join(",");
  const onSent = ["expense_date.is.null", f && `created_at.gte.${f}`, t && `created_at.lt.${nextDay(t)}`].filter(Boolean).join(",");
  return `and(${onDate}),and(${onSent})`;
}

/**
 * Pièce prête à afficher : URL signée (vide si la signature a échoué), nature
 * du fichier, et `isImg` réservé aux formats qu'un <img> sait rendre (HEIC
 * exclu, sinon vignette cassée).
 */
export function enrichUpload<T extends { file_name?: string | null; file_path?: string | null }>(u: T, url?: string | null) {
  const kind = fileKind(u?.file_name || u?.file_path);
  return { ...u, publicUrl: url || "", kind, isImg: kind === "image", signFailed: !url };
}
