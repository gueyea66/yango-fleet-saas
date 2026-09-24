/**
 * Finance v2 : tableau des salaires de la période et « Derniers mouvements ».
 * Pur : ne fait qu'assembler les données déjà chargées (allocations de
 * useDashboardKPIs, paiements de /api/admin/payments, rapports et dépenses de
 * /api/admin/reports). Le salaire dû vient du moteur existant (injecté).
 */
import { inRange } from "./periodFilter";

/* eslint-disable @typescript-eslint/no-explicit-any -- config rémunération non typée (convention du projet) */

export interface SalaryAllocation {
  driver_id: string;
  name: string;
  netDeclared: number;
  prorataFactor?: number | null;
  salary_model?: string | null;
  base_amount?: number | null;
}

export interface PaymentLike {
  id?: string;
  driver_id: string;
  amount: number;
  type?: string | null;
  payment_date?: string | null;
  salary_month?: string | null;
  created_at?: string | null;
}

export interface SalaryRow {
  driverId: string;
  name: string;
  palier: string;
  du: number;
  avances: number;
  verse: number;
  reste: number;
  paidOn: string | null;
}

type Range = { from: string; to: string };
type SalaryFn = (netDeclared: number, cfg: any, prorataFactor?: number) => number;

const MODEL_LABEL: Record<string, string> = {
  fixed: "Salaire fixe", tiered: "Paliers CA net", percent: "% du CA",
  hybrid: "Fixe + bonus", location: "Loyer journalier",
};

/** Mois imputé d'un paiement : même règle que useDashboardKPIs (getSalaryDate). */
export const paymentSalaryDate = (p: PaymentLike) =>
  p.salary_month?.slice(0, 10) || p.payment_date || p.created_at?.slice(0, 10) || "";

/** Config effective d'un chauffeur : modèle et base perso si définis (comme DriverAllocationsBlock). */
export const effectiveCfg = (cfg: any, d: SalaryAllocation) =>
  ({ ...cfg, model: d.salary_model || cfg.model, base_amount: d.base_amount ?? cfg.base_amount });

/** Libellé du palier atteint (modèle à paliers) ou du modèle. */
export function palierLabel(netDeclared: number, cfg: any): string {
  const model: string = cfg.model || "tiered";
  if (model !== "tiered") return MODEL_LABEL[model] ?? model;
  const tiers: any[] = Array.isArray(cfg.salary_tiers) ? cfg.salary_tiers : [];
  const sorted = [...tiers].sort((a, b) => b.min_net - a.min_net);
  const tier = sorted.find((t) => netDeclared >= t.min_net) ?? sorted[sorted.length - 1];
  return tier?.label ?? "—";
}

/** Masse salariale projetée = Σ salaires dus (prorata inclus), comme RemunerationDashboardBlock. */
export function masseSalariale(allocations: SalaryAllocation[], cfg: any, salaryOf: SalaryFn): number {
  return allocations.reduce((s, d) => s + salaryOf(d.netDeclared, effectiveCfg(cfg, d), d.prorataFactor ?? undefined), 0);
}

/**
 * Une ligne par chauffeur de la période. Avances = acomptes imputés sur la
 * période ; Versé = paiements « salaire » imputés sur la période ;
 * Reste à payer = dû − avances − versé (jamais négatif).
 */
