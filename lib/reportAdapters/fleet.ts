import { createClient } from "@supabase/supabase-js";
import type { Decision, Insight, ReportDataset, Section, TableSection } from "@/lib/report-agent/types";

/**
 * Adaptateur M3A Fleet pour le noyau lib/report-agent : (Supabase fleet) →
 * ReportDataset. C'est ICI que vit tout le métier ; le noyau reste portable.
 *
 * Chiffres : STRICTEMENT les mêmes formules que /api/admin/export?resource=recap
 * (net final = net après charges − dépenses − rémunération versée). Règles
 * gravées : [REPOS] exclus des calculs, acomptes = rémunération du mois
 * (salary_month sinon payment_date), comptes techniques hors benchmarks.
 */

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export type FleetReportKind = "monthly" | "ytd" | "deepdive";

const fmt = (v: number) => Math.round(v).toLocaleString("fr-FR").replace(/ /g, " ");
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const frFull = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

// ── extraction + agrégats d'une période ─────────────────────────────────────

interface DriverAgg {
  id: string; name: string; technical: boolean;
  hire: string | null; end: string | null;
  jours: number; repos: number; premier: string | null; dernier: string | null;
  brut: number; bonus: number; hors: number; comm: number; svc: number;
  net: number; dep: number; carb: number; sal: number; aco: number; courses: number;
  odo: Map<string, number>;
}

interface PeriodAgg {
  drivers: DriverAgg[];
  tot: {
    jours: number; repos: number; brut: number; bonus: number; hors: number;
    comm: number; net: number; dep: number; sal: number; aco: number; courses: number;
  };
  depCat: Map<string, number>;
  /** Lignes de charge brutes (motifs saisis) — matière du deep dive dépenses. */
  expenseRows: { date: string; driver_id: string | null; category: string; amount: number; description: string }[];
  pending: number;
  reportRows: { date: string; driver_id: string; brut: number; bonus: number; hors: number; courses: number }[];
}

async function aggregatePeriod(tenantId: string, dateFrom: string, dateTo: string): Promise<PeriodAgg> {
  const [{ data: profiles }, repsQ, expsQ, paysQ] = await Promise.all([
    admin.from("profiles").select("id, driver_id, full_name, account_type, hire_date, contract_end_date")
      .eq("tenant_id", tenantId),
    admin.from("daily_reports")
      .select("date,driver_id,yango_gross,yango_bonus,off_yango_revenue,commission_amount,service_supplementaire,net_after_expenses,yango_trip_count,end_odometer,status,comment")
      .eq("tenant_id", tenantId)
      .gte("date", dateFrom).lte("date", dateTo).order("date").limit(20000),
    admin.from("expenses").select("driver_id,category,amount,expense_date,description")
      .eq("tenant_id", tenantId).gte("expense_date", dateFrom).lte("expense_date", dateTo).limit(20000),
    admin.from("payments").select("driver_id,amount,payment_date,salary_month,type")
      .eq("tenant_id", tenantId).limit(20000),
  ]);

  const isRepos = (r: { comment?: string | null }) => String(r.comment || "").startsWith("[REPOS]");
  const allReports = repsQ.data || [];
  const reposReports = allReports.filter(isRepos);
  const reports = allReports.filter((r) => !isRepos(r));
  const expenses = expsQ.data || [];
  const salaryDate = (p: { salary_month?: string | null; payment_date?: string | null }) =>
    (p.salary_month ? String(p.salary_month).slice(0, 10) : p.payment_date) || "";
  const payments = (paysQ.data || []).filter((p) => {
    const d = salaryDate(p);
    return d >= dateFrom && d <= dateTo;
  });

  const profOf = new Map((profiles || []).map((p) => [p.id, p]));
  const acc = new Map<string, DriverAgg>();
  const get = (id: string): DriverAgg => {
    if (!acc.has(id)) {
      const p = profOf.get(id);
      acc.set(id, {
        id, name: p?.full_name || p?.driver_id || String(id).slice(0, 8),
        technical: p?.account_type === "technical",
        hire: p?.hire_date || null, end: p?.contract_end_date || null,
        jours: 0, repos: 0, premier: null, dernier: null, brut: 0, bonus: 0, hors: 0,
        comm: 0, svc: 0, net: 0, dep: 0, carb: 0, sal: 0, aco: 0, courses: 0, odo: new Map(),
      });
    }
    return acc.get(id)!;
  };

  const approved = reports.filter((r) => r.status === "approved");
  for (const r of approved) {
    const a = get(r.driver_id);
    a.jours += 1;
    a.premier = a.premier && a.premier <= r.date ? a.premier : r.date;
    a.dernier = a.dernier && a.dernier >= r.date ? a.dernier : r.date;
    a.brut += r.yango_gross || 0; a.bonus += r.yango_bonus || 0;
    a.hors += r.off_yango_revenue || 0; a.comm += r.commission_amount || 0;
    a.svc += r.service_supplementaire || 0; a.net += r.net_after_expenses || 0;
    a.courses += r.yango_trip_count || 0;
    if (r.end_odometer) a.odo.set(r.date, r.end_odometer);
  }
  for (const r of reposReports) get(r.driver_id).repos += 1;

  const depCat = new Map<string, number>();
  for (const e of expenses) {
    if (e.driver_id) {
      const a = get(e.driver_id);
      a.dep += e.amount || 0;
      if ((e.category || "") === "Carburant") a.carb += e.amount || 0;
    }
    depCat.set(e.category || "Autre", (depCat.get(e.category || "Autre") || 0) + (e.amount || 0));
  }
  for (const p of payments) {
    if (!p.driver_id) continue;
    if ((p.type || "salaire") === "acompte") get(p.driver_id).aco += p.amount || 0;
    else get(p.driver_id).sal += p.amount || 0;
  }

  const drivers = Array.from(acc.values()).sort((a, b) => (b.brut + b.bonus + b.hors) - (a.brut + a.bonus + a.hors));
  const tot = drivers.reduce((t, a) => ({
    jours: t.jours + a.jours, repos: t.repos + a.repos, brut: t.brut + a.brut, bonus: t.bonus + a.bonus,
    hors: t.hors + a.hors, comm: t.comm + a.comm + a.svc, net: t.net + a.net,
    dep: t.dep + a.dep, sal: t.sal + a.sal, aco: t.aco + a.aco, courses: t.courses + a.courses,
  }), { jours: 0, repos: 0, brut: 0, bonus: 0, hors: 0, comm: 0, net: 0, dep: 0, sal: 0, aco: 0, courses: 0 });
  // les dépenses sans chauffeur comptent dans le total (même règle que le recap)
  tot.dep = Math.round(Array.from(depCat.values()).reduce((s, v) => s + v, 0));

  return {
    drivers, tot, depCat,
    expenseRows: expenses.map((e) => ({
      date: e.expense_date || "", driver_id: e.driver_id,
      category: e.category || "Autre", amount: Math.round(e.amount || 0),
      description: String((e as { description?: string | null }).description || "").trim(),
    })),
    pending: reports.length - approved.length,
    reportRows: approved.map((r) => ({
      date: r.date, driver_id: r.driver_id,
      brut: r.yango_gross || 0, bonus: r.yango_bonus || 0,
      hors: r.off_yango_revenue || 0, courses: r.yango_trip_count || 0,
    })),
  };
}

