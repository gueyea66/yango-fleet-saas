/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * Catalogue des extractions (page « Extraction ») : un rapport = des colonnes
 * typées + des lignes. Le même résultat sert l'aperçu à l'écran et le fichier
 * Excel. Les rapports Fleetroom ne sont proposés qu'aux tenants qui ont des
 * commandes importées.
 */
import { caOf, coursesOf, fleetroomStats, isRepos, type DriverStat, type OrderLike } from "./driverStats";
import type { TrendsResult } from "./trends";

export type ColType = "text" | "date" | "int" | "xof" | "pct" | "dec" | "h";

export interface Column {
  key: string;
  label: string;
  type: ColType;
  /** additionnée dans la ligne TOTAL de l'aperçu et du fichier */
  sum?: boolean;
}

export type Row = Record<string, string | number | null>;

export interface ReportResult {
  report: ReportKey;
  title: string;
  columns: Column[];
  rows: Row[];
  hasFleetroom: boolean;
  /** lecture plafonnée (30 000 lignes) : réduire la période */
  truncated?: boolean;
}

export type ReportKey = "classement" | "declarations" | "depenses" | "paiements" | "synthese_jour" | "kpi_jour" | "courses" | "tendances";

export interface ReportDef {
  key: ReportKey;
  label: string;
  description: string;
  fleetroom?: boolean;
}

export const REPORTS: ReportDef[] = [
  { key: "classement", label: "Classement chauffeurs", description: "Une ligne par chauffeur : jours, courses, CA, moyennes, km, net." },
  { key: "declarations", label: "Déclarations journalières", description: "Toutes les déclarations de la période, avec statut et source." },
  { key: "depenses", label: "Déclarations de charges", description: "Toutes les dépenses déclarées : catégorie, montant, statut, pièces jointes." },
  { key: "paiements", label: "Paiements chauffeurs", description: "Salaires, avances, bonus versés sur la période." },
  { key: "synthese_jour", label: "Synthèse par jour", description: "Totaux de la flotte jour par jour : chauffeurs actifs, courses, CA, net." },
  { key: "kpi_jour", label: "KPI Fleetroom par chauffeur et par jour", description: "Courses, refus, acceptation, heures en course, amplitude, km, XOF/km.", fleetroom: true },
  { key: "courses", label: "Courses Fleetroom (détail)", description: "Une ligne par commande Yango : statut, horaires, adresses, distance, montants.", fleetroom: true },
];

export const isReportKey = (k: string): k is ReportKey => REPORTS.some((r) => r.key === k);

const STATUT: Record<string, string> = { submitted: "En attente", approved: "Validée", rejected: "Rejetée", archived: "Archivée", draft: "Brouillon" };
export const statutLabel = (s?: string | null) => (s ? STATUT[s] ?? s : "Validée");

/** Ligne TOTAL : somme des colonnes `sum`, libellé dans la 1re colonne texte. */
export function totalRow(columns: Column[], rows: Row[]): Row | null {
  if (!rows.length || !columns.some((c) => c.sum)) return null;
  const out: Row = {};
  const first = columns.find((c) => c.type === "text" || c.type === "date");
  for (const c of columns) {
    if (c.sum) out[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0);
    else out[c.key] = null;
  }
  if (first) out[first.key] = "TOTAL";
  return out;
}

/* ── Constructeurs de lignes (purs) ─────────────────────────── */

export function declarationsRows(reports: any[], nameOf: (id: string) => string): { columns: Column[]; rows: Row[] } {
  const columns: Column[] = [
    { key: "date", label: "Date", type: "date" },
    { key: "chauffeur", label: "Chauffeur", type: "text" },
    { key: "statut", label: "Statut", type: "text" },
    { key: "source", label: "Source", type: "text" },
    { key: "courses", label: "Courses", type: "int", sum: true },
    { key: "brut_yango", label: "Brut Yango", type: "xof", sum: true },
    { key: "bonus", label: "Bonus", type: "xof", sum: true },
    { key: "hors_yango", label: "Hors Yango", type: "xof", sum: true },
    { key: "ca", label: "CA total", type: "xof", sum: true },
    { key: "commission", label: "Commission", type: "xof", sum: true },
    { key: "net", label: "Net", type: "xof", sum: true },
    { key: "solde", label: "Solde Yango", type: "xof" },
    { key: "compteur", label: "Compteur fin", type: "int" },
    { key: "commentaire", label: "Commentaire", type: "text" },
  ];
  const rows = [...reports]
    .sort((a, b) => (a.date === b.date ? nameOf(a.driver_id).localeCompare(nameOf(b.driver_id), "fr") : a.date < b.date ? -1 : 1))
    .map((r) => ({
      date: r.date, chauffeur: nameOf(r.driver_id), statut: isRepos(r) ? "Repos" : statutLabel(r.status),
      source: r.source || "chauffeur", courses: coursesOf(r), brut_yango: r.yango_gross ?? 0, bonus: r.yango_bonus ?? 0,
      hors_yango: r.off_yango_revenue ?? 0, ca: caOf(r), commission: r.commission_amount ?? 0,
      net: r.net_after_expenses ?? 0, solde: r.solde_yango ?? null, compteur: r.end_odometer || null,
      commentaire: r.comment || null,
    }));
  return { columns, rows };
}