export function salaryRows(allocations: SalaryAllocation[], cfg: any, payments: PaymentLike[], range: Range, salaryOf: SalaryFn): SalaryRow[] {
  const inPeriod = payments.filter((p) => inRange(paymentSalaryDate(p), range));
  return allocations.map((d) => {
    const eff = effectiveCfg(cfg, d);
    const du = salaryOf(d.netDeclared, eff, d.prorataFactor ?? undefined);
    const mine = inPeriod.filter((p) => p.driver_id === d.driver_id);
    const avances = mine.filter((p) => p.type === "acompte").reduce((s, p) => s + (p.amount || 0), 0);
    const salaires = mine.filter((p) => p.type === "salaire");
    const verse = salaires.reduce((s, p) => s + (p.amount || 0), 0);
    const reste = Math.max(0, du - avances - verse);
    const lastPaid = salaires.map((p) => p.payment_date || p.created_at?.slice(0, 10) || "").filter(Boolean).sort().pop() ?? null;
    return {
      driverId: d.driver_id, name: d.name, palier: palierLabel(d.netDeclared, eff),
      du, avances, verse, reste, paidOn: verse > 0 && reste === 0 ? lastPaid : null,
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

export interface Movement {
  key: string;
  date: string;
  label: string;
  amount: number; // signé : + entrée, − sortie
}

const TYPE_LABEL: Record<string, string> = { salaire: "Salaire", acompte: "Avance", bonus: "Bonus", autre: "Paiement" };

/** 10 derniers mouvements de la période : paiements, avances, rapports et dépenses validés. */
export function recentMovements(
  { payments, reports, expenses, range, nameOf, limit = 10 }: {
    payments: PaymentLike[];
    reports: any[];
    expenses: any[];
    range: Range;
    nameOf: (driverId: string) => string;
    limit?: number;
  },
): Movement[] {
  const out: (Movement & { at: string })[] = [];
  for (const p of payments) {
    const date = p.payment_date || p.created_at?.slice(0, 10) || "";
    if (!inRange(date, range)) continue;
    out.push({ key: `p-${p.id ?? out.length}`, date, at: p.created_at || date, label: `${TYPE_LABEL[p.type || "autre"] ?? "Paiement"} · ${nameOf(p.driver_id)}`, amount: -(p.amount || 0) });
  }
  for (const r of reports) {
    if (r.status !== "approved" || !inRange(r.date, range)) continue;
    const recette = (r.yango_gross || 0) + (r.yango_bonus || 0) + (r.off_yango_revenue || 0);
    out.push({ key: `r-${r.id}`, date: r.date, at: r.updated_at || r.created_at || r.date, label: `Recette · ${nameOf(r.driver_id)}`, amount: recette });
  }
  for (const e of expenses) {
    const date = (e.expense_date || e.created_at || "").slice(0, 10);
    if (e.status !== "approved" || !inRange(date, range)) continue;
    out.push({ key: `e-${e.id}`, date, at: e.created_at || date, label: `${e.category || "Dépense"} · ${nameOf(e.driver_id)}`, amount: -(e.amount || 0) });
  }
  return out
    .sort((a, b) => (b.date === a.date ? (b.at > a.at ? 1 : b.at < a.at ? -1 : 0) : b.date > a.date ? 1 : -1))
    .slice(0, limit)
    .map((m) => ({ key: m.key, date: m.date, label: m.label, amount: m.amount }));
}

/** Mois (AAAA-MM-01) à pré-remplir dans « Nouveau paiement » : fin de la période. */
export const salaryMonthOf = (range: Range) => `${range.to.slice(0, 7)}-01`;

/**
 * Détail des décaissements (même composition que computeTresorerie) :
 * achats de solde + carburant + autres dépenses + décaissements propriétaire
 * + paiements chauffeurs (salaires, acomptes, bonus). La somme = la carte.
 */
export function decaissementsDetail(k: {
  decaissements: number; provisionsSolde: number; achatsCarburant: number;
  autresDepensesOpe: number; avancesProprietaire: number;
}): { label: string; amount: number }[] {
  const paiements = k.decaissements - k.provisionsSolde - k.achatsCarburant - k.autresDepensesOpe - k.avancesProprietaire;
  return [
    { label: "Achats de solde Yango", amount: k.provisionsSolde },
    { label: "Achats de carburant", amount: k.achatsCarburant },
    { label: "Autres dépenses validées", amount: k.autresDepensesOpe },
    { label: "Décaissements propriétaire", amount: k.avancesProprietaire },
    { label: "Paiements chauffeurs (salaires, acomptes, bonus)", amount: paiements },
  ];
}

/** Marge après salaires = CA net − salaires dus (formule du bloc Rémunération actuel). */
export const margeApresSalaires = (caNet: number, masse: number) => caNet - masse;