const recetteOf = (a: { brut: number; bonus: number; hors: number }) => a.brut + a.bonus + a.hors;
const netFinalOf = (p: PeriodAgg) => p.tot.net - p.tot.dep - (p.tot.sal + p.tot.aco);

function previousRange(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } {
  const from = new Date(`${dateFrom}T00:00:00Z`);
  const days = Math.round((new Date(`${dateTo}T00:00:00Z`).getTime() - from.getTime()) / 86400000) + 1;
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(from.getTime() - days * 86400000);
  return { dateFrom: prevFrom.toISOString().slice(0, 10), dateTo: prevTo.toISOString().slice(0, 10) };
}

// ── règles déterministes du rapport mensuel (repli sans LLM) ────────────────

function monthlyDeterministic(
  p: PeriodAgg, dateFrom: string, dateTo: string
): { insights: Insight[]; decisions: Decision[] } {
  const recette = recetteOf(p.tot);
  const periodDays = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
  const insights: Insight[] = [];
  let endedCount = 0;
  for (const a of p.drivers) {
    if (a.technical || a.jours === 0) continue;
    const share = pct(recetteOf(a), recette);
    const endedInPeriod = !!(a.end && a.end >= dateFrom && a.end <= dateTo);
    const hiredInPeriod = !!(a.hire && a.hire > dateFrom && a.hire <= dateTo);
    if (endedInPeriod) {
      endedCount += 1;
      insights.push({ severity: "info", html: `<b>${esc(a.name)} : contrat terminé le ${fr(a.end!)}</b>${hiredInPeriod ? ` (embauché le ${fr(a.hire!)})` : ""} — ${a.jours} jours travaillés, rémunération versée ${fmt(a.sal + a.aco)} F.` });
    } else if (hiredInPeriod) {
      insights.push({ severity: "info", html: `<b>${esc(a.name)} a démarré le ${fr(a.hire!)}</b> (${a.jours} j) — ses ratios peuvent inclure une période promo Yango : non comparables ce mois-ci.` });
    } else if (periodDays >= 28) {
      const expectedRest = Math.round(periodDays / 7);
      if (a.jours + a.repos >= periodDays && a.repos < expectedRest) {
        insights.push({ severity: "warn", html: `<b>${esc(a.name)} : ${a.repos || "aucun"} repos déclaré${a.repos > 1 ? "s" : ""} sur ~${expectedRest} attendus</b> (rythme visé 1/semaine) pour ${a.jours} jours travaillés — il porte ${share} % de la recette, risque fatigue.` });
      } else if (a.jours < 14) {
        insights.push({ severity: "warn", html: `<b>${esc(a.name)} : ${a.jours} jours rapportés seulement</b> sans fin de contrat déclarée — arrêt réel ou trous de saisie ? À éclaircir.` });
      }
    }
  }
  if (endedCount > 0) {
    const remaining = p.drivers.filter((a) => !a.technical && a.jours > 0 && !(a.end && a.end <= dateTo)).length;
    insights.push({ severity: remaining <= 1 ? "alert" : "warn", html: `<b>${endedCount} contrat(s) terminé(s) sur la période — ${remaining} chauffeur(s) encore actif(s) ensuite.</b> Anticiper le recrutement pour ne pas laisser de véhicule à l'arrêt.` });
  }
  const carb = p.depCat.get("Carburant") || 0;
  if (recette > 0 && carb > 0) {
    insights.push({ severity: pct(carb, recette) > 24 ? "alert" : "info", html: `<b>Carburant : ${fmt(carb)} F, soit ${pct(carb, recette)} % de la recette</b> (${pct(carb, p.tot.dep)} % des dépenses) — levier de marge n°1.` });
  }
  if (recette > 0) {
    insights.push({ severity: "info", html: `<b>Ponction Yango réelle (commissions déclarées) : ${fmt(p.tot.comm)} F = ${pct(p.tot.comm, recette)} % du brut.</b>` });
    if (p.tot.hors > 0) insights.push({ severity: "ok", html: `<b>Le hors-Yango rapporte ${fmt(p.tot.hors)} F (${pct(p.tot.hors, recette)} % de la recette)</b> — sans commission, direct en marge.` });
  }
  if (p.pending > 0) {
    insights.push({ severity: "warn", html: `<b>${p.pending} rapport(s) en attente de validation</b> — les chiffres sont incomplets tant qu'ils ne sont pas tranchés.` });
  }
  const decisions: Decision[] = [];
  if (endedCount > 0) decisions.push({ html: "<b>Recruter</b> pour remplacer les contrats terminés — un véhicule à l'arrêt ne produit rien." });
  if (recette > 0 && pct(carb, recette) > 24) decisions.push({ html: "<b>Lancer le suivi carburant par chauffeur×véhicule</b> — premier levier de marge." });
  if (p.pending > 0) decisions.push({ html: `<b>Valider les ${p.pending} rapport(s) en attente</b> pour figer les chiffres du mois.` });
  return { insights, decisions };
}