export function depensesRows(expenses: any[], nameOf: (id: string) => string, piecesOf: (id: string) => number): { columns: Column[]; rows: Row[] } {
  const columns: Column[] = [
    { key: "date", label: "Date", type: "date" },
    { key: "chauffeur", label: "Chauffeur", type: "text" },
    { key: "categorie", label: "Catégorie", type: "text" },
    { key: "montant", label: "Montant", type: "xof", sum: true },
    { key: "litres", label: "Litres", type: "dec", sum: true },
    { key: "statut", label: "Statut", type: "text" },
    { key: "source", label: "Source", type: "text" },
    { key: "pieces", label: "Pièces jointes", type: "int", sum: true },
    { key: "description", label: "Description", type: "text" },
  ];
  const dateOf = (e: any) => String(e.expense_date || e.created_at || "").slice(0, 10);
  const rows = [...expenses]
    .sort((a, b) => dateOf(a).localeCompare(dateOf(b)))
    .map((e) => ({
      date: dateOf(e), chauffeur: e.driver_id ? nameOf(e.driver_id) : "—", categorie: e.category || "—",
      montant: e.amount ?? 0, litres: e.fuel_liters ?? null, statut: statutLabel(e.status),
      source: e.source || "chauffeur", pieces: piecesOf(e.id), description: e.description || null,
    }));
  return { columns, rows };
}

export function paiementsRows(payments: any[], nameOf: (id: string) => string): { columns: Column[]; rows: Row[] } {
  const columns: Column[] = [
    { key: "date", label: "Date de paiement", type: "date" },
    { key: "chauffeur", label: "Chauffeur", type: "text" },
    { key: "type", label: "Type", type: "text" },
    { key: "mois", label: "Mois imputé", type: "text" },
    { key: "montant", label: "Montant", type: "xof", sum: true },
    { key: "notes", label: "Notes", type: "text" },
  ];
  const rows = [...payments]
    .sort((a, b) => String(a.payment_date).localeCompare(String(b.payment_date)))
    .map((p) => ({
      date: p.payment_date, chauffeur: nameOf(p.driver_id), type: p.type || "autre",
      mois: p.salary_month ? String(p.salary_month).slice(0, 7) : null, montant: p.amount ?? 0, notes: p.notes || null,
    }));
  return { columns, rows };
}

export function syntheseJourRows(reports: any[]): { columns: Column[]; rows: Row[] } {
  const columns: Column[] = [
    { key: "date", label: "Date", type: "date" },
    { key: "chauffeurs", label: "Chauffeurs actifs", type: "int" },
    { key: "courses", label: "Courses", type: "int", sum: true },
    { key: "ca", label: "CA total", type: "xof", sum: true },
    { key: "net", label: "Net", type: "xof", sum: true },
    { key: "ca_par_chauffeur", label: "CA / chauffeur", type: "xof" },
  ];
  const by = new Map<string, any[]>();
  for (const r of reports) if (!isRepos(r)) (by.get(r.date) ?? by.set(r.date, []).get(r.date)!).push(r);
  const rows = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, reps]) => {
    const drivers = new Set(reps.map((r) => r.driver_id)).size;
    const ca = reps.reduce((s, r) => s + caOf(r), 0);
    return {
      date, chauffeurs: drivers, courses: reps.reduce((s, r) => s + coursesOf(r), 0), ca,
      net: reps.reduce((s, r) => s + (r.net_after_expenses || 0), 0), ca_par_chauffeur: drivers ? Math.round(ca / drivers) : null,
    };
  });
  return { columns, rows };
}

