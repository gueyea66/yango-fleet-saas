/**
 * Mise en forme du tableau de bord v2 à partir des agrégats de
 * useDashboardKPIs (aucun recalcul métier).
 */
import { CAT_AVANCE } from "@/lib/expenseCategories";
import { sharePct } from "./format";

export interface CostRow {
  type: string;
  amount: number;
  pctCA: number | null;     // montant ÷ total recettes
  pctCosts: number | null;  // montant ÷ total des coûts listés
}

/**
 * « Coûts par poste » : une ligne par catégorie (mêmes agrégats que la
 * treemap), % du CA et % des coûts, plus la ligne Total. `CAT_AVANCE` est
 * exclu comme partout (une avance n'est pas une charge).
 */
export const LIGNE_AMORTISSEMENT = "Amortissement";

/**
 * `amortissement` entre dans le tableau comme un poste de coût à part entière,
 * alors qu'il n'est PAS une dépense saisie : il n'a ni justificatif, ni
 * chauffeur, et ne sort pas de trésorerie. Il y figure quand même parce que
 * l'exploitant lit ce tableau pour savoir ce que lui coûte son activité, et
 * qu'un tableau où l'usure des véhicules n'apparaît nulle part lui fait croire
 * que rouler est gratuit. La ligne est marquée « calculé » à l'écran pour que
 * la différence de nature reste visible.
 */
export function costBreakdown(
  breakdown: { type: string; amount: number }[],
  recettes: number,
  amortissement = 0,
): { rows: CostRow[]; total: CostRow } {
  const kept = breakdown.filter((b) => b.type !== CAT_AVANCE && Number.isFinite(b.amount) && b.amount > 0);
  if (Number.isFinite(amortissement) && amortissement > 0) {
    kept.push({ type: LIGNE_AMORTISSEMENT, amount: amortissement });
  }
  const totalAmount = kept.reduce((s, b) => s + b.amount, 0);
  const rows = kept
    .map((b) => ({ type: b.type, amount: b.amount, pctCA: sharePct(b.amount, recettes), pctCosts: sharePct(b.amount, totalAmount) }))
    .sort((a, b) => b.amount - a.amount);
  return {
    rows,
    total: { type: "Total", amount: totalAmount, pctCA: sharePct(totalAmount, recettes), pctCosts: totalAmount > 0 ? 100 : null },
  };
}

/**
 * Variation vs période précédente, par jour ouvré quand les deux fenêtres
 * sont connues (même règle que la HeroCard actuelle).
 */
export function variationPct(
  value: number, prev: number | null | undefined, days?: number | null, prevDays?: number | null,
): number | null {
  if (prev == null) return null;
  const norm = days != null && days > 0 && prevDays != null && prevDays > 0;
  const cur = norm ? value / (days as number) : value;
  const before = norm ? prev / (prevDays as number) : prev;
  if (before === 0) return null;
  return ((cur - before) / Math.abs(before)) * 100;
}

/** Libellé de catégorie sans émoji de tête (« 💵 Salaires » → « Salaires »). */
export function cleanCategory(label: string): string {
  return label.replace(/^[^\p{L}\p{N}]+/u, "").trim() || label;
}

export type DashView = "simple" | "avance";
export const DASH_VIEW_KEY = "m3a-dash-vue";

export function parseDashView(v: string | null | undefined): DashView {
  return v === "avance" ? "avance" : "simple";
}