// ── colonnes communes du tableau chauffeurs ─────────────────────────────────

function driverTable(p: PeriodAgg, dateFrom: string, dateTo: string): Section {
  const recette = recetteOf(p.tot);
  const remu = p.tot.sal + p.tot.aco;
  const rows: TableSection["rows"] = p.drivers.map((a) => {
    const rec = recetteOf(a);
    const panier = a.courses > 0 ? Math.round(a.brut / a.courses) : null;
    const caJ = a.jours > 0 ? Math.round(rec / a.jours) : null;
    const aRemu = a.sal + a.aco;
    const netF = a.net - a.dep - aRemu;
    const endedInPeriod = !!(a.end && a.end >= dateFrom && a.end <= dateTo);
    const tag = a.technical ? '<span class="tag navy">compte technique</span>'
      : endedInPeriod ? `<span class="tag amber">contrat fini ${fr(a.end!)}</span>`
      : a.hire && a.hire > dateFrom ? `<span class="tag navy">embauché ${fr(a.hire)}</span>` : "";
    const d = (v: number | null) => (v == null ? "—" : fmt(v));
    const joursCell = a.jours ? `${a.jours}${a.repos ? ` <span style="color:var(--ink3)">+${a.repos}r</span>` : ""}` : "—";
    const remuCell = aRemu ? `${fmt(aRemu)}${a.aco ? ` <span style="color:var(--ink3);font-size:8pt">dont ${fmt(a.aco)} ac.</span>` : ""}` : "—";
    return {
      cells: [
        `<b>${esc(a.name)}</b> ${tag}`, joursCell,
        a.technical ? "—" : fmt(rec), a.technical ? "—" : fmt(a.comm + a.svc),
        fmt(a.dep), remuCell, `<b>${fmt(netF)}</b>`, d(panier), d(caJ),
      ],
    };
  });
  rows.push({
    cells: [
      "TOTAL", `${p.tot.jours}${p.tot.repos ? ` +${p.tot.repos}r` : ""}`,
      fmt(recette), fmt(p.tot.comm), fmt(p.tot.dep), fmt(remu),
      fmt(netFinalOf(p)), "", "",
    ],
    total: true,
  });
  return {
    kind: "table",
    title: "Résultats par chauffeur",
    columns: [
      { label: "Chauffeur" }, { label: "Jours", align: "right" },
      { label: "Recette brute", align: "right" }, { label: "Commissions", align: "right" },
      { label: "Dépenses", align: "right" }, { label: "Rému. versée", align: "right" },
      { label: "Net final", align: "right" }, { label: "Panier moy.", align: "right" },
      { label: "CA / jour", align: "right" },
    ],
    rows,
    note: "Montants en FCFA. « Jours » = jours travaillés (+Nr = repos déclarés, exclus des calculs). Rému. versée = salaires + acomptes rattachés au mois. Net final = net après commissions − dépenses − rémunération versée. Un chauffeur embauché en cours de mois peut inclure une période promo Yango : ratios non comparables.",
  };
}

/**
 * Charges notables : hors Carburant/Solde Yango, les plus grosses lignes de la
 * période AVEC leur motif saisi — visibles dans le rapport et exploitées par le
 * panel pour le deep dive dépenses (retour Abdou 02/09 : les décaissements
 * propriétaire commentés doivent s'expliquer, pas finir en delta anonyme).
 */