export function kpiJourRows(orders: (OrderLike & { driver_name?: string | null })[], nameOfYango: (yid: string, fallback?: string | null) => string): { columns: Column[]; rows: Row[] } {
  const columns: Column[] = [
    { key: "date", label: "Date", type: "date" },
    { key: "chauffeur", label: "Chauffeur", type: "text" },
    { key: "courses", label: "Courses", type: "int", sum: true },
    { key: "refus", label: "Refus", type: "int", sum: true },
    { key: "echecs", label: "Échecs connexion", type: "int", sum: true },
    { key: "annul_client", label: "Annulées client", type: "int", sum: true },
    { key: "acceptation", label: "Acceptation", type: "pct" },
    { key: "heures", label: "Heures en course", type: "h", sum: true },
    { key: "amplitude", label: "Amplitude (h)", type: "h" },
    { key: "occupation", label: "Occupation", type: "pct" },
    { key: "km", label: "Km en course", type: "dec", sum: true },
    { key: "ca", label: "CA courses", type: "xof", sum: true },
    { key: "xof_km", label: "XOF / km", type: "xof" },
  ];
  const by = new Map<string, typeof orders>();
  for (const o of orders) {
    if (!o.jour || !o.yango_driver_id) continue;
    const k = `${o.jour}|${o.yango_driver_id}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(o);
  }
  const rows = [...by.entries()].map(([k, os]) => {
    const [date, yid] = k.split("|");
    const s = fleetroomStats(os);
    return {
      date, chauffeur: nameOfYango(yid, os[0].driver_name), courses: s.courses, refus: s.refus, echecs: s.echecs,
      annul_client: s.annulClient, acceptation: s.tauxAcceptation, heures: s.heuresCourse, amplitude: s.amplitudeMoy,
      occupation: s.occupation, km: s.km, ca: s.caCourses, xof_km: s.xofParKm != null ? Math.round(s.xofParKm) : null,
    };
  }).sort((a, b) => (a.date === b.date ? String(a.chauffeur).localeCompare(String(b.chauffeur), "fr") : a.date < b.date ? -1 : 1));
  return { columns, rows };
}

export function coursesRows(orders: any[], nameOfYango: (yid: string, fallback?: string | null) => string): { columns: Column[]; rows: Row[] } {
  const columns: Column[] = [
    { key: "date", label: "Jour", type: "date" },
    { key: "debut", label: "Début", type: "text" },
    { key: "fin", label: "Fin", type: "text" },
    { key: "chauffeur", label: "Chauffeur", type: "text" },
    { key: "plaque", label: "Plaque", type: "text" },
    { key: "statut", label: "Statut", type: "text" },
    { key: "raison", label: "Raison d'annulation", type: "text" },
    { key: "depart", label: "Adresse", type: "text" },
    { key: "arrivee", label: "Arrivée", type: "text" },
    { key: "classe", label: "Classe", type: "text" },
    { key: "km", label: "Km", type: "dec", sum: true },
    { key: "especes", label: "Espèces", type: "xof", sum: true },
    { key: "carte", label: "Carte", type: "xof", sum: true },
    { key: "commission", label: "Commission", type: "xof", sum: true },
    { key: "code", label: "Code commande", type: "text" },
  ];
  // heure locale de Dakar (UTC+0, sans heure d'été) : HH:MM de l'horodatage
  const hhmm = (t?: string | null) => (t ? new Date(t).toISOString().slice(11, 16) : null);
  const rows = [...orders]
    .sort((a, b) => String(a.started_at ?? a.jour).localeCompare(String(b.started_at ?? b.jour)))
    .map((o) => ({
      date: o.jour, debut: hhmm(o.started_at), fin: hhmm(o.ended_at), chauffeur: nameOfYango(o.yango_driver_id, o.driver_name),
      plaque: o.plate || null, statut: o.status || null, raison: o.cancel_reason || null, depart: o.address_from || null,
      arrivee: o.address_to || null, classe: o.service_class || null,
      km: o.distance_m != null ? Math.round(Number(o.distance_m) / 100) / 10 : null,
      especes: o.cash ?? 0, carte: o.cashless ?? 0, commission: o.commission ?? 0, code: o.order_code || null,
    }));
  return { columns, rows };
}

/** Colonnes du classement ; les colonnes Fleetroom seulement si le tenant en a. */
export function classementColumns(hasFleetroom: boolean): Column[] {
  const base: Column[] = [
    { key: "rang", label: "Rang", type: "int" },
    { key: "name", label: "Chauffeur", type: "text" },
    { key: "jours", label: "Jours travaillés", type: "int", sum: true },
    { key: "repos", label: "Repos", type: "int", sum: true },
    { key: "sansDeclaration", label: "Sans déclaration", type: "int", sum: true },
    { key: "courses", label: "Courses", type: "int", sum: true },
    { key: "ca", label: "CA", type: "xof", sum: true },
    { key: "caParJour", label: "CA / jour", type: "xof" },
    { key: "caParCourse", label: "CA / course", type: "xof" },
    { key: "coursesParJour", label: "Courses / jour", type: "dec" },
    { key: "km", label: "Km", type: "int", sum: true },
    { key: "caParKm", label: "CA / km", type: "xof" },
    { key: "net", label: "Net déclaré", type: "xof", sum: true },
    { key: "depenses", label: "Charges", type: "xof", sum: true },
  ];
  if (!hasFleetroom) return base;
  return [
    ...base,
    { key: "fr.tauxAcceptation", label: "Acceptation", type: "pct" },
    { key: "fr.refus", label: "Refus", type: "int", sum: true },
    { key: "fr.heuresCourse", label: "Heures en course", type: "h", sum: true },
    { key: "fr.amplitudeMoy", label: "Amplitude moy. (h)", type: "h" },
    { key: "fr.occupation", label: "Occupation", type: "pct" },
    { key: "fr.xofParKm", label: "XOF / km (Yango)", type: "xof" },
  ];
}

/** Ligne plate (clés = colonnes) d'un chauffeur du classement. */
export function classementRow(r: DriverStat): Row {
  const fr = r.fleetroom;
  const round = (v: number | null, d = 0) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
  return {
    driverId: r.driverId, rang: r.rang ?? null, name: r.name, jours: r.jours,
    repos: r.repos, sansDeclaration: r.sansDeclaration, courses: r.courses, ca: Math.round(r.ca),
    caParJour: round(r.caParJour), caParCourse: round(r.caParCourse), coursesParJour: round(r.coursesParJour, 1),
    km: r.km, caParKm: round(r.caParKm), net: Math.round(r.net), depenses: Math.round(r.depenses),
    "fr.tauxAcceptation": fr?.tauxAcceptation ?? null, "fr.refus": fr?.refus ?? null,
    "fr.heuresCourse": fr?.heuresCourse ?? null, "fr.amplitudeMoy": fr?.amplitudeMoy ?? null,
    "fr.occupation": fr?.occupation ?? null, "fr.xofParKm": round(fr?.xofParKm ?? null),
  };
}

const STATUT_TXT = { atteint: "✓ Atteint", proche: "≈ Proche", sous: "✗ Sous" } as const;

/** Tendances en tableau (export Excel) : une ligne par période. */
export function trendsTable(t: TrendsResult): { columns: Column[]; rows: Row[] } {
  const columns: Column[] = [
    { key: "periode", label: "Période", type: "text" },
    { key: "du", label: "Du", type: "date" },
    { key: "au", label: "Au", type: "date" },
    { key: "chauffeurs", label: "Chauffeurs actifs", type: "int" },
    { key: "journees", label: "Journées-chauffeur", type: "int", sum: true },
    { key: "courses", label: "Courses", type: "int", sum: true },
    { key: "ca", label: "CA", type: "xof", sum: true },
    { key: "ca_jour", label: "CA / jour / chauffeur", type: "xof" },
    { key: "atteinte", label: `Atteinte objectif (${new Intl.NumberFormat("fr-FR").format(t.objectif)})`, type: "pct" },
    { key: "statut", label: "Statut", type: "text" },
    { key: "jours_atteints", label: "Journées ≥ objectif", type: "int", sum: true },
    { key: "jours_proches", label: "Journées 80–100 %", type: "int", sum: true },
    { key: "jours_sous", label: "Journées < 80 %", type: "int", sum: true },
  ];
  const rows = t.buckets.map((b) => ({
    periode: b.enCours ? `${b.label} (en cours)` : b.label, du: b.from, au: b.to, chauffeurs: b.chauffeurs,
    journees: b.journees, courses: b.courses, ca: Math.round(b.ca), ca_jour: b.caParJour != null ? Math.round(b.caParJour) : null,
    atteinte: b.atteinte, statut: b.statut ? STATUT_TXT[b.statut] : null,
    jours_atteints: b.jours.atteint, jours_proches: b.jours.proche, jours_sous: b.jours.sous,
  }));
  return { columns, rows };
}