function notableExpensesTable(p: PeriodAgg, top = 8): Section | null {
  const nameOf = new Map(p.drivers.map((d) => [d.id, d.name]));
  const rows = p.expenseRows
    .filter((e) => e.category !== "Carburant" && e.category !== "Solde Yango" && e.amount >= 5000)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, top)
    .map((e) => ({
      cells: [
        fr(e.date), esc(e.category),
        esc(e.description || "(sans motif — à documenter)"),
        esc(e.driver_id ? (nameOf.get(e.driver_id) || "?") : "—"),
        fmt(e.amount),
      ],
    }));
  if (rows.length === 0) return null;
  return {
    kind: "table",
    title: "Charges notables de la période",
    columns: [
      { label: "Date" }, { label: "Motif" }, { label: "Détail saisi" },
      { label: "Chauffeur" }, { label: "Montant", align: "right" },
    ],
    rows,
    note: "Hors carburant et solde Yango — les plus grosses lignes avec le motif saisi à la déclaration. Une ligne « sans motif » mérite d'être documentée pour que l'analyse mensuelle reste exploitable.",
  };
}

function depBars(p: PeriodAgg): Section | null {
  if (p.depCat.size === 0) return null;
  const entries = Array.from(p.depCat.entries()).sort((a, b) => b[1] - a[1]);
  const maxDep = Math.max(entries[0]?.[1] ?? 0, 1);
  return {
    kind: "bars",
    title: "Dépenses par catégorie",
    bars: entries.map(([cat, amt]) => ({
      label: cat, amountLabel: `${fmt(amt)} · ${pct(amt, p.tot.dep)} %`,
      pct: Math.max(1, Math.round((amt / maxDep) * 100)),
    })),
  };
}

function baseFacts(p: PeriodAgg, prefix = ""): Record<string, number> {
  const recette = recetteOf(p.tot);
  const netFinal = netFinalOf(p);
  const carb = p.depCat.get("Carburant") || 0;
  const f: Record<string, number> = {};
  const put = (k: string, v: number) => { f[`${prefix}${k}`] = Math.round(v); };
  put("recette_brute_fcfa", recette);
  put("brut_yango_fcfa", p.tot.brut);
  put("bonus_yango_fcfa", p.tot.bonus);
  put("hors_yango_fcfa", p.tot.hors);
  put("commissions_declarees_fcfa", p.tot.comm);
  put("depenses_fcfa", p.tot.dep);
  put("carburant_fcfa", carb);
  put("remuneration_versee_fcfa", p.tot.sal + p.tot.aco);
  put("dont_acomptes_fcfa", p.tot.aco);
  put("net_final_fcfa", netFinal);
  put("jours_travailles", p.tot.jours);
  put("repos_declares", p.tot.repos);
  put("courses_yango", p.tot.courses);
  put("rapports_en_attente", p.pending);
  f[`${prefix}marge_nette_pourcent`] = pct(netFinal, recette);
  f[`${prefix}carburant_pourcent_recette`] = pct(carb, recette);
  f[`${prefix}ponction_yango_pourcent_recette`] = pct(p.tot.comm, recette);
  f[`${prefix}hors_yango_pourcent_recette`] = pct(p.tot.hors, recette);
  return f;
}

/** Pseudonyme stable d'un chauffeur (aucun nom réel ne part vers le LLM). */
const pseudoOf = (a: DriverAgg) => `drv_${a.id.replace(/-/g, "").slice(0, 6)}`;

/** Carte pseudonyme → nom réel, réinjectée à l'affichage par le noyau. */
function aliasesOf(p: PeriodAgg): Record<string, string> {
  return Object.fromEntries(p.drivers.filter((a) => !a.technical).map((a) => [pseudoOf(a), a.name]));
}

function driverFacts(p: PeriodAgg): Record<string, string | number | null> {
  const f: Record<string, string | number | null> = {};
  for (const a of p.drivers) {
    if (a.technical) continue;
    const key = pseudoOf(a);
    const rec = recetteOf(a);
    f[`chauffeur_${key}_nom`] = a.name;
    f[`chauffeur_${key}_jours`] = a.jours;
    f[`chauffeur_${key}_repos`] = a.repos;
    f[`chauffeur_${key}_recette_fcfa`] = Math.round(rec);
    f[`chauffeur_${key}_net_final_fcfa`] = Math.round(a.net - a.dep - a.sal - a.aco);
    f[`chauffeur_${key}_panier_moyen_fcfa`] = a.courses > 0 ? Math.round(a.brut / a.courses) : null;
    f[`chauffeur_${key}_ca_par_jour_fcfa`] = a.jours > 0 ? Math.round(rec / a.jours) : null;
    f[`chauffeur_${key}_part_recette_pourcent`] = pct(rec, recetteOf(p.tot));
    f[`chauffeur_${key}_hors_yango_fcfa`] = Math.round(a.hors);
    f[`chauffeur_${key}_salaire_verse_fcfa`] = Math.round(a.sal);
    f[`chauffeur_${key}_acomptes_verses_fcfa`] = Math.round(a.aco);
    if (a.hire) f[`chauffeur_${key}_embauche_le`] = frFull(a.hire);
    if (a.end) f[`chauffeur_${key}_fin_contrat_le`] = frFull(a.end);
    const km = kmOf(a);
    if (km != null) {
      f[`chauffeur_${key}_km_periode`] = km;
      f[`chauffeur_${key}_km_par_jour`] = a.jours > 0 ? Math.round(km / a.jours) : null;
      if (a.carb > 0) f[`chauffeur_${key}_carburant_par_km_fcfa`] = Math.round((a.carb / km) * 10) / 10;
      f[`chauffeur_${key}_ca_par_km_fcfa`] = Math.round((rec / km) * 10) / 10;
    }
    if (a.carb > 0 && rec > 0) f[`chauffeur_${key}_carburant_pourcent_ca`] = pct(a.carb, rec);
  }
  return f;
}

function kmOf(a: DriverAgg): number | null {
  if (a.odo.size < 2) return null;
  const dates = Array.from(a.odo.keys()).sort();
  const km = a.odo.get(dates[dates.length - 1])! - a.odo.get(dates[0])!;
  return km > 0 ? km : null;
}

// ── datasets par type de rapport ────────────────────────────────────────────

const CONTEXT_COMMON = [
  "Flotte de véhicules opérée sur la plateforme Yango à Dakar (Sénégal). Monnaie : franc CFA (F).",
  "Le « hors-Yango » (courses privées hors plateforme) ne subit aucune commission : il part directement en marge.",
  "Rythme de repos visé : 1 repos déclaré par semaine et par chauffeur (protection de l'actif).",
  "La « ponction Yango » (commissions déclarées) est structurelle et stable : la marge se gagne sur le carburant, le panier moyen et le hors-app.",
  "Un chauffeur embauché en cours de mois peut bénéficier d'une période promo Yango : ses ratios ne sont pas comparables.",
  "Un siège (véhicule) sans chauffeur ne produit rien : l'effectif est historiquement le premier facteur limitant de la recette.",
];

async function monthlyDataset(tenantId: string, dateFrom: string, dateTo: string, tenantName: string): Promise<ReportDataset> {
  const prev = previousRange(dateFrom, dateTo);
  const [cur, before] = await Promise.all([
    aggregatePeriod(tenantId, dateFrom, dateTo),
    aggregatePeriod(tenantId, prev.dateFrom, prev.dateTo),
  ]);
  const recette = recetteOf(cur.tot);
  const netFinal = netFinalOf(cur);
  const det = monthlyDeterministic(cur, dateFrom, dateTo);
  const sections: Section[] = [driverTable(cur, dateFrom, dateTo)];
  const bars = depBars(cur);
  if (bars) sections.push(bars);
  const notable = notableExpensesTable(cur);
  if (notable) sections.push(notable);

  const facts: Record<string, string | number | null> = {
    ...baseFacts(cur),
    ...Object.fromEntries(Object.entries(baseFacts(before)).map(([k, v]) => [`mois_precedent_${k}`, v])),
    ...driverFacts(cur),
    periode_du: frFull(dateFrom), periode_au: frFull(dateTo),
    mois_precedent_du: frFull(prev.dateFrom), mois_precedent_au: frFull(prev.dateTo),
  };

  const activeDrivers = cur.drivers.filter((a) => !a.technical && a.jours > 0).length;
  return {
    meta: {
      docTitle: "Rapport d'activité mensuel",
      periodLabel: `Période : ${frFull(dateFrom)} → ${frFull(dateTo)} · Montants en FCFA`,
      generatedLabel: new Date().toLocaleDateString("fr-FR"),
      shortLabel: `${frFull(dateFrom)} → ${frFull(dateTo)}`,
      sourceLabel: `Source : ${tenantName} · M3A Fleet SaaS`,
    },
    kpis: [
      { label: "Recette brute", value: fmt(recette), sub: `Yango ${fmt(cur.tot.brut)} + bonus ${fmt(cur.tot.bonus)} + hors ${fmt(cur.tot.hors)}`, accent: true },
      { label: "Net final", value: fmt(netFinal), sub: recette > 0 ? `${pct(netFinal, recette)} % de la recette` : "—", accent: true },
      { label: "Dépenses", value: fmt(cur.tot.dep), sub: recette > 0 ? `${pct(cur.tot.dep, recette)} % de la recette` : "—" },
      { label: "Activité", value: `${fmt(cur.tot.courses)} courses`, sub: `${cur.tot.jours} jours travaillés${cur.tot.repos ? ` · ${cur.tot.repos} repos` : ""} · ${activeDrivers} chauffeur${activeDrivers > 1 ? "s" : ""}` },
    ],
    sections,
    facts,
    aliases: aliasesOf(cur),
    context: [
      ...CONTEXT_COMMON,
      "Les faits préfixés mois_precedent_ couvrent la période précédente de même durée : compare la dynamique (recette, marge, carburant, effectif).",
      "La table « Charges notables » donne le MOTIF saisi de chaque grosse ligne (décaissements propriétaire compris) : appuie l'analyse des dépenses dessus — un poste ne s'explique jamais par son seul total.",
    ],
    deterministicInsights: det.insights,
    deterministicDecisions: det.decisions,
    deterministicTldr: `<b>L'essentiel.</b> La période dégage <b>${fmt(netFinal)} F de net final</b> sur <b>${fmt(recette)} F de recette brute</b>${recette > 0 ? ` (marge nette ${pct(netFinal, recette)} %)` : ""}. ${fmt(cur.tot.courses)} courses Yango sur ${cur.tot.jours} jours travaillés${cur.tot.repos ? ` (+${cur.tot.repos} repos déclarés)` : ""}. Dépenses : ${fmt(cur.tot.dep)} F · Rémunération versée : ${fmt(cur.tot.sal + cur.tot.aco)} F${cur.tot.aco ? ` (dont ${fmt(cur.tot.aco)} F d'acomptes)` : ""}.`,
  };
}

async function ytdDataset(tenantId: string, dateTo: string, tenantName: string): Promise<ReportDataset> {
  const year = dateTo.slice(0, 4);
  const lastMonth = Number(dateTo.slice(5, 7));
  const months: { label: string; agg: PeriodAgg }[] = [];
  for (let m = 1; m <= lastMonth; m++) {
    const mm = String(m).padStart(2, "0");
    const from = `${year}-${mm}-01`;
    const to = m === lastMonth ? dateTo : `${year}-${mm}-${new Date(Date.UTC(Number(year), m, 0)).getUTCDate()}`;
    const agg = await aggregatePeriod(tenantId, from, to);
    // n'affiche que les mois avec au moins une écriture
    if (agg.tot.jours > 0 || agg.tot.dep > 0 || agg.tot.sal + agg.tot.aco > 0) {
      months.push({
        label: new Date(`${from}T00:00:00Z`).toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" }),
        agg,
      });
    }
  }
  const full = await aggregatePeriod(tenantId, `${year}-01-01`, dateTo);
  const recette = recetteOf(full.tot);
  const netFinal = netFinalOf(full);

  let cumul = 0;
  const monthRows: TableSection["rows"] = months.map(({ label, agg }) => {
    const net = netFinalOf(agg);
    cumul += net;
    const sign = (v: number) => (v >= 0 ? `+${fmt(v)}` : `−${fmt(Math.abs(v))}`);
    return {
      cells: [
        `<b>${esc(label.charAt(0).toUpperCase() + label.slice(1))}</b>`,
        fmt(recetteOf(agg.tot)), fmt(agg.tot.dep), fmt(agg.tot.sal + agg.tot.aco),
        sign(net), sign(cumul), String(agg.tot.jours), fmt(agg.tot.courses),
      ],
      highlight: net > 0 ? ("ok" as const) : net < 0 ? ("alert" as const) : undefined,
    };
  });
  monthRows.push({
    cells: ["TOTAL YTD", fmt(recette), fmt(full.tot.dep), fmt(full.tot.sal + full.tot.aco),
      netFinal >= 0 ? `+${fmt(netFinal)}` : `−${fmt(Math.abs(netFinal))}`, "", String(full.tot.jours), fmt(full.tot.courses)],
    total: true,
  });

  const facts: Record<string, string | number | null> = {
    ...baseFacts(full, "ytd_"),
    ...driverFacts(full),
    annee: year, periode_au: frFull(dateTo),
  };
  for (const { label, agg } of months) {
    const key = label.toLowerCase().replace(/[^a-z]/g, "");
    facts[`mois_${key}_recette_fcfa`] = Math.round(recetteOf(agg.tot));
    facts[`mois_${key}_net_final_fcfa`] = Math.round(netFinalOf(agg));
    facts[`mois_${key}_jours`] = agg.tot.jours;
  }

  const maxRec = Math.max(...months.map(({ agg }) => recetteOf(agg.tot)), 1);
  return {
    meta: {
      docTitle: `Bilan Year-to-Date ${year}`,
      periodLabel: `Période : 01/01/${year} → ${frFull(dateTo)} · Montants en FCFA`,
      generatedLabel: new Date().toLocaleDateString("fr-FR"),
      shortLabel: `Janvier → ${frFull(dateTo)}`,
      sourceLabel: `Source : ${tenantName} · M3A Fleet SaaS`,
    },
    kpis: [
      { label: "Recette brute YTD", value: fmt(recette), sub: `dont hors-app ${fmt(full.tot.hors)} F`, accent: true },
      { label: "Net final cumulé", value: `${netFinal >= 0 ? "+" : "−"}${fmt(Math.abs(netFinal))}`, sub: recette > 0 ? `${pct(netFinal, recette)} % de la recette` : "—", accent: true },
      { label: "Dépenses YTD", value: fmt(full.tot.dep), sub: `dont carburant ${fmt(full.depCat.get("Carburant") || 0)} F` },
      { label: "Activité YTD", value: `${fmt(full.tot.courses)} courses`, sub: `${full.tot.jours} jours travaillés` },
    ],
    sections: [
      {
        kind: "table",
        title: "Le film mois par mois",
        columns: [
          { label: "Mois" }, { label: "Recette brute", align: "right" }, { label: "Dépenses", align: "right" },
          { label: "Rému. versée", align: "right" }, { label: "Net final", align: "right" },
          { label: "Cumul", align: "right" }, { label: "Jours", align: "right" }, { label: "Courses", align: "right" },
        ],
        rows: monthRows,
        note: "Montants en FCFA. Seuls les mois avec au moins une écriture sont affichés. Net final = net après commissions − dépenses − rémunération versée (salaires + acomptes rattachés au mois).",
      },
      {
        kind: "bars",
        title: "Recette mensuelle",
        bars: months.map(({ label, agg }) => ({
          label: label.charAt(0).toUpperCase() + label.slice(1),
          amountLabel: fmt(recetteOf(agg.tot)),
          pct: Math.max(1, Math.round((recetteOf(agg.tot) / maxRec) * 100)),
        })),
      },
      driverTable(full, `${year}-01-01`, dateTo),
    ],
    facts,
    aliases: aliasesOf(full),
    context: [
      ...CONTEXT_COMMON,
      "Rapport année-à-date : dégage la trajectoire (point mort, tendance de marge), les leçons structurelles et les priorités du trimestre suivant — pas le détail d'un seul mois.",
    ],
    deterministicInsights: [
      { severity: netFinal >= 0 ? "ok" : "alert", html: `<b>Net final cumulé ${year} : ${netFinal >= 0 ? "+" : "−"}${fmt(Math.abs(netFinal))} F</b> sur ${fmt(recette)} F de recette (marge ${pct(netFinal, recette)} %).` },
      { severity: "info", html: `<b>Carburant cumulé : ${fmt(full.depCat.get("Carburant") || 0)} F</b> — ${pct(full.depCat.get("Carburant") || 0, recette)} % de la recette, poste de coût n°1.` },
    ],
    deterministicDecisions: [],
    deterministicTldr: `<b>L'essentiel.</b> Depuis janvier ${year}, la flotte cumule <b>${netFinal >= 0 ? "+" : "−"}${fmt(Math.abs(netFinal))} F de net final</b> sur <b>${fmt(recette)} F de recette brute</b> (marge ${pct(netFinal, recette)} %). ${fmt(full.tot.courses)} courses sur ${full.tot.jours} jours travaillés.`,
  };
}

const JOURS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

async function deepdiveDataset(tenantId: string, dateFrom: string, dateTo: string, tenantName: string): Promise<ReportDataset> {
  const p = await aggregatePeriod(tenantId, dateFrom, dateTo);

  // semaine type
  const byWd = new Map<number, { n: number; brut: number; courses: number; hors: number }>();
  const byWeek = new Map<string, { brut: number; bonus: number; hors: number; courses: number; drivers: Set<string> }>();
  for (const r of p.reportRows) {
    const d = new Date(`${r.date}T00:00:00Z`);
    const wd = (d.getUTCDay() + 6) % 7;
    const w = byWd.get(wd) ?? { n: 0, brut: 0, courses: 0, hors: 0 };
    w.n += 1; w.brut += r.brut; w.courses += r.courses; w.hors += r.hors;
    byWd.set(wd, w);
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week1Monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000);
    const weekNo = Math.floor((d.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
    const wk = `S${String(weekNo).padStart(2, "0")}`;
    const wv = byWeek.get(wk) ?? { brut: 0, bonus: 0, hors: 0, courses: 0, drivers: new Set<string>() };
    wv.brut += r.brut; wv.bonus += r.bonus; wv.hors += r.hors; wv.courses += r.courses; wv.drivers.add(r.driver_id);
    byWeek.set(wk, wv);
  }

  const wdRows = JOURS_FR.map((jour, i) => {
    const w = byWd.get(i);
    if (!w) return null;
    return {
      cells: [
        jour.charAt(0).toUpperCase() + jour.slice(1), String(w.n),
        fmt(w.brut / w.n), (w.courses / w.n).toFixed(1),
        w.courses > 0 ? fmt(w.brut / w.courses) : "—", fmt(w.hors / w.n),
      ],
    };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  const weekEntries = Array.from(byWeek.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const maxWeek = Math.max(...weekEntries.map(([, v]) => v.brut + v.bonus + v.hors), 1);

  // efficience chauffeurs
  const effRows = p.drivers.filter((a) => !a.technical && a.jours > 0).map((a) => {
    const rec = recetteOf(a);
    const km = kmOf(a);
    const num = (v: number | null, dec = 0) => (v == null ? "—" : dec ? v.toFixed(dec) : fmt(v));
    return {
      cells: [
        `<b>${esc(a.name)}</b>`, String(a.jours),
        fmt(rec / a.jours), (a.courses / a.jours).toFixed(1),
        num(km != null ? Math.round(km / a.jours) : null),
        num(km != null ? Math.round((rec / km) * 10) / 10 : null, 1),
        num(km != null && a.carb > 0 ? Math.round((a.carb / km) * 10) / 10 : null, 1),
        a.carb > 0 && rec > 0 ? `${pct(a.carb, rec)} %` : "—",
        a.brut > 0 ? `${pct(a.comm + a.svc, a.brut)} %` : "—",
        rec > 0 ? `${pct(a.hors, rec)} %` : "—",
      ],
    };
  });

  const facts: Record<string, string | number | null> = {
    ...baseFacts(p), ...driverFacts(p),
    periode_du: frFull(dateFrom), periode_au: frFull(dateTo),
  };
  for (const [i, jour] of JOURS_FR.entries()) {
    const w = byWd.get(i);
    if (!w) continue;
    facts[`jour_${jour}_ca_yango_moyen_fcfa`] = Math.round(w.brut / w.n);
    facts[`jour_${jour}_courses_par_rapport`] = Math.round((w.courses / w.n) * 10) / 10;
    facts[`jour_${jour}_hors_app_moyen_fcfa`] = Math.round(w.hors / w.n);
  }
  for (const [wk, v] of weekEntries) {
    facts[`semaine_${wk}_recette_totale_fcfa`] = Math.round(v.brut + v.bonus + v.hors);
    facts[`semaine_${wk}_chauffeurs`] = v.drivers.size;
  }

  return {
    meta: {
      docTitle: "Deep dive Opérations & Demande",
      periodLabel: `Période : ${frFull(dateFrom)} → ${frFull(dateTo)} · ${p.reportRows.length} rapports · Montants en FCFA`,
      generatedLabel: new Date().toLocaleDateString("fr-FR"),
      shortLabel: `${frFull(dateFrom)} → ${frFull(dateTo)}`,
      sourceLabel: `Source : ${tenantName} · M3A Fleet SaaS`,
    },
    kpis: [
      { label: "Recette brute", value: fmt(recetteOf(p.tot)), sub: `dont hors-app ${fmt(p.tot.hors)} F`, accent: true },
      { label: "Courses Yango", value: fmt(p.tot.courses), sub: `${p.tot.jours} jours travaillés`, accent: true },
      { label: "Panier moyen", value: p.tot.courses > 0 ? fmt(p.tot.brut / p.tot.courses) : "—", sub: "brut Yango / course" },
      { label: "Chauffeurs actifs", value: String(p.drivers.filter((a) => !a.technical && a.jours > 0).length), sub: `${p.tot.repos} repos déclarés` },
    ],
    sections: [
      {
        kind: "table",
        title: "1. La semaine type — où est la demande",
        columns: [
          { label: "Jour" }, { label: "Rapports", align: "right" }, { label: "CA Yango moyen", align: "right" },
          { label: "Courses / jour", align: "right" }, { label: "Panier moyen", align: "right" }, { label: "Hors-app moyen", align: "right" },
        ],
        rows: wdRows,
        note: "Moyennes par rapport chauffeur, hors repos. Avec peu d'observations par jour de semaine, un pattern peut n'être que du bruit : valider sur 2-3 mois avant d'en faire une règle.",
      },
      {
        kind: "bars",
        title: "2. Le film des semaines",
        bars: weekEntries.map(([wk, v]) => ({
          label: `${wk} · ${v.drivers.size} chauffeur${v.drivers.size > 1 ? "s" : ""}`,
          amountLabel: fmt(v.brut + v.bonus + v.hors),
          pct: Math.max(1, Math.round(((v.brut + v.bonus + v.hors) / maxWeek) * 100)),
          accent: v.drivers.size > 1,
        })),
        note: "Recette totale (Yango + bonus + hors-app) par semaine ISO. Les semaines en bord de période peuvent être tronquées.",
      },
      {
        kind: "table",
        title: "3. Efficience par chauffeur",
        columns: [
          { label: "Chauffeur" }, { label: "Jours", align: "right" }, { label: "CA / jour", align: "right" },
          { label: "Courses / j", align: "right" }, { label: "Km / jour", align: "right" }, { label: "CA / km", align: "right" },
          { label: "Carb. / km", align: "right" }, { label: "Carb. % CA", align: "right" },
          { label: "Ponction", align: "right" }, { label: "Hors-app", align: "right" },
        ],
        rows: effRows,
        note: "Km par delta d'odomètre entre le premier et le dernier rapport de la période. Ponction = (commissions + services) / brut Yango. Hors-app = part de la recette totale hors plateforme.",
      },
      ...(notableExpensesTable(p) ? [{ ...notableExpensesTable(p)!, title: "4. Charges commentées" } as Section] : []),
    ],
    facts,
    aliases: aliasesOf(p),
    context: [
      ...CONTEXT_COMMON,
      "Deep dive opérationnel : cherche les patterns de demande (jours forts/faibles, où placer les repos), le coût du siège vide (semaines à N chauffeurs), les écarts d'efficience carburant/km entre chauffeurs, et les anomalies de saisie (paniers aberrants).",
      "Les données ne contiennent ni heures en ligne, ni annulations, ni note conducteur : la qualité de service n'est pas mesurable — ne pas l'inventer.",
    ],
    deterministicInsights: [
      { severity: "info", html: "<b>Lecture des tables.</b> La semaine type situe les jours forts et faibles de la demande (où placer repos et entretiens) ; le film des semaines montre l'effet direct du nombre de chauffeurs actifs sur la recette ; l'efficience par chauffeur compare rendement kilométrique et coût carburant." },
    ],
    deterministicDecisions: [],
    deterministicTldr: `<b>L'essentiel.</b> ${p.reportRows.length} rapports analysés du ${frFull(dateFrom)} au ${frFull(dateTo)} : ${fmt(recetteOf(p.tot))} F de recette totale, ${fmt(p.tot.courses)} courses Yango.`,
  };
}

/** Point d'entrée de l'adaptateur. */
export async function buildFleetDataset(
  tenantId: string, dateFrom: string, dateTo: string, kind: FleetReportKind
): Promise<{ dataset: ReportDataset; tenantName: string }> {
  const { data: tenant } = await admin.from("tenants").select("name").eq("id", tenantId).single();
  const tenantName = tenant?.name || "M3A Fleet";
  const dataset =
    kind === "ytd" ? await ytdDataset(tenantId, dateTo, tenantName)
    : kind === "deepdive" ? await deepdiveDataset(tenantId, dateFrom, dateTo, tenantName)
    : await monthlyDataset(tenantId, dateFrom, dateTo, tenantName);
  return { dataset, tenantName };
}
