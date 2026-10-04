/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
import { createClient } from "@supabase/supabase-js";
import type { Decision, Insight, Kpi, ReportDataset, Section, TableSection } from "@/lib/report-agent/types";
import { CAT_AVANCE } from "@/lib/expenseCategories";
import { amortissementPeriode, kmParMoisDepuisCompteur } from "@/lib/calc";
import { performanceBlock, type PerformanceBlock } from "./performance";
import { demandeHoraire, echeances } from "./extras";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { avanceBlock, type AvanceBlock } from "./avance";
import { columnsChart } from "@/lib/report-agent/charts";
import { segmentResolver, type SegmentFilter, type VehicleLite } from "@/lib/analytics/segment";
import { segmentDe } from "@/lib/fleetSegment";

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
  /** Avances propriétaire remises (Décaissement propriétaire) — hors charges, cash sorti. */
  avances: number;
  /** Lignes de charge brutes (motifs saisis) — matière du deep dive dépenses. */
  expenseRows: { date: string; driver_id: string | null; category: string; amount: number; description: string }[];
  pending: number;
  reportRows: { date: string; driver_id: string; brut: number; bonus: number; hors: number; courses: number }[];
  /** Usure des véhicules sur la période. Sans elle le rapport annonce un net embelli. */
  amortissement: number;
  /** Nombre de véhicules par segment (tout le parc, quel que soit le filtre). */
  segCounts: { interne: number; partenaire: number };
}

async function aggregatePeriod(tenantId: string, dateFrom: string, dateTo: string, segment: SegmentFilter = "all"): Promise<PeriodAgg> {
  // Lecture COMPLÈTE (fetchAllRows) : PostgREST coupe chaque réponse à 1000 lignes sans
  // erreur. Sur une année, une flotte dépasse 1000 journées : le bilan année-à-date
  // sortait donc avec une recette et un net final tronqués (constaté sur NMK le 04/10/2026).
  const all = <T,>(build: () => unknown) => fetchAllRows<T>(build).then((data) => ({ data }));
  const [{ data: profiles }, repsQ, expsQ, paysQ, vehsQ, odoQ] = await Promise.all([
    admin.from("profiles").select("id, driver_id, full_name, account_type, hire_date, contract_end_date")
      .eq("tenant_id", tenantId),
    all<any>(() => admin.from("daily_reports")
      .select("date,driver_id,vehicle_id,yango_gross,yango_bonus,off_yango_revenue,commission_amount,service_supplementaire,net_after_expenses,yango_trip_count,end_odometer,status,comment")
      .eq("tenant_id", tenantId)
      .gte("date", dateFrom).lte("date", dateTo).order("date").order("id")),
    all<any>(() => admin.from("expenses").select("driver_id,category,amount,expense_date,description")
      .eq("tenant_id", tenantId).gte("expense_date", dateFrom).lte("expense_date", dateTo).order("expense_date").order("id")),
    all<any>(() => admin.from("payments").select("driver_id,amount,payment_date,salary_month,type")
      .eq("tenant_id", tenantId).order("payment_date").order("id")),
    admin.from("vehicles")
      .select("id,driver_id,plate,mileage,fleet_segment,prix_acquisition,valeur_residuelle,date_acquisition,amort_plafond_km,amort_duree_max_mois,amort_porte_par")
      .eq("tenant_id", tenantId),
    // Relevés de compteur sur tout l'historique : le rythme d'usure se mesure
    // sur la durée, pas sur le seul mois rapporté.
    all<any>(() => admin.from("daily_reports").select("vehicle_id,date,end_odometer")
      .eq("tenant_id", tenantId).not("vehicle_id", "is", null)
      .not("end_odometer", "is", null).gt("end_odometer", 0)
      .in("status", ["approved", "submitted"]).order("date").order("id")),
  ]);

  const isRepos = (r: { comment?: string | null }) => String(r.comment || "").startsWith("[REPOS]");
  // Segment (flotte interne / véhicules partenaires) : même résolution que le menu
  // Performance — véhicule de la déclaration, sinon véhicule affecté au chauffeur.
  // Une ligne sans chauffeur (dépense de structure) est rattachée à la flotte interne.
  const seg = segmentResolver((vehsQ.data || []) as VehicleLite[]);
  const inSegReport = (r: { vehicle_id?: string | null; driver_id?: string | null }) => segment === "all" || seg.ofReport(r) === segment;
  const inSegDriver = (driverId?: string | null) => segment === "all" || seg.ofDriver(driverId) === segment;
  const allReports = (repsQ.data || []).filter(inSegReport);
  const reposReports = allReports.filter(isRepos);
  const reports = allReports.filter((r) => !isRepos(r));
  // « Décaissement propriétaire » = avance remise à un chauffeur : neutre pour
  // les charges du rapport (la charge réelle est déclarée ensuite par le
  // chauffeur — anti double comptage, cf. lib/expenseCategories CAT_AVANCE).
  // Les lignes restent dans expenseRows (deep dive) : le motif saisi garde sa valeur.
  const allExpenses = (expsQ.data || []).filter((e) => inSegDriver(e.driver_id));
  const expenses = allExpenses.filter((e) => e.category !== CAT_AVANCE);
  const avances = allExpenses.filter((e) => e.category === CAT_AVANCE)
    .reduce((s, e) => s + (e.amount || 0), 0);
  const salaryDate = (p: { salary_month?: string | null; payment_date?: string | null }) =>
    (p.salary_month ? String(p.salary_month).slice(0, 10) : p.payment_date) || "";
  const payments = (paysQ.data || []).filter((p) => {
    const d = salaryDate(p);
    return d >= dateFrom && d <= dateTo && inSegDriver(p.driver_id);
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

  const relevesVeh = new Map<string, Array<{ date: string; end_odometer: number | null }>>();
  for (const r of (odoQ.data || []) as any[]) {
    if (!r.vehicle_id) continue;
    (relevesVeh.get(r.vehicle_id) ?? relevesVeh.set(r.vehicle_id, []).get(r.vehicle_id)!)
      .push({ date: r.date, end_odometer: r.end_odometer });
  }
  const amortissement = Math.round(((vehsQ.data || []) as any[]).filter((v) => segment === "all" || segmentDe(v) === segment).reduce((total, v) => total + amortissementPeriode({
    vehicule: {
      prixAcquisition: v.prix_acquisition, valeurResiduelle: v.valeur_residuelle,
      dateAcquisition: v.date_acquisition, compteurActuel: v.mileage,
      plafondKm: v.amort_plafond_km, dureeMaxMois: v.amort_duree_max_mois,
      porteePar: v.amort_porte_par, segment: v.fleet_segment,
    },
    fromISO: dateFrom, toISO: dateTo,
    kmParMois: kmParMoisDepuisCompteur(relevesVeh.get(v.id) || []),
  }).montant, 0));

  return {
    segCounts: seg.counts(),
    drivers, tot, depCat, avances, amortissement,
    expenseRows: allExpenses.map((e) => ({
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
// Amortissement compris : un rapport mensuel qui annonce un net dont l'usure
// des véhicules est absente présente une rentabilité que l'exploitant n'a pas.
const netFinalOf = (p: PeriodAgg) => p.tot.net - p.tot.dep - (p.tot.sal + p.tot.aco) - p.amortissement;

function previousRange(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } {
  const from = new Date(`${dateFrom}T00:00:00Z`);
  const days = Math.round((new Date(`${dateTo}T00:00:00Z`).getTime() - from.getTime()) / 86400000) + 1;
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(from.getTime() - days * 86400000);
  return { dateFrom: prevFrom.toISOString().slice(0, 10), dateTo: prevTo.toISOString().slice(0, 10) };
}

// ── règles déterministes du rapport mensuel (repli sans LLM) ────────────────

/** Lecture « Performance » : un échec de lecture ne doit jamais empêcher le rapport de sortir. */
async function perfOf(tenantId: string, dateFrom: string, dateTo: string, segment: SegmentFilter = "all"): Promise<PerformanceBlock | null> {
  try {
    return await performanceBlock(admin, tenantId, dateFrom, dateTo, segment);
  } catch (e) {
    console.error("[report] lecture performance indisponible:", e instanceof Error ? e.message : e);
    return null;
  }
}

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
  put("amortissement_fcfa", p.amortissement);
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

// ── rapport de direction : comparaison, compte de résultat, évolution ───────

const MOIS_FR = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const JOURS_SEMAINE = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const moisLabel = (d: string) => `${MOIS_FR[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** La période couvre-t-elle exactement un mois civil ? */
function isFullMonth(dateFrom: string, dateTo: string): boolean {
  const f = new Date(`${dateFrom}T00:00:00Z`), t = new Date(`${dateTo}T00:00:00Z`);
  const lastDay = new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)).getUTCDate();
  return f.getUTCDate() === 1 && f.getUTCMonth() === t.getUTCMonth() && f.getUTCFullYear() === t.getUTCFullYear() && t.getUTCDate() === lastDay;
}

/** Période de comparaison : le mois civil précédent pour un mois entier, sinon la même durée juste avant. */
function comparisonRange(dateFrom: string, dateTo: string): { dateFrom: string; dateTo: string } {
  if (!isFullMonth(dateFrom, dateTo)) return previousRange(dateFrom, dateTo);
  const f = new Date(`${dateFrom}T00:00:00Z`);
  return {
    dateFrom: iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - 1, 1))),
    dateTo: iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), 0))),
  };
}

/** Les n mois civils qui précèdent le mois de `dateFrom`, du plus ancien au plus récent. */
function monthsBefore(dateFrom: string, n: number): { dateFrom: string; dateTo: string }[] {
  const f = new Date(`${dateFrom}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const k = n - i;
    return {
      dateFrom: iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - k, 1))),
      dateTo: iso(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() - k + 1, 0))),
    };
  });
}

/** Variation en % (null si la base est nulle). */
const varPct = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${String(Math.abs(v)).replace(".", ",")}`;
/** Cellule de variation : verte si le sens est favorable (recette en hausse, charge en baisse). */
function varCell(cur: number, prev: number, hausseFavorable = true): string {
  const v = varPct(cur, prev);
  if (v == null) return "—";
  if (v === 0) return "0 %";
  const bon = hausseFavorable ? v > 0 : v < 0;
  return `<span class="${bon ? "pos" : "neg"}">${signed(v)} %</span>`;
}
const deltaOf = (cur: number, prev: number, label: string, hausseFavorable = true): Kpi["delta"] => {
  const v = varPct(cur, prev);
  if (v == null) return undefined;
  return { label: `${signed(v)} % vs ${label}`, tone: v === 0 ? "flat" : (hausseFavorable ? v > 0 : v < 0) ? "good" : "bad" };
};

const SEG_LABEL: Record<SegmentFilter, string> = { all: "toute la flotte", interne: "flotte interne", partenaire: "véhicules partenaires" };
/** Mention du périmètre dans le titre et la période (vide quand le rapport couvre toute la flotte). */
const segSuffix = (segment: SegmentFilter) => (segment === "all" ? "" : ` · ${SEG_LABEL[segment]}`);
const segContext = (segment: SegmentFilter): string[] => (segment === "all" ? [] : [
  `Périmètre du rapport : ${SEG_LABEL[segment]} UNIQUEMENT (${segment === "interne" ? "les véhicules de l'entreprise" : "les véhicules confiés par des propriétaires partenaires"}). Tous les chiffres sont limités à ce périmètre : ne parle jamais de « la flotte » comme d'un tout, écris « ${SEG_LABEL[segment]} ».`,
]);

/**
 * Flotte interne face aux véhicules partenaires : la même lecture, côte à côte.
 * Affichée dans le rapport « toute la flotte » quand le parc est mixte.
 */
async function segregation(tenantId: string, dateFrom: string, dateTo: string, total: PeriodAgg): Promise<{
  section: Section; facts: Record<string, string | number | null>; insights: Insight[]; context: string[];
} | null> {
  if (total.segCounts.interne === 0 || total.segCounts.partenaire === 0) return null;
  const [int, par] = await Promise.all([
    aggregatePeriod(tenantId, dateFrom, dateTo, "interne"),
    aggregatePeriod(tenantId, dateFrom, dateTo, "partenaire"),
  ]);
  if (int.tot.jours === 0 || par.tot.jours === 0) return null;
  const cols = [int, par, total];
  const actifs = (p: PeriodAgg) => p.drivers.filter((a) => !a.technical && a.jours > 0).length;
  const caJour = (p: PeriodAgg) => (p.tot.jours > 0 ? recetteOf(p.tot) / p.tot.jours : 0);
  const marge = (p: PeriodAgg) => (recetteOf(p.tot) > 0 ? pct(netFinalOf(p), recetteOf(p.tot)) : 0);
  const pc = (v: number) => `${String(v).replace(".", ",")} %`;
  const row = (label: string, f: (p: PeriodAgg) => string, o: { total?: boolean } = {}) => ({ cells: [o.total ? label : `<b>${esc(label)}</b>`, ...cols.map(f)], total: o.total });
  const recTot = recetteOf(total.tot);
  const section: Section = {
    kind: "table",
    title: "Flotte interne et véhicules partenaires",
    columns: [{ label: "Indicateur" }, { label: "Flotte interne", align: "right" }, { label: "Partenaires", align: "right" }, { label: "Total", align: "right" }],
    rows: [
      row("Véhicules au parc", (p) => (p === total ? String(total.segCounts.interne + total.segCounts.partenaire) : String(p === int ? total.segCounts.interne : total.segCounts.partenaire))),
      row("Chauffeurs actifs", (p) => String(actifs(p))),
      row("Jours travaillés", (p) => String(p.tot.jours)),
      row("Recette brute", (p) => fmt(recetteOf(p.tot))),
      row("Part de la recette", (p) => (recTot > 0 ? pc(pct(recetteOf(p.tot), recTot)) : "—")),
      row("CA par jour travaillé", (p) => fmt(caJour(p))),
      row("Courses", (p) => fmt(p.tot.courses)),
      row("Commissions et services", (p) => `−${fmt(p.tot.comm)}`),
      row("Net après commissions", (p) => fmt(p.tot.net)),
      row("Dépenses", (p) => `−${fmt(p.tot.dep)}`),
      row("Rémunération versée", (p) => (p.tot.sal + p.tot.aco > 0 ? `−${fmt(p.tot.sal + p.tot.aco)}` : "0")),
      ...(total.amortissement ? [row("Amortissement des véhicules", (p) => (p.amortissement > 0 ? `−${fmt(p.amortissement)}` : "0"))] : []),
      row("NET FINAL", (p) => fmt(netFinalOf(p)), { total: true }),
      row("Marge nette", (p) => (recetteOf(p.tot) > 0 ? pc(marge(p)) : "—")),
    ],
    note: "Flotte interne = véhicules de l'entreprise ; partenaires = véhicules confiés par des propriétaires tiers. Une journée est rattachée au véhicule déclaré, sinon au véhicule affecté au chauffeur ; une dépense ou une rémunération suit le chauffeur. Les dépenses sans chauffeur sont rattachées à la flotte interne. Le même rapport peut être généré pour un seul des deux périmètres.",
  };
  const facts: Record<string, string | number | null> = {};
  for (const [k, p] of [["flotte_interne", int], ["partenaires", par]] as const) {
    facts[`${k}_recette_fcfa`] = Math.round(recetteOf(p.tot));
    facts[`${k}_part_recette_pourcent`] = recTot > 0 ? pct(recetteOf(p.tot), recTot) : null;
    facts[`${k}_jours_travailles`] = p.tot.jours;
    facts[`${k}_chauffeurs_actifs`] = actifs(p);
    facts[`${k}_ca_par_jour_fcfa`] = Math.round(caJour(p));
    facts[`${k}_net_final_fcfa`] = Math.round(netFinalOf(p));
    facts[`${k}_marge_nette_pourcent`] = marge(p);
    facts[`${k}_depenses_fcfa`] = Math.round(p.tot.dep);
  }
  const ecart = caJour(int) - caJour(par);
  return {
    section, facts,
    insights: [{
      severity: "info",
      html: `<b>Flotte interne : ${fmt(recetteOf(int.tot))} F (${pc(pct(recetteOf(int.tot), recTot))} de la recette) ; partenaires : ${fmt(recetteOf(par.tot))} F.</b> CA par jour travaillé : ${fmt(caJour(int))} F en interne contre ${fmt(caJour(par))} F chez les partenaires${Math.abs(ecart) >= 1000 ? `, soit ${fmt(Math.abs(ecart))} F d'écart en faveur ${ecart > 0 ? "de la flotte interne" : "des partenaires"}` : ""}. Net final : ${fmt(netFinalOf(int))} F et ${fmt(netFinalOf(par))} F.`,
    }],
    context: ["Le parc est mixte : les faits flotte_interne_ et partenaires_ donnent les deux périmètres séparément. Distingue-les dans l'analyse : la flotte interne est l'actif de l'entreprise, les véhicules partenaires appartiennent à des tiers. Une conclusion vraie pour l'un peut être fausse pour l'autre."],
  };
}

/** Priorité de repli : le plus gros gisement chiffré de la lecture Performance. */
function focusOf(perf: PerformanceBlock | null): string | undefined {
  if (!perf) return undefined;
  const refus = Number(perf.facts.performance_ca_non_realise_sur_refus_estime_fcfa ?? 0);
  const jours = Number(perf.facts.levier_jours_sans_activite_valeur_a_l_objectif_fcfa ?? 0);
  const objectif = Number(perf.facts.performance_objectif_ca_par_jour_fcfa ?? 0);
  const leviers: [number, string][] = [
    [perf.manqueAGagner, `<b>Tenir l'objectif de ${fmt(objectif)} F par jour.</b> Le manque à gagner estimé est de ${fmt(perf.manqueAGagner)} F : suivre le CA par jour de chaque chauffeur chaque semaine, pas en fin de mois.`],
    [refus, `<b>Faire baisser les refus de course.</b> Environ ${fmt(refus)} F non réalisés (estimation) : fixer un taux d'acceptation minimum et le suivre chaque semaine.`],
    [jours, `<b>Faire rouler les véhicules tous les jours ouvrés.</b> ${fmt(Number(perf.facts.levier_jours_sans_activite_total ?? 0))} jours sans activité ni repos déclaré, soit ${fmt(jours)} F à l'objectif : organiser les remplacements.`],
  ];
  const best = leviers.sort((a, b) => b[0] - a[0])[0];
  // un levier marginal ne fait pas une priorité de direction
  return best[0] >= 100_000 ? best[1] : undefined;
}

/** Compte de résultat de la flotte, face à la période de comparaison. */
function compteResultat(cur: PeriodAgg, prev: PeriodAgg, prevLabel: string): Section {
  const rec = recetteOf(cur.tot), recP = recetteOf(prev.tot);
  const remu = cur.tot.sal + cur.tot.aco, remuP = prev.tot.sal + prev.tot.aco;
  const net = netFinalOf(cur), netP = netFinalOf(prev);
  const part = (v: number) => (rec > 0 ? `${String(pct(v, rec)).replace(".", ",")} %` : "—");
  const line = (label: string, c: number, p: number, o: { sub?: boolean; moins?: boolean; total?: boolean; favorable?: boolean } = {}) => ({
    cells: [
      o.sub ? `<span style="padding-left:16px;color:var(--ink2)">${esc(label)}</span>` : o.total ? esc(label) : `<b>${esc(label)}</b>`,
      `${o.moins && c > 0 ? "−" : ""}${fmt(c)}`, part(c),
      `${o.moins && p > 0 ? "−" : ""}${fmt(p)}`, varCell(c, p, o.favorable ?? !o.moins),
    ],
    total: o.total,
  });
  const cats = Array.from(cur.depCat.entries()).sort((a, b) => b[1] - a[1]);
  const top = cats.slice(0, 5);
  const autres = cats.slice(5).reduce((s, [, v]) => s + v, 0);
  const autresP = Array.from(prev.depCat.entries()).filter(([c]) => !top.some(([t]) => t === c)).reduce((s, [, v]) => s + v, 0);
  return {
    kind: "table",
    title: "Compte de résultat de la flotte",
    columns: [
      { label: "Poste" }, { label: "Période", align: "right" }, { label: "% recette", align: "right" },
      { label: prevLabel, align: "right" }, { label: "Variation", align: "right" },
    ],
    rows: [
      line("Recette brute", rec, recP),
      line("dont Yango", cur.tot.brut, prev.tot.brut, { sub: true }),
      ...(cur.tot.bonus || prev.tot.bonus ? [line("dont bonus Yango", cur.tot.bonus, prev.tot.bonus, { sub: true })] : []),
      ...(cur.tot.hors || prev.tot.hors ? [line("dont hors Yango (sans commission)", cur.tot.hors, prev.tot.hors, { sub: true })] : []),
      line("Commissions et services plateforme", cur.tot.comm, prev.tot.comm, { moins: true }),
      line("Net après commissions", cur.tot.net, prev.tot.net),
      line("Dépenses d'exploitation", cur.tot.dep, prev.tot.dep, { moins: true }),
      ...top.map(([c, v]) => line(c, v, prev.depCat.get(c) || 0, { sub: true, moins: true })),
      ...(autres > 0 ? [line("Autres postes", autres, autresP, { sub: true, moins: true })] : []),
      line("Rémunération versée", remu, remuP, { moins: true }),
      ...(cur.amortissement || prev.amortissement ? [line("Amortissement des véhicules", cur.amortissement, prev.amortissement, { moins: true })] : []),
      line("NET FINAL", net, netP, { total: true, favorable: true }),
    ],
    note: `Montants en FCFA. Net final = net après commissions − dépenses − rémunération versée − amortissement. Variation en vert quand elle est favorable (recette en hausse, charge en baisse).${cur.avances > 0 ? ` Les avances remises aux chauffeurs (${fmt(cur.avances)} F) ne sont pas des charges : elles ne figurent pas ici.` : ""}`,
  };
}

/** Évolution mensuelle en image : recette et net final, même échelle. */
function evolutionFigure(points: { label: string; agg: PeriodAgg; courant?: boolean }[]): Section | null {
  const rows = points.filter((p) => p.agg.tot.jours > 0 || p.courant);
  if (rows.length < 2) return null;
  const k = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".", ",")} M` : `${Math.round(v / 1000)} k`);
  return {
    kind: "figure",
    title: "Évolution · recette brute et net final",
    svg: columnsChart({
      label: "Recette brute et net final par mois",
      categories: rows.map((p) => p.label),
      series: [
        { name: "Recette brute", values: rows.map((p) => recetteOf(p.agg.tot)) },
        { name: "Net final", values: rows.map((p) => Math.max(0, netFinalOf(p.agg))) },
      ],
      fmt: k, highlight: rows.length - 1,
    }),
    data: { mois: rows.map((p) => `${p.label} : recette ${Math.round(recetteOf(p.agg.tot))} F, net final ${Math.round(netFinalOf(p.agg))} F`) },
    note: `Montants en FCFA, même échelle pour les deux séries.${rows.some((p) => netFinalOf(p.agg) < 0) ? " Un net final négatif est représenté à zéro : voir le tableau pour le montant." : ""}`,
  };
}

/** Analyses avancées : un échec de lecture ne doit jamais empêcher le rapport de sortir. */
async function avanceOf(tenantId: string, dateFrom: string, dateTo: string, segment: SegmentFilter): Promise<AvanceBlock | null> {
  try {
    return await avanceBlock(admin, tenantId, dateFrom, dateTo, segment);
  } catch (e) {
    console.error("[report] analyses avancées indisponibles:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Semaine type : recette moyenne d'une journée de chauffeur, par jour de la semaine. */
function semaineType(p: PeriodAgg): Section | null {
  if (p.reportRows.length < 14) return null;
  const acc = JOURS_SEMAINE.map((label) => ({ label, n: 0, ca: 0, courses: 0 }));
  for (const r of p.reportRows) {
    const wd = (new Date(`${r.date}T00:00:00Z`).getUTCDay() + 6) % 7;
    acc[wd].n += 1; acc[wd].ca += r.brut + r.bonus + r.hors; acc[wd].courses += r.courses;
  }
  const moy = acc.map((a) => (a.n > 0 ? a.ca / a.n : 0));
  const max = Math.max(...moy, 1);
  const best = moy.indexOf(Math.max(...moy));
  return {
    kind: "bars",
    title: "Demande · la semaine type",
    bars: acc.map((a, i) => ({
      label: a.label,
      amountLabel: a.n > 0 ? `${fmt(moy[i])} F · ${a.n} journées` : "—",
      pct: Math.max(1, Math.round((moy[i] / max) * 100)),
      accent: i === best,
    })),
    note: "Recette moyenne d'une journée de chauffeur (Yango + bonus + hors Yango), par jour de la semaine, hors repos. Le jour le plus fort est en doré : c'est celui où un véhicule à l'arrêt coûte le plus.",
  };
}

// ════════════════════════════════════════════════════════════════════════════
// TROIS RAPPORTS, TROIS RÔLES (Decision Engine : un rôle = un périmètre = un livrable)
//
//  • Rapport de direction mensuel  — rôle « Reporting Manager », pour le dirigeant.
//    Lisible en cinq minutes : l'essentiel, les indicateurs face au mois précédent et
//    à l'objectif, les preuves, ce qui va bien, ce qui va moins bien, les décisions à
//    arbitrer (options), la priorité. Aucune redite du détail opérationnel.
//  • Deep dive opérationnel        — rôle « Responsable d'exploitation ».
//    Le terrain : activité, chauffeurs, demande, organisation du travail, qualité de
//    service, véhicules ; puis les alertes et un plan d'action (qui, quand, gain).
//    Pas de compte de résultat.
//  • Bilan financier année-à-date  — rôle « FP&A ».
//    Résultat cumulé, indicateurs clés et point mort, projection de fin d'année en
//    trois scénarios, tests de sensibilité ; puis les recommandations.
//
// Ordre de lecture commun : la synthèse, les faits, le jugement, puis seulement les
// décisions — on ne demande pas d'arbitrer avant d'avoir montré.
// ════════════════════════════════════════════════════════════════════════════

/** Section avec sa phrase « à retenir » (rien si la phrase est vide). */
const withLead = (s: Section | null | undefined, lead?: string | null): Section | null => (!s ? null : lead ? { ...s, lead } : s);
const pick = (list: Section[] | undefined, re: RegExp): Section | null => (list ?? []).find((s) => re.test(s.title)) ?? null;
const numbered = (list: (Section | null | undefined)[]): Section[] =>
  list.filter((s): s is Section => !!s).map((s, i) => ({ ...s, title: `${i + 1}. ${s.title.replace(/^\d+\.\s*/, "")}` }));
const pc = (v: number) => `${String(v).replace(".", ",")} %`;
const DESTINATAIRE = "Chaque constat porte un chiffre des données et sa conséquence ; pas de généralités, pas de redite d'une rubrique à l'autre.";

const ROLES_DIRECTION = [
  { id: "contrôle financier", system: "Tu es le contrôleur financier de la flotte. Ton périmètre : le compte de résultat de la période (recette, commissions, dépenses par poste, rémunération, amortissement, net final, marge) et ses écarts face à la période précédente et aux mois antérieurs. Explique d'où vient chaque écart significatif et signale toute anomalie de charge. Tu ne commentes ni les chauffeurs un par un ni l'organisation du travail." },
  { id: "performance", system: "Tu es le responsable de la performance commerciale. Ton périmètre : la tenue de l'objectif de CA par jour, le manque à gagner, la contribution de chaque chauffeur et de chaque périmètre (flotte interne, véhicules partenaires), les courses refusées. Tu ne commentes pas les charges." },
  { id: "risques", system: "Tu es le responsable risques et conformité. Ton périmètre : la dépendance à un chauffeur ou à un périmètre, les documents expirés et les échéances, les repos non pris, les véhicules immobilisés, les données manquantes ou en attente qui faussent les chiffres. Tu ne proposes pas d'action commerciale." },
];
const EDITOR_DIRECTION = `Tu es le Reporting Manager : tu rédiges le tableau de bord de direction, lu par le dirigeant en cinq minutes. On te fournit les données JSON et les constats de trois rôles (contrôle financier, performance, risques). Tu les synthétises sans les recopier : aucune redite, le détail opérationnel vit dans un autre rapport. ${DESTINATAIRE}
Sortie EXACTE :
{"tldr":"3 phrases maximum : le verdict du mois, le chiffre qui l'explique, le point de vigilance",
"va_bien":[{"title":"titre court","body":"le fait chiffré, puis ce qu'il faut en conserver"}],
"va_moins_bien":[{"severity":"warn|alert","title":"titre court","body":"le fait chiffré, puis ce qu'il coûte"}],
"decisions":[{"title":"la décision à prendre","urgence":"7 jours | ce mois-ci | structure","option_a":"action concrète, impact attendu chiffré, coût ou risque","option_b":"alternative, impact, risque","recommandation":"l'option retenue et la raison, en une phrase"}],
"focus":"la priorité unique du mois prochain, en 2 phrases",
"donnees_manquantes":["donnée absente qui limite l'analyse"]}
- va_bien : 3 points maximum. va_moins_bien : 3 points maximum, factuels, du plus coûteux au moins coûteux.
- decisions : 3 maximum, classées par urgence ; toujours deux options comparées et une recommandation tranchée.
- L'impact d'une option se chiffre UNIQUEMENT avec un montant présent dans les données (faits « levier_ », « manque_a_gagner », « estime ») ; écris « estimation » quand c'en est une. Sans montant disponible, décris l'impact sans chiffre.
- focus : une seule priorité, celle qui rapporte le plus.
- donnees_manquantes : liste vide si rien ne manque ; ne jamais inventer.`;

const ROLES_OPERATIONS = [
  { id: "demande", system: "Tu es l'analyste de la demande. Ton périmètre : quand la flotte gagne son chiffre — recette jour par jour, meilleurs jours de la semaine, créneaux horaires forts et creux, semaines fortes et faibles. Tu dis quand les véhicules doivent rouler et quand placer ce qui les immobilise. Tu ne commentes pas les chauffeurs individuellement." },
  { id: "chauffeurs", system: "Tu es le responsable des chauffeurs. Ton périmètre : la performance de chaque chauffeur face à l'objectif journalier, sa régularité (journées à l'objectif, meilleure et plus faible journée), sa qualité de service (acceptation, refus) et son rendement à l'heure. Tu distingues un problème de capacité d'un problème de constance ou d'assiduité." },
  { id: "organisation", system: "Tu es le responsable de l'organisation du travail. Ton périmètre : les jours de repos (conseillé, réellement pris), les horaires de travail et l'amplitude, les jours sans activité, l'utilisation et l'efficience des véhicules, les échéances de documents. Tu proposes des changements de planning concrets." },
];
const EDITOR_OPERATIONS = `Tu es le responsable d'exploitation : tu rédiges le rapport opérationnel de la période, celui que l'exploitation utilise pour organiser le travail des semaines suivantes. On te fournit les données JSON et les constats de trois rôles (demande, chauffeurs, organisation). C'est un rapport de terrain : tu ne parles ni de marge ni de résultat net. ${DESTINATAIRE}
Sortie EXACTE :
{"synthese":"5 phrases maximum : ce que la période dit de l'exploitation, les deux ou trois faits qui commandent le planning des semaines suivantes",
"alertes":[{"severity":"warn|alert","title":"titre court","body":"le fait chiffré et le chauffeur, le véhicule ou le créneau concerné"}],
"points_forts":[{"title":"titre court","body":"ce qui fonctionne et doit être généralisé"}],
"actions":[{"action":"ce qui doit être fait, concrètement","responsable":"exploitation | le chauffeur concerné (sa référence) | direction","echeance":"cette semaine | sous 15 jours | ce mois-ci","gain_attendu":"montant présent dans les données, suivi de « estimation », ou « non chiffré »"}],
"donnees_manquantes":["donnée absente qui limite l'analyse"]}
- alertes : 5 maximum, des plus coûteuses aux moins coûteuses. points_forts : 3 maximum.
- actions : 6 maximum, la plus rentable d'abord. Une action désigne un chauffeur, un jour, un créneau ou un véhicule précis : « déplacer le repos de tel chauffeur au mercredi », jamais « améliorer la performance ».
- gain_attendu : uniquement un montant présent dans les données (faits « gain_mensuel_estime », « manque_a_gagner », « levier_ », « ca_non_realise ») ; sinon « non chiffré ».
- donnees_manquantes : liste vide si rien ne manque ; ne jamais inventer.`;

const ROLES_FINANCE = [
  { id: "contrôle financier", system: "Tu es le contrôleur financier. Ton périmètre : le résultat cumulé depuis janvier et le film mois par mois (recette, dépenses, rémunération, amortissement, net final), les mois bénéficiaires et déficitaires, les postes de charge qui dérivent. Tu ne fais pas de projection." },
  { id: "FP&A", system: "Tu es le responsable FP&A. Ton périmètre : la trajectoire — point mort, marge de sécurité, projection de fin d'année selon les trois scénarios fournis, tests de sensibilité. Tu t'appuies sur les scénarios déjà calculés dans les données, tu n'en inventes pas, et tu rappelles qu'il s'agit de projections." },
  { id: "risques de structure", system: "Tu es le responsable des risques de structure. Ton périmètre : la concentration de la recette sur un chauffeur ou un périmètre, la dépendance à la plateforme, le poids des charges fixes, la fragilité du modèle si l'effectif ou la demande baisse. Tu ne commentes pas un mois isolé." },
];
const EDITOR_FINANCE = `Tu es le FP&A Manager : tu rédiges le bilan financier année-à-date, lu par le dirigeant et les associés pour juger la trajectoire et décider de la suite de l'année. On te fournit les données JSON et les constats de trois rôles (contrôle financier, FP&A, risques de structure). Tu juges la trajectoire, pas un mois isolé. ${DESTINATAIRE}
Sortie EXACTE :
{"synthese":"5 phrases maximum : où en est l'année, la tendance, ce que donne la projection, le principal risque",
"points_forts":[{"title":"titre court","body":"le fait chiffré"}],
"alertes":[{"severity":"warn|alert","title":"titre court","body":"le fait chiffré et ce qu'il coûte à l'année"}],
"recommandations":[{"title":"la recommandation, formulée comme une action","body":"ce qu'il faut faire, avec quel effet chiffré attendu"}],
"donnees_manquantes":["donnée absente ou limite de l'analyse"]}
- points_forts et alertes : 3 maximum chacun.
- recommandations : 4 maximum, actionnables (« porter tel chauffeur à l'objectif », jamais « augmenter la recette »), la plus rentable d'abord.
- Toute projection ou tout effet de sensibilité cité doit être un montant présent dans les données (faits « projection_ », « sensibilite_ », « point_mort_ ») et présenté comme une projection.
- donnees_manquantes : liste vide si rien ne manque ; ne jamais inventer.`;

/** Limites de l'analyse constatées dans les données : ce que le rapport ne peut pas dire. */
function manquesOf(p: PeriodAgg, extra: { datesNonRenseignees?: number; fleetroom?: boolean } = {}): string[] {
  const out: string[] = [];
  const recette = recetteOf(p.tot);
  if (recette > 0 && p.tot.sal + p.tot.aco === 0) out.push("Aucune rémunération versée n'est enregistrée sur la période : si les salaires n'ont pas été saisis, le net final est surestimé d'autant.");
  if (recette > 0 && !(p.depCat.get("Carburant") || 0)) out.push("Aucune dépense de carburant n'est saisie : le coût au kilomètre et la marge réelle par véhicule ne sont pas mesurables.");
  if (recette > 0 && p.amortissement === 0) out.push("Le prix d'acquisition des véhicules n'est pas renseigné : l'usure des véhicules n'entre pas dans le net final.");
  if (p.pending > 0) out.push(`${p.pending} rapport(s) en attente de validation ne sont pas comptés.`);
  if (extra.datesNonRenseignees) out.push(`${extra.datesNonRenseignees} date(s) d'assurance ou de visite technique ne sont pas renseignées : aucune alerte d'échéance ne peut partir.`);
  if (extra.fleetroom === false) out.push("Pas d'export Yango (Fleetroom) : refus, taux d'acceptation, heures de travail et créneaux horaires ne sont pas mesurés.");
  return out;
}

// ── 1. RAPPORT DE DIRECTION MENSUEL ─────────────────────────────────────────

async function monthlyDataset(tenantId: string, dateFrom: string, dateTo: string, tenantName: string, segment: SegmentFilter = "all"): Promise<ReportDataset> {
  const prev = comparisonRange(dateFrom, dateTo);
  const fullMonth = isFullMonth(dateFrom, dateTo);
  const prevLabel = fullMonth ? moisLabel(prev.dateFrom) : "période précédente";
  const history = monthsBefore(dateFrom, 5);
  const today = new Date().toISOString().slice(0, 10);
  const safe = async <T,>(what: string, run: () => Promise<T | null>): Promise<T | null> => {
    try { return await run(); } catch (e) { console.error(`[report] ${what} indisponible:`, e instanceof Error ? e.message : e); return null; }
  };
  const [cur, hist, beforeOther, perf, ech] = await Promise.all([
    aggregatePeriod(tenantId, dateFrom, dateTo, segment),
    Promise.all(history.map((m) => aggregatePeriod(tenantId, m.dateFrom, m.dateTo, segment))),
    fullMonth ? Promise.resolve(null) : aggregatePeriod(tenantId, prev.dateFrom, prev.dateTo, segment),
    perfOf(tenantId, dateFrom, dateTo, segment),
    safe("échéances", () => echeances(admin, tenantId, today, segment)),
  ]);
  const [segs, av] = await Promise.all([
    segment === "all" ? safe("ségrégation", () => segregation(tenantId, dateFrom, dateTo, cur)) : Promise.resolve(null),
    avanceOf(tenantId, dateFrom, dateTo, segment),
  ]);
  const before = beforeOther ?? hist[hist.length - 1];

  const recette = recetteOf(cur.tot), recetteP = recetteOf(before.tot);
  const netFinal = netFinalOf(cur), netFinalP = netFinalOf(before);
  const marge = recette > 0 ? pct(netFinal, recette) : 0;
  const margeP = recetteP > 0 ? pct(netFinalP, recetteP) : 0;
  const caJour = cur.tot.jours > 0 ? recette / cur.tot.jours : 0;
  const caJourP = before.tot.jours > 0 ? recetteP / before.tot.jours : 0;
  const vRec = varPct(recette, recetteP), vNet = varPct(netFinal, netFinalP);
  const det = monthlyDeterministic(cur, dateFrom, dateTo);
  const objectif = perf?.objectif ?? 0;
  const atteints = perf ? perf.chauffeurs.filter((c) => c.statut === "atteint").length : 0;
  const refus = Number(perf?.facts.performance_courses_refusees ?? 0);
  const okJ = Number(av?.facts.regularite_journees_a_l_objectif ?? 0), totJ = Number(av?.facts.regularite_journees_travaillees ?? 0);

  // tableau de bord : valeur, face au mois précédent, face à l'objectif
  const ecartPts = Math.round((marge - margeP) * 10) / 10;
  const tagObj = (ok: boolean, proche: boolean, txt: string) => `<span class="tag ${ok ? "green" : proche ? "amber" : "red"}">${txt}</span>`;
  const kpiRows: { cells: string[]; total?: boolean }[] = [
    { cells: ["<b>Recette brute</b>", fmt(recette), varCell(recette, recetteP), "—"] },
    { cells: ["<b>Net final</b>", fmt(netFinal), varCell(netFinal, netFinalP), "—"] },
    { cells: ["<b>Marge nette</b>", recette > 0 ? pc(marge) : "—", recetteP > 0 ? `<span class="${ecartPts >= 0 ? "pos" : "neg"}">${signed(ecartPts)} pt</span>` : "—", "—"] },
    { cells: ["<b>CA par jour travaillé</b>", fmt(caJour), varCell(caJour, caJourP),
      objectif > 0 ? `${tagObj(caJour >= objectif, caJour >= objectif * 0.8, `${Math.round((caJour / objectif) * 100)} %`)} de ${fmt(objectif)}` : "—"] },
    ...(perf ? [{ cells: ["<b>Chauffeurs à l'objectif</b>", `${atteints} sur ${perf.chauffeurs.length}`, "—",
      tagObj(atteints === perf.chauffeurs.length, atteints * 2 >= perf.chauffeurs.length, atteints === perf.chauffeurs.length ? "tenu par tous" : `${perf.chauffeurs.length - atteints} en dessous`)] }] : []),
    ...(totJ > 0 ? [{ cells: ["<b>Journées à l'objectif</b>", `${okJ} sur ${totJ}`, "—", tagObj(okJ / totJ >= 0.8, okJ / totJ >= 0.5, `${Math.round((okJ / totJ) * 100)} %`)] }] : []),
    { cells: ["<b>Jours travaillés</b>", String(cur.tot.jours), varCell(cur.tot.jours, before.tot.jours), "—"] },
    { cells: ["<b>Courses</b>", fmt(cur.tot.courses), varCell(cur.tot.courses, before.tot.courses), "—"] },
    { cells: ["<b>Dépenses</b>", `${fmt(cur.tot.dep)}${recette > 0 ? ` · ${pc(pct(cur.tot.dep, recette))} de la recette` : ""}`, varCell(cur.tot.dep, before.tot.dep, false), "—"] },
    ...(refus > 0 ? [{ cells: ["<b>Courses refusées</b>", fmt(refus), "—", "—"] }] : []),
  ];
  const tableauDeBord: Section = {
    kind: "table",
    title: "Indicateurs du mois",
    columns: [{ label: "Indicateur" }, { label: "Valeur", align: "right" }, { label: `vs ${prevLabel}`, align: "right" }, { label: "vs objectif" }],
    rows: kpiRows,
    note: "Variation en vert quand elle est favorable (recette en hausse, charge en baisse). « pt » = point de marge. Les indicateurs sans objectif fixé portent un tiret.",
  };

  const points = [
    ...history.map((m, i) => ({ label: moisLabel(m.dateFrom), agg: hist[i] })),
    { label: moisLabel(dateFrom), agg: cur, courant: true },
  ];
  const evolutionFig = fullMonth ? evolutionFigure(points) : null;
  const vivants = points.filter((x) => x.agg.tot.jours > 0);
  const meilleur = vivants.length ? vivants.reduce((a, b) => (recetteOf(b.agg.tot) > recetteOf(a.agg.tot) ? b : a)) : null;
  const perfFig = pick(perf?.sections, /face à l'objectif/);

  const sections = numbered([
    tableauDeBord,
    withLead(compteResultat(cur, before, prevLabel),
      vRec != null ? `Recette <b>${signed(vRec)} %</b> et net final <b>${vNet == null ? "non comparable" : `${signed(vNet)} %`}</b> face à ${esc(prevLabel)} ; marge nette ${pc(margeP)} → <b>${pc(marge)}</b>.` : null),
    withLead(evolutionFig as Section, meilleur ? `${vivants.length} mois d'historique ; le meilleur est ${esc(meilleur.label)} (${fmt(recetteOf(meilleur.agg.tot))} F de recette).` : null),
    segs ? withLead(segs.section, `La flotte interne fait <b>${pc(Number(segs.facts.flotte_interne_part_recette_pourcent ?? 0))}</b> de la recette, à ${fmt(Number(segs.facts.flotte_interne_ca_par_jour_fcfa ?? 0))} F par jour contre ${fmt(Number(segs.facts.partenaires_ca_par_jour_fcfa ?? 0))} F chez les partenaires.`) : null,
    perfFig && perf ? withLead(perfFig, `<b>${atteints} chauffeur${atteints > 1 ? "s" : ""} sur ${perf.chauffeurs.length}</b> tien${atteints > 1 ? "nent" : "t"} l'objectif de ${fmt(objectif)} F par jour${perf.manqueAGagner > 0 ? ` ; manque à gagner estimé : <b>${fmt(perf.manqueAGagner)} F</b>` : ""}.`) : null,
  ]);

  const facts: Record<string, string | number | null> = {
    ...baseFacts(cur),
    ...Object.fromEntries(Object.entries(baseFacts(before)).map(([k, v]) => [`mois_precedent_${k}`, v])),
    ...driverFacts(cur),
    ...(perf?.facts ?? {}), ...(ech?.facts ?? {}), ...(segs?.facts ?? {}), ...(av?.facts ?? {}),
    perimetre: SEG_LABEL[segment],
    periode_du: frFull(dateFrom), periode_au: frFull(dateTo),
    mois_precedent_du: frFull(prev.dateFrom), mois_precedent_au: frFull(prev.dateTo),
    ca_par_jour_flotte_fcfa: Math.round(caJour),
    mois_precedent_ca_par_jour_flotte_fcfa: Math.round(caJourP),
    marge_nette_pourcent: marge, mois_precedent_marge_nette_pourcent: margeP,
    variation_recette_pourcent: vRec, variation_net_final_pourcent: vNet,
    variation_ca_par_jour_pourcent: varPct(caJour, caJourP),
    variation_depenses_pourcent: varPct(cur.tot.dep, before.tot.dep),
    variation_courses_pourcent: varPct(cur.tot.courses, before.tot.courses),
    variation_jours_travailles_pourcent: varPct(cur.tot.jours, before.tot.jours),
  };
  history.forEach((m, i) => {
    if (hist[i].tot.jours === 0) return;
    const k = `evolution_${m.dateFrom.slice(0, 7).replace("-", "_")}`;
    facts[`${k}_recette_fcfa`] = Math.round(recetteOf(hist[i].tot));
    facts[`${k}_net_final_fcfa`] = Math.round(netFinalOf(hist[i]));
    facts[`${k}_jours_travailles`] = hist[i].tot.jours;
  });

  // repli déterministe : la dynamique, puis la performance, puis les risques
  const dyn: Insight[] = [];
  if (vRec != null) {
    const memeSens = vNet == null || (vRec >= 0) === (vNet >= 0);
    dyn.push({
      severity: (vNet != null && vNet < 0) || vRec < 0 ? "warn" : "ok",
      html: `<b>Recette ${signed(vRec)} % et net final ${vNet == null ? "non comparable" : `${signed(vNet)} %`} face à ${esc(prevLabel)}.</b> Recette ${fmt(recetteP)} → ${fmt(recette)} F, net final ${fmt(netFinalP)} → ${fmt(netFinal)} F, marge nette ${pc(margeP)} → ${pc(marge)}.`
        + (memeSens ? "" : ` La recette et le résultat ne vont pas dans le même sens : l'écart vient des charges (${fmt(before.tot.dep)} → ${fmt(cur.tot.dep)} F de dépenses).`)
        + ` La flotte a travaillé ${cur.tot.jours} jours contre ${before.tot.jours}, à ${fmt(caJour)} F par jour contre ${fmt(caJourP)} F.`,
    });
  }
  const decisions: Decision[] = [];
  if (perf && perf.manqueAGagner > 0) decisions.push({ html: `<b>Ramener chaque chauffeur à l'objectif journalier.</b> Manque à gagner estimé : ${fmt(perf.manqueAGagner)} F. Option A : un point hebdomadaire chiffré avec chaque chauffeur sous l'objectif. Option B : remplacer les chauffeurs durablement sous 80 % de l'objectif.` });
  if (av && av.repos.length) decisions.push({ html: `<b>Fixer les jours de repos sur les jours faibles.</b> Environ ${fmt(Number(av.facts.repos_gain_mensuel_estime_si_repos_bien_places_fcfa ?? 0))} F par mois (estimation) sans un jour de travail en plus. Détail par chauffeur dans le deep dive opérationnel.` });
  if (refus > 0) decisions.push({ html: `<b>Fixer une règle sur les refus de course.</b> ${fmt(refus)} courses refusées, environ ${fmt(Number(perf?.facts.performance_ca_non_realise_sur_refus_estime_fcfa ?? 0))} F non réalisés (estimation).` });
  decisions.push(...det.decisions);

  const activeDrivers = cur.drivers.filter((a) => !a.technical && a.jours > 0).length;
  return {
    meta: {
      docTitle: `Rapport de direction mensuel${segSuffix(segment)}`,
      periodLabel: `Période : ${frFull(dateFrom)} → ${frFull(dateTo)}${segSuffix(segment)} · Montants en FCFA`,
      generatedLabel: new Date().toLocaleDateString("fr-FR"),
      shortLabel: `${frFull(dateFrom)} → ${frFull(dateTo)}`,
      sourceLabel: `Source : ${tenantName} · M3A Fleet SaaS`,
    },
    kpis: [
      { label: "Recette brute", value: fmt(recette), sub: `Yango ${fmt(cur.tot.brut)} · bonus ${fmt(cur.tot.bonus)} · hors ${fmt(cur.tot.hors)}`, accent: true, delta: deltaOf(recette, recetteP, prevLabel) },
      { label: "Net final", value: fmt(netFinal), sub: recette > 0 ? `${pc(marge)} de marge nette` : "—", accent: true, delta: deltaOf(netFinal, netFinalP, prevLabel) },
      { label: "CA par jour travaillé", value: fmt(caJour), sub: `${cur.tot.jours} jours · ${activeDrivers} chauffeur${activeDrivers > 1 ? "s" : ""}`, delta: deltaOf(caJour, caJourP, prevLabel) },
      ...(perf ? [perf.kpi] : [{ label: "Courses", value: fmt(cur.tot.courses), delta: deltaOf(cur.tot.courses, before.tot.courses, prevLabel) }]),
    ],
    sections,
    facts,
    aliases: aliasesOf(cur),
    context: [
      ...CONTEXT_COMMON,
      ...segContext(segment), ...(segs?.context ?? []), ...(perf?.context ?? []), ...(av?.context ?? []),
      `Les faits préfixés mois_precedent_ couvrent ${prevLabel} ; les faits variation_ donnent l'évolution en pourcentage déjà calculée (ne recalcule rien). Les faits evolution_AAAA_MM donnent les mois antérieurs : dégage la tendance de fond, pas seulement l'écart d'un mois.`,
      ...(cur.avances > 0 ? [`Les « Décaissement propriétaire » sont des AVANCES remises aux chauffeurs (${fmt(cur.avances)} F sur la période) : cash sorti mais NEUTRE pour le résultat. Ne jamais les compter comme des dépenses.`] : []),
    ],
    deterministicInsights: [...dyn, ...(perf?.insights ?? []).slice(0, 2), ...(av?.insights ?? []).filter((i) => i.severity !== "info").slice(0, 1), ...(ech?.insights ?? []), ...det.insights],
    deterministicDecisions: decisions.slice(0, 3),
    deterministicFocus: focusOf(perf),
    deterministicManques: manquesOf(cur, { datesNonRenseignees: Number(ech?.facts.echeances_dates_non_renseignees ?? 0), fleetroom: perf ? perf.hasFleetroom : undefined }),
    deterministicTldr: `<b>L'essentiel.</b> ${fmt(recette)} F de recette brute${vRec != null ? ` (${signed(vRec)} % face à ${esc(prevLabel)})` : ""} et <b>${fmt(netFinal)} F de net final</b>${recette > 0 ? `, soit ${pc(marge)} de marge nette` : ""}. La flotte a travaillé ${cur.tot.jours} jours à ${fmt(caJour)} F par jour.${perf ? ` <b>${atteints} chauffeur${atteints > 1 ? "s" : ""} sur ${perf.chauffeurs.length} tien${atteints > 1 ? "nent" : "t"} l'objectif journalier</b>${perf.manqueAGagner > 0 ? ` : le manque à gagner est estimé à ${fmt(perf.manqueAGagner)} F` : ""}.` : ""}`,
    profile: {
      roles: ROLES_DIRECTION,
      editorSystem: EDITOR_DIRECTION,
      decisionStyle: "options",
      caps: { forces: 3, alertes: 3, info: 0, decisions: 3 },
      labels: { tldr: "L'essentiel en 30 secondes", forces: "Ce qui va bien", alertes: "Ce qui va moins bien", decisions: "Décisions à prendre ce mois-ci", focus: "Focus du mois prochain", manques: "Données manquantes" },
      layout: [
        "tldr", "kpis", { sections: sections.map((_, i) => i) },
        "forces", "alertes", "decisions", "focus", "manques",
        { heading: "Pour aller plus loin", text: "Le détail du terrain (chauffeurs, demande, repos, horaires, qualité de service) est dans le deep dive opérationnel. La trajectoire de l'année et les scénarios sont dans le bilan financier année-à-date." },
      ],
    },
  };
}

// ── 2. BILAN FINANCIER ANNÉE-À-DATE ─────────────────────────────────────────

async function ytdDataset(tenantId: string, dateTo: string, tenantName: string, segment: SegmentFilter = "all"): Promise<ReportDataset> {
  const year = dateTo.slice(0, 4);
  const lastMonth = Number(dateTo.slice(5, 7));
  const yearStart = `${year}-01-01`;
  const ranges = Array.from({ length: lastMonth }, (_, i) => {
    const mm = String(i + 1).padStart(2, "0");
    const from = `${year}-${mm}-01`;
    const end = `${year}-${mm}-${new Date(Date.UTC(Number(year), i + 1, 0)).getUTCDate()}`;
    return { from, to: i + 1 === lastMonth ? dateTo : end, complet: i + 1 < lastMonth || dateTo === end };
  });
  const [aggs, full, perf, ech] = await Promise.all([
    Promise.all(ranges.map((r) => aggregatePeriod(tenantId, r.from, r.to, segment))),
    aggregatePeriod(tenantId, yearStart, dateTo, segment),
    perfOf(tenantId, yearStart, dateTo, segment),
    echeances(admin, tenantId, new Date().toISOString().slice(0, 10), segment).catch(() => null),
  ]);
  const segs = segment === "all" ? await segregation(tenantId, yearStart, dateTo, full).catch(() => null) : null;
  // n'affiche que les mois avec au moins une écriture
  const months = ranges.map((r, i) => ({ ...r, agg: aggs[i], label: moisLabel(r.from) }))
    .filter(({ agg }) => agg.tot.jours > 0 || agg.tot.dep > 0 || agg.tot.sal + agg.tot.aco > 0);
  const recette = recetteOf(full.tot), netFinal = netFinalOf(full);
  const marge = recette > 0 ? pct(netFinal, recette) : 0;
  const sgn = (v: number) => (v >= 0 ? `+${fmt(v)}` : `−${fmt(Math.abs(v))}`);

  // film mois par mois
  let cumul = 0;
  const monthRows: TableSection["rows"] = months.map(({ label, agg }) => {
    const net = netFinalOf(agg), rec = recetteOf(agg.tot);
    cumul += net;
    return {
      cells: [`<b>${esc(label)}</b>`, fmt(rec), fmt(agg.tot.dep), fmt(agg.tot.sal + agg.tot.aco), sgn(net), rec > 0 ? pc(pct(net, rec)) : "—", sgn(cumul), String(agg.tot.jours)],
      highlight: net > 0 ? ("ok" as const) : net < 0 ? ("alert" as const) : undefined,
    };
  });
  monthRows.push({ cells: ["CUMUL", fmt(recette), fmt(full.tot.dep), fmt(full.tot.sal + full.tot.aco), sgn(netFinal), recette > 0 ? pc(marge) : "—", "", String(full.tot.jours)], total: true });
  const film: Section = {
    kind: "table", title: "Résultat mois par mois",
    columns: [{ label: "Mois" }, { label: "Recette brute", align: "right" }, { label: "Dépenses", align: "right" }, { label: "Rému. versée", align: "right" },
      { label: "Net final", align: "right" }, { label: "Marge", align: "right" }, { label: "Cumul", align: "right" }, { label: "Jours", align: "right" }],
    rows: monthRows,
    note: "Montants en FCFA. Seuls les mois avec au moins une écriture sont affichés. Net final = net après commissions − dépenses − rémunération versée − amortissement. Vert : mois bénéficiaire ; rouge : mois déficitaire.",
  };
  const filmFig = evolutionFigure(months.map(({ label, agg }, i) => ({ label, agg, courant: i === months.length - 1 })));

  // ── trajectoire : rythme récent, point mort, scénarios (mois complets seulement)
  const complets = months.filter((m) => m.complet && m.agg.tot.jours > 0);
  const recents = complets.slice(-6);
  const moy = (list: typeof complets, f: (p: PeriodAgg) => number) => (list.length ? list.reduce((s, m) => s + f(m.agg), 0) / list.length : 0);
  const parRecette = [...recents].sort((a, b) => recetteOf(a.agg.tot) - recetteOf(b.agg.tot));
  const scenarios = recents.length >= 3 ? [
    { nom: "Pessimiste", hyp: `moyenne des 2 mois les plus faibles (${parRecette.slice(0, 2).map((m) => m.label).join(", ")})`, mois: parRecette.slice(0, 2) },
    { nom: "Réaliste", hyp: `moyenne des 3 derniers mois (${recents.slice(-3).map((m) => m.label).join(", ")})`, mois: recents.slice(-3) },
    { nom: "Optimiste", hyp: `moyenne des 2 meilleurs mois (${parRecette.slice(-2).map((m) => m.label).join(", ")})`, mois: parRecette.slice(-2) },
  ].map((s) => ({ ...s, rec: moy(s.mois, (p) => recetteOf(p.tot)), net: moy(s.mois, netFinalOf) })) : [];
  const dernierComplet = complets.length ? Number(complets[complets.length - 1].from.slice(5, 7)) : lastMonth;
  const restants = 12 - dernierComplet;
  const baseRec = complets.reduce((s, m) => s + recetteOf(m.agg.tot), 0), baseNet = complets.reduce((s, m) => s + netFinalOf(m.agg), 0);
  const realiste = scenarios[1];

  const facts: Record<string, string | number | null> = {
    ...baseFacts(full, "ytd_"), ...driverFacts(full), ...(perf?.facts ?? {}), ...(ech?.facts ?? {}), ...(segs?.facts ?? {}),
    perimetre: SEG_LABEL[segment], annee: year, periode_au: frFull(dateTo),
    ytd_marge_nette_pourcent: marge,
    mois_beneficiaires: months.filter((m) => netFinalOf(m.agg) > 0).length, mois_avec_activite: months.length,
  };
  for (const { from, agg } of months) {
    const k = `mois_${from.slice(0, 7).replace("-", "_")}`;
    facts[`${k}_recette_fcfa`] = Math.round(recetteOf(agg.tot));
    facts[`${k}_net_final_fcfa`] = Math.round(netFinalOf(agg));
    facts[`${k}_jours`] = agg.tot.jours;
  }

  // indicateurs clés et point mort
  const base3 = recents.slice(-3);
  const charges = moy(base3, (p) => p.tot.dep + p.tot.sal + p.tot.aco + p.amortissement);
  const tauxApresComm = moy(base3, (p) => recetteOf(p.tot)) > 0 ? moy(base3, (p) => p.tot.net) / moy(base3, (p) => recetteOf(p.tot)) : 0;
  const pointMort = tauxApresComm > 0 ? charges / tauxApresComm : 0;
  const caJour = full.tot.jours > 0 ? recette / full.tot.jours : 0;
  const securite = realiste && realiste.rec > 0 && pointMort > 0 ? Math.round(((realiste.rec - pointMort) / realiste.rec) * 1000) / 10 : null;
  const best = months.length ? months.reduce((a, b) => (netFinalOf(b.agg) > netFinalOf(a.agg) ? b : a)) : null;
  const worst = months.length ? months.reduce((a, b) => (netFinalOf(b.agg) < netFinalOf(a.agg) ? b : a)) : null;
  const indicateurs: Section | null = base3.length ? {
    kind: "table", title: "Indicateurs clés et point mort",
    columns: [{ label: "Indicateur" }, { label: "Valeur", align: "right" }, { label: "Lecture" }],
    rows: [
      { cells: ["<b>Marge nette cumulée</b>", recette > 0 ? pc(marge) : "—", "net final ÷ recette brute, depuis janvier"] },
      { cells: ["<b>Mois bénéficiaires</b>", `${months.filter((m) => netFinalOf(m.agg) > 0).length} sur ${months.length}`, best && worst ? `meilleur : ${esc(best.label)} (${sgn(netFinalOf(best.agg))}) ; plus faible : ${esc(worst.label)} (${sgn(netFinalOf(worst.agg))})` : ""] },
      { cells: ["<b>Charges mensuelles moyennes</b>", fmt(charges), "dépenses + rémunération + amortissement, moyenne des 3 derniers mois complets"] },
      { cells: ["<b>Point mort mensuel</b>", pointMort > 0 ? fmt(pointMort) : "—", "recette brute à réaliser dans le mois pour couvrir ces charges, après commissions"] },
      ...(pointMort > 0 && caJour > 0 ? [{ cells: ["<b>Point mort en journées</b>", fmt(pointMort / caJour), `journées de chauffeur à ${fmt(caJour)} F (CA par jour moyen de l'année)`] }] : []),
      ...(securite != null ? [{ cells: ["<b>Marge de sécurité</b>", `<span class="${securite >= 0 ? "pos" : "neg"}">${pc(securite)}</span>`, "baisse de recette que le rythme actuel peut absorber avant de passer en perte"] }] : []),
    ],
    note: "Point mort (estimation) = charges mensuelles moyennes ÷ part de la recette qui reste après commissions. Il suppose des charges stables : une embauche ou un véhicule de plus le déplace.",
  } : null;
  facts.point_mort_recette_mensuelle_estime_fcfa = pointMort > 0 ? Math.round(pointMort) : null;
  facts.point_mort_charges_mensuelles_moyennes_fcfa = Math.round(charges);
  facts.point_mort_marge_de_securite_pourcent = securite;

  // projection de fin d'année
  const projection: Section | null = scenarios.length && restants > 0 ? {
    kind: "table", title: `Projection de fin d'année ${year} — 3 scénarios`,
    columns: [{ label: "Scénario" }, { label: "Recette / mois", align: "right" }, { label: "Net final / mois", align: "right" },
      { label: `Recette ${year}`, align: "right" }, { label: `Net final ${year}`, align: "right" }],
    rows: scenarios.map((s) => ({
      cells: [`<b>${s.nom}</b>`, fmt(s.rec), sgn(s.net), fmt(baseRec + s.rec * restants), `<b>${sgn(baseNet + s.net * restants)}</b>`],
      total: s.nom === "Réaliste",
    })),
    note: `Hypothèses : ${scenarios.map((s) => `${s.nom.toLowerCase()} = ${s.hyp}`).join(" ; ")}. Projection = réalisé sur les mois complets (${fmt(baseRec)} F de recette, ${sgn(baseNet)} F de net final) + rythme du scénario × ${restants} mois restants. Ce sont des ordres de grandeur, pas des prévisions : ${recents.length} mois d'historique seulement.`,
  } : null;
  for (const s of scenarios) {
    const k = `projection_${s.nom.toLowerCase().replace("é", "e")}`;
    facts[`${k}_recette_mensuelle_fcfa`] = Math.round(s.rec);
    facts[`${k}_net_final_mensuel_fcfa`] = Math.round(s.net);
    if (restants > 0) {
      facts[`${k}_recette_fin_d_annee_fcfa`] = Math.round(baseRec + s.rec * restants);
      facts[`${k}_net_final_fin_d_annee_fcfa`] = Math.round(baseNet + s.net * restants);
    }
  }
  facts.projection_mois_restants = restants;

  // sensibilité : trois chocs sur le rythme réaliste
  let sensibilite: Section | null = null;
  if (realiste) {
    const actifs = full.drivers.filter((a) => !a.technical && a.jours > 0).sort((a, b) => recetteOf(b) - recetteOf(a));
    const top = actifs[0];
    const partTop = top && recette > 0 ? recetteOf(top) / recette : 0;
    const nMois = Math.max(complets.length, 1);
    const tests = [
      top ? { nom: `Départ de ${top.name}, non remplacé`, hyp: `premier contributeur : ${pc(pct(recetteOf(top), recette))} de la recette de l'année`, effet: -realiste.rec * partTop * tauxApresComm } : null,
      perf && perf.manqueAGagner > 0 ? { nom: "Tous les chauffeurs à l'objectif journalier", hyp: `manque à gagner de l'année : ${fmt(perf.manqueAGagner)} F, soit ${fmt(perf.manqueAGagner / nMois)} F par mois`, effet: (perf.manqueAGagner / nMois) * tauxApresComm } : null,
      { nom: "Dépenses en hausse de 20 %", hyp: `dépenses moyennes : ${fmt(moy(base3, (p) => p.tot.dep))} F par mois`, effet: -0.2 * moy(base3, (p) => p.tot.dep) },
    ].filter((t): t is { nom: string; hyp: string; effet: number } => !!t);
    sensibilite = {
      kind: "table", title: "Sensibilité — trois chocs sur le rythme réaliste",
      columns: [{ label: "Test" }, { label: "Hypothèse" }, { label: "Effet sur le net mensuel", align: "right" }, { label: restants > 0 ? `Net final ${year}` : "Net mensuel après choc", align: "right" }],
      rows: tests.map((t) => ({
        cells: [`<b>${esc(t.nom)}</b>`, esc(t.hyp), `<span class="${t.effet >= 0 ? "pos" : "neg"}">${sgn(t.effet)}</span>`,
          restants > 0 ? sgn(baseNet + (realiste.net + t.effet) * restants) : sgn(realiste.net + t.effet)],
      })),
      note: `Estimations. Point de départ : scénario réaliste (${sgn(realiste.net)} F de net final par mois${restants > 0 ? `, ${sgn(baseNet + realiste.net * restants)} F sur l'année` : ""}). L'effet d'une variation de recette est compté après commissions ; les charges sont supposées inchangées.`,
    };
    tests.forEach((t, i) => {
      facts[`sensibilite_${i + 1}_test`] = t.nom;
      facts[`sensibilite_${i + 1}_effet_net_mensuel_estime_fcfa`] = Math.round(t.effet);
      if (restants > 0) facts[`sensibilite_${i + 1}_net_final_fin_d_annee_estime_fcfa`] = Math.round(baseNet + (realiste.net + t.effet) * restants);
    });
  }

  const pl = months.length >= 2 ? compteResultat(full, months[months.length - 1].agg, months[months.length - 1].label) : null;
  const plCumul: Section | null = pl && pl.kind === "table" ? {
    ...pl, title: "Compte de résultat cumulé",
    columns: [{ label: "Poste" }, { label: `Cumul ${year}`, align: "right" }, { label: "% recette", align: "right" }],
    rows: pl.rows.map((r) => ({ ...r, cells: r.cells.slice(0, 3) })),
    note: "Montants en FCFA, du 1er janvier à la date du bilan. Net final = net après commissions − dépenses − rémunération versée − amortissement.",
  } : null;

  const sections = numbered([
    withLead(plCumul as Section, `<b>${sgn(netFinal)} F de net final</b> sur ${fmt(recette)} F de recette, soit ${pc(marge)} de marge nette depuis janvier.`),
    withLead(filmFig as Section, best && worst ? `Meilleur mois : ${esc(best.label)} (${sgn(netFinalOf(best.agg))} F) ; mois le plus faible : ${esc(worst.label)} (${sgn(netFinalOf(worst.agg))} F).` : null),
    film,
    withLead(indicateurs as Section, pointMort > 0 ? `Il faut <b>${fmt(pointMort)} F de recette par mois</b> pour couvrir les charges${securite != null ? ` ; le rythme actuel laisse ${pc(securite)} de marge de sécurité` : ""}.` : null),
    withLead(projection as Section, realiste && restants > 0 ? `Au rythme des 3 derniers mois, l'année se termine à <b>${sgn(baseNet + realiste.net * restants)} F de net final</b> (entre ${sgn(baseNet + scenarios[0].net * restants)} et ${sgn(baseNet + scenarios[2].net * restants)} F selon le scénario).` : null),
    sensibilite,
    segs ? withLead(segs.section, `Depuis janvier, la flotte interne fait <b>${pc(Number(segs.facts.flotte_interne_part_recette_pourcent ?? 0))}</b> de la recette et ${fmt(Number(segs.facts.flotte_interne_net_final_fcfa ?? 0))} F de net final ; les partenaires ${fmt(Number(segs.facts.partenaires_net_final_fcfa ?? 0))} F.`) : null,
    depBars(full),
    notableExpensesTable(full),
    driverTable(full, yearStart, dateTo),
  ]);

  const carb = full.depCat.get("Carburant") || 0;
  const recos: Decision[] = [];
  if (perf && perf.manqueAGagner > 0) recos.push({ html: `<b>Porter les chauffeurs sous l'objectif à ${fmt(perf.objectif)} F par jour.</b> Le manque à gagner de l'année est estimé à ${fmt(perf.manqueAGagner)} F : c'est le premier levier, il ne demande ni véhicule ni embauche.` });
  if (securite != null && securite < 15) recos.push({ html: `<b>Reconstituer une marge de sécurité.</b> Le rythme actuel n'est qu'à ${pc(securite)} au-dessus du point mort (${fmt(pointMort)} F par mois) : geler toute charge fixe nouvelle tant qu'elle n'est pas couverte par une recette identifiée.` });
  if (recette > 0 && carb > 0 && pct(carb, recette) > 24) recos.push({ html: `<b>Suivre le carburant par chauffeur et par véhicule.</b> ${fmt(carb)} F depuis janvier, soit ${pc(pct(carb, recette))} de la recette.` });
  const actifsAn = full.drivers.filter((a) => !a.technical && a.jours > 0).sort((a, b) => recetteOf(b) - recetteOf(a));
  if (actifsAn[0] && recette > 0 && pct(recetteOf(actifsAn[0]), recette) > 30) recos.push({ html: `<b>Réduire la dépendance à ${esc(actifsAn[0].name)}.</b> Il porte ${pc(pct(recetteOf(actifsAn[0]), recette))} de la recette de l'année : sécuriser un second chauffeur du même niveau avant toute extension du parc.` });

  return {
    meta: {
      docTitle: `Bilan financier année-à-date ${year}${segSuffix(segment)}`,
      periodLabel: `Période : 01/01/${year} → ${frFull(dateTo)}${segSuffix(segment)} · Montants en FCFA`,
      generatedLabel: new Date().toLocaleDateString("fr-FR"),
      shortLabel: `Janvier → ${frFull(dateTo)}`,
      sourceLabel: `Source : ${tenantName} · M3A Fleet SaaS`,
    },
    kpis: [
      { label: `Recette brute ${year}`, value: fmt(recette), sub: `${months.length} mois d'activité`, accent: true },
      { label: "Net final cumulé", value: sgn(netFinal), sub: recette > 0 ? `${pc(marge)} de marge nette` : "—", accent: true },
      ...(realiste && restants > 0 ? [{ label: `Projection ${year} (réaliste)`, value: sgn(baseNet + realiste.net * restants), sub: `net final · ${restants} mois restants` }] : [{ label: "Dépenses cumulées", value: fmt(full.tot.dep), sub: recette > 0 ? `${pc(pct(full.tot.dep, recette))} de la recette` : "—" }]),
      { label: "Point mort mensuel", value: pointMort > 0 ? fmt(pointMort) : "—", sub: securite != null ? `marge de sécurité ${pc(securite)}` : "recette à réaliser par mois" },
    ],
    sections,
    facts,
    aliases: aliasesOf(full),
    context: [
      ...CONTEXT_COMMON, ...segContext(segment), ...(segs?.context ?? []),
      "Bilan financier année-à-date : juge la trajectoire (tendance de marge, point mort, projection), pas le détail d'un mois. Les faits projection_, point_mort_ et sensibilite_ sont des estimations déjà calculées : cite-les comme telles, n'en calcule aucune autre.",
      ...(recents.length < 6 ? [`Historique court (${recents.length} mois complets) : la marge d'erreur des projections est élevée, dis-le.`] : []),
    ],
    deterministicInsights: [
      { severity: netFinal >= 0 ? "ok" : "alert", html: `<b>Net final cumulé ${year} : ${sgn(netFinal)} F</b> sur ${fmt(recette)} F de recette (marge nette ${pc(marge)}), ${months.filter((m) => netFinalOf(m.agg) > 0).length} mois bénéficiaires sur ${months.length}.` },
      ...(realiste && restants > 0 ? [{ severity: (baseNet + realiste.net * restants >= 0 ? "ok" : "alert") as Insight["severity"], html: `<b>Projection de fin d'année : ${sgn(baseNet + realiste.net * restants)} F de net final</b> au rythme des 3 derniers mois (${sgn(realiste.net)} F par mois), entre ${sgn(baseNet + scenarios[0].net * restants)} et ${sgn(baseNet + scenarios[2].net * restants)} F selon le scénario.` }] : []),
      ...(securite != null ? [{ severity: (securite < 0 ? "alert" : securite < 15 ? "warn" : "ok") as Insight["severity"], html: `<b>Point mort : ${fmt(pointMort)} F de recette par mois.</b> Le rythme réaliste (${fmt(realiste!.rec)} F) est ${securite >= 0 ? `${pc(securite)} au-dessus` : `${pc(Math.abs(securite))} en dessous`} : ${securite < 15 ? "la moindre baisse d'activité ou hausse de charge fait basculer le mois en perte" : "la flotte absorbe une baisse d'activité de cet ordre sans passer en perte"}.` }] : []),
      ...(carb > 0 ? [{ severity: (pct(carb, recette) > 24 ? "warn" : "info") as Insight["severity"], html: `<b>Carburant cumulé : ${fmt(carb)} F</b>, soit ${pc(pct(carb, recette))} de la recette.` }] : []),
      ...(perf?.insights ?? []).slice(0, 1),
    ],
    deterministicDecisions: recos.slice(0, 4),
    deterministicManques: [
      ...(recents.length < 6 ? [`Historique de ${recents.length} mois complets seulement : les projections sont des ordres de grandeur.`] : []),
      "Aucune provision pour impôts, taxes ou renouvellement des véhicules n'est comprise dans le net final.",
      ...manquesOf(full, { datesNonRenseignees: Number(ech?.facts.echeances_dates_non_renseignees ?? 0) }),
    ],
    deterministicTldr: `<b>Synthèse.</b> Depuis janvier ${year}, la flotte cumule <b>${sgn(netFinal)} F de net final</b> sur ${fmt(recette)} F de recette brute (marge nette ${pc(marge)}).${realiste && restants > 0 ? ` Au rythme des 3 derniers mois, l'année se termine à <b>${sgn(baseNet + realiste.net * restants)} F</b>.` : ""}${pointMort > 0 ? ` Le point mort est à ${fmt(pointMort)} F de recette par mois.` : ""}`,
    profile: {
      roles: ROLES_FINANCE,
      editorSystem: EDITOR_FINANCE,
      decisionStyle: "liste",
      caps: { forces: 3, alertes: 3, info: 2, decisions: 4 },
      labels: { tldr: "Synthèse exécutive", forces: "Points forts de la trajectoire", alertes: "Points de vigilance", info: "À savoir", decisions: "Recommandations", manques: "Données manquantes et limites de l'analyse" },
      layout: ["tldr", "kpis", { sections: sections.map((_, i) => i) }, "forces", "alertes", "info", "decisions", "manques"],
    },
  };
}

// ── 3. DEEP DIVE OPÉRATIONNEL ───────────────────────────────────────────────

async function deepdiveDataset(tenantId: string, dateFrom: string, dateTo: string, tenantName: string, segment: SegmentFilter = "all"): Promise<ReportDataset> {
  const today = new Date().toISOString().slice(0, 10);
  const [p, perf, heures, av, ech] = await Promise.all([
    aggregatePeriod(tenantId, dateFrom, dateTo, segment),
    perfOf(tenantId, dateFrom, dateTo, segment),
    demandeHoraire(admin, tenantId, dateFrom, dateTo, segment).catch(() => null),
    avanceOf(tenantId, dateFrom, dateTo, segment),
    echeances(admin, tenantId, today, segment).catch(() => null),
  ]);
  const recette = recetteOf(p.tot);
  const caJour = p.tot.jours > 0 ? recette / p.tot.jours : 0;

  // film des semaines
  const byWeek = new Map<string, { ca: number; courses: number; jours: number; drivers: Set<string> }>();
  for (const r of p.reportRows) {
    const d = new Date(`${r.date}T00:00:00Z`);
    const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week1Monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000);
    const wk = `S${String(Math.floor((d.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1).padStart(2, "0")}`;
    const w = byWeek.get(wk) ?? { ca: 0, courses: 0, jours: 0, drivers: new Set<string>() };
    w.ca += r.brut + r.bonus + r.hors; w.courses += r.courses; w.jours += 1; w.drivers.add(r.driver_id);
    byWeek.set(wk, w);
  }
  const weeks = Array.from(byWeek.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const maxWeek = Math.max(...weeks.map(([, v]) => v.ca), 1);
  const semaines: Section | null = weeks.length >= 2 ? {
    kind: "bars", title: "Le film des semaines",
    bars: weeks.map(([wk, v]) => ({
      label: `${wk} · ${v.drivers.size} chauffeur${v.drivers.size > 1 ? "s" : ""} · ${v.jours} j`,
      amountLabel: `${fmt(v.ca)} F · ${fmt(v.ca / v.jours)} F/j`,
      pct: Math.max(1, Math.round((v.ca / maxWeek) * 100)), accent: v.ca === maxWeek,
    })),
    note: "Recette par semaine ISO (Yango + bonus + hors Yango), avec le nombre de chauffeurs et de journées travaillées, puis la recette par journée. Les semaines en bord de période sont tronquées.",
  } : null;

  // efficience par chauffeur : kilomètres, carburant
  const effRows = p.drivers.filter((a) => !a.technical && a.jours > 0).map((a) => {
    const rec = recetteOf(a), km = kmOf(a);
    const num = (v: number | null, dec = 0) => (v == null ? "—" : dec ? v.toFixed(dec).replace(".", ",") : fmt(v));
    return {
      km,
      cells: [
        `<span class="nw">${esc(a.name)}</span>`, String(a.jours),
        num(km != null ? Math.round(km) : null), num(km != null ? Math.round(km / a.jours) : null),
        num(km != null ? Math.round((rec / km) * 10) / 10 : null, 1),
        num(km != null && a.carb > 0 ? Math.round((a.carb / km) * 10) / 10 : null, 1),
        a.carb > 0 && rec > 0 ? pc(pct(a.carb, rec)) : "—",
        rec > 0 ? pc(pct(a.hors, rec)) : "—",
      ],
    };
  });
  const efficience: Section | null = effRows.some((r) => r.km != null) ? {
    kind: "table", title: "Véhicules · kilomètres et carburant par chauffeur",
    columns: [{ label: "Chauffeur" }, { label: "Jours", align: "right" }, { label: "Km", align: "right" }, { label: "Km / jour", align: "right" },
      { label: "Recette / km", align: "right" }, { label: "Carburant / km", align: "right" }, { label: "Carburant % recette", align: "right" }, { label: "Hors Yango", align: "right" }],
    rows: effRows.map((r) => ({ cells: r.cells })),
    note: "Kilomètres = écart de compteur entre le premier et le dernier rapport de la période ; sans relevé de compteur, la ligne porte des tirets. Hors Yango = part de la recette réalisée hors plateforme.",
  } : null;

  const objectif = perf?.objectif ?? 0;
  const atteints = perf ? perf.chauffeurs.filter((c) => c.statut === "atteint").length : 0;
  const refus = Number(perf?.facts.performance_courses_refusees ?? 0);
  const perdu = Number(perf?.facts.performance_ca_non_realise_sur_refus_estime_fcfa ?? 0);
  const joursVides = Number(perf?.facts.levier_jours_sans_activite_total ?? 0);
  const okJ = Number(av?.facts.regularite_journees_a_l_objectif ?? 0), totJ = Number(av?.facts.regularite_journees_travaillees ?? 0);
  const gainRepos = Number(av?.facts.repos_gain_mensuel_estime_si_repos_bien_places_fcfa ?? 0);
  const F = (k: string) => av?.facts[k];

  const sections = numbered([
    av?.quotidien ? withLead(av.quotidien, `La recette moyenne par chauffeur atteint l'objectif <b>${F("quotidien_jours_ou_la_moyenne_atteint_l_objectif")} jours sur ${F("quotidien_jours_avec_activite")}</b> ; meilleure journée le ${F("quotidien_meilleure_journee_date")}.`) : null,
    semaines,
    perf ? withLead(pick(perf.sections, /face à l'objectif/) as Section, `<b>${atteints} chauffeur${atteints > 1 ? "s" : ""} sur ${perf.chauffeurs.length}</b> à l'objectif de ${fmt(objectif)} F par jour${perf.manqueAGagner > 0 ? ` ; manque à gagner estimé : <b>${fmt(perf.manqueAGagner)} F</b>` : ""}.`) : null,
    pick(perf?.sections, /le détail par chauffeur/),
    av?.regularite ? withLead(av.regularite, totJ > 0 ? `<b>${okJ} journées sur ${totJ}</b> atteignent l'objectif (${Math.round((okJ / totJ) * 100)} %) : la moyenne cache des journées très inégales.` : null) : null,
    pick(av?.jours, /meilleurs jours/) ? withLead(pick(av?.jours, /meilleurs jours/) as Section, F("jours_semaine_le_plus_fort") ? `Le <b>${F("jours_semaine_le_plus_fort")}</b> rapporte ${fmt(Number(F("jours_semaine_ecart_fort_faible_fcfa") ?? 0))} F de plus par journée que le <b>${F("jours_semaine_le_plus_faible")}</b>.` : null) : semaineType(p),
    pick(av?.horaires, /jour × heure/) ? withLead(pick(av?.horaires, /jour × heure/) as Section, F("creneau_fort_1") ? `Créneaux à ne pas manquer : <b>${[1, 2, 3].map((i) => F(`creneau_fort_${i}`)).filter(Boolean).join(", ")}</b>.` : null) : heures?.section ?? null,
    pick(av?.jours, /repos conseillé/) ? withLead(pick(av?.jours, /repos conseillé/) as Section, gainRepos > 0 ? `Environ <b>${fmt(gainRepos)} F par mois</b> à récupérer en déplaçant les repos sur le jour faible de chaque chauffeur (estimation).` : "Les repos observés tombent déjà sur les jours faibles.") : null,
    pick(av?.horaires, /Horaires de travail/),
    pick(perf?.sections, /Qualité de service/) ? withLead(pick(perf?.sections, /Qualité de service/) as Section, refus > 0 ? `<b>${fmt(refus)} courses refusées</b>, environ ${fmt(perdu)} F non réalisés (estimation).` : null) : null,
    efficience,
    ech?.section ?? null,
  ]);

  // plan d'action de repli : une ligne = un chauffeur, un jour ou une règle, avec son gain
  const actions: Decision[] = [];
  for (const r of (av?.repos ?? []).slice(0, 2)) {
    actions.push({ html: `<b>Déplacer le repos de ${esc(r.nom)} du ${r.jourPris} au ${r.jourConseille}</b>`, responsable: "Exploitation", echeance: "dès la semaine prochaine", gain: `+${fmt(r.gain)} F / mois (estimation)` });
  }
  for (const c of (perf?.chauffeurs ?? []).filter((x) => x.statut === "sous").sort((a, b) => b.manque - a.manque).slice(0, 2)) {
    actions.push({ html: `<b>Point hebdomadaire avec ${esc(c.nom)}</b> : ${fmt(c.caParJour ?? 0)} F par jour pour un objectif de ${fmt(objectif)} F`, responsable: "Exploitation", echeance: "chaque lundi", gain: `${fmt(c.manque)} F de manque à gagner sur la période (estimation)` });
  }
  const pireRefus = (perf?.chauffeurs ?? []).filter((x) => x.refus > 0).sort((a, b) => b.caNonRealise - a.caNonRealise)[0];
  if (pireRefus && refus > 0) {
    actions.push({ html: `<b>Fixer un taux d'acceptation minimum et le suivre chaque semaine</b>, en commençant par ${esc(pireRefus.nom)} (${pireRefus.refus} refus${pireRefus.acceptation != null ? `, acceptation ${Math.round(pireRefus.acceptation * 100)} %` : ""})`, responsable: "Exploitation", echeance: "sous 15 jours", gain: `${fmt(Number(perf?.facts.levier_refus_gain_si_refus_divises_par_deux_fcfa ?? 0))} F si les refus sont divisés par deux (estimation)` });
  }
  if (joursVides >= 5) {
    actions.push({ html: `<b>Organiser un remplaçant pour les jours sans activité</b> (${joursVides} jours sans course ni repos déclaré)`, responsable: "Exploitation", echeance: "ce mois-ci", gain: `${fmt(Number(perf?.facts.levier_jours_sans_activite_valeur_si_moitie_recuperee_fcfa ?? 0))} F si la moitié est récupérée (estimation)` });
  }
  if (Number(ech?.facts.echeances_documents_expires ?? 0) > 0) {
    actions.push({ html: "<b>Régulariser les documents expirés avant toute remise en circulation</b> (tableau des échéances)", responsable: "Direction", echeance: "cette semaine", gain: "non chiffré" });
  }

  const facts: Record<string, string | number | null> = {
    ...driverFacts(p), ...(perf?.facts ?? {}), ...(av?.facts ?? {}), ...(av && av.horaires.length ? {} : heures?.facts ?? {}), ...(ech?.facts ?? {}),
    perimetre: SEG_LABEL[segment], periode_du: frFull(dateFrom), periode_au: frFull(dateTo),
    jours_travailles: p.tot.jours, repos_declares: p.tot.repos, courses: p.tot.courses,
    recette_brute_fcfa: Math.round(recette), ca_par_jour_flotte_fcfa: Math.round(caJour),
  };
  weeks.forEach(([wk, v]) => {
    facts[`semaine_${wk}_recette_fcfa`] = Math.round(v.ca);
    facts[`semaine_${wk}_journees_travaillees`] = v.jours;
    facts[`semaine_${wk}_chauffeurs`] = v.drivers.size;
  });

  const actifs = p.drivers.filter((a) => !a.technical && a.jours > 0).length;
  return {
    meta: {
      docTitle: `Deep dive opérationnel${segSuffix(segment)}`,
      periodLabel: `Période : ${frFull(dateFrom)} → ${frFull(dateTo)}${segSuffix(segment)} · Montants en FCFA`,
      generatedLabel: new Date().toLocaleDateString("fr-FR"),
      shortLabel: `${frFull(dateFrom)} → ${frFull(dateTo)}`,
      sourceLabel: `Source : ${tenantName} · M3A Fleet SaaS`,
    },
    kpis: [
      { label: "CA par jour travaillé", value: fmt(caJour), sub: objectif > 0 ? `objectif ${fmt(objectif)} F` : "moyenne de la flotte", accent: true },
      ...(perf ? [{ ...perf.kpi, accent: true }] : []),
      { label: "Jours travaillés", value: String(p.tot.jours), sub: `${actifs} chauffeur${actifs > 1 ? "s" : ""}${p.tot.repos ? ` · ${p.tot.repos} repos déclarés` : ""}` },
      ...(totJ > 0 ? [{ label: "Journées à l'objectif", value: `${Math.round((okJ / totJ) * 100)} %`, sub: `${okJ} sur ${totJ}` }] : []),
      { label: "Courses par jour", value: p.tot.jours > 0 ? (p.tot.courses / p.tot.jours).toFixed(1).replace(".", ",") : "—", sub: `${fmt(p.tot.courses)} courses` },
      ...(joursVides > 0 ? [{ label: "Jours sans activité", value: String(joursVides), sub: "ni course ni repos déclaré" }] : []),
      ...(refus > 0 ? [{ label: "Courses refusées", value: fmt(refus), sub: `≈ ${fmt(perdu)} F non réalisés` }] : []),
      ...(gainRepos > 0 ? [{ label: "Repos à déplacer", value: `+${fmt(gainRepos)}`, sub: "F par mois, estimation" }] : []),
    ],
    sections,
    facts,
    aliases: aliasesOf(p),
    context: [
      ...CONTEXT_COMMON.filter((c) => !/ponction/i.test(c)),
      ...segContext(segment), ...(perf?.context ?? []), ...(av?.context ?? []),
      "Rapport opérationnel : il sert à organiser le travail des semaines suivantes (planning, repos, affectation des véhicules, suivi des chauffeurs). Ni marge ni résultat net ici.",
      ...(perf && !perf.hasFleetroom ? ["Pas d'export Yango pour ce compte : ni heures de travail, ni refus, ni créneaux horaires — ne pas les inventer."] : []),
    ],
    deterministicInsights: [...(perf?.insights ?? []), ...(av?.insights ?? []), ...(av && av.horaires.length ? [] : heures?.insights ?? []), ...(ech?.insights ?? [])],
    deterministicDecisions: actions.slice(0, 6),
    deterministicManques: [
      ...(perf && !perf.hasFleetroom ? ["Pas d'export Yango (Fleetroom) : refus, taux d'acceptation, heures de travail et créneaux horaires ne sont pas mesurés."] : []),
      ...(!efficience ? ["Aucun relevé de compteur exploitable : kilomètres, recette au kilomètre et carburant au kilomètre ne sont pas mesurés."] : []),
      ...(p.tot.repos === 0 ? ["Aucun repos n'est déclaré dans l'application : les jours d'arrêt sont déduits des jours sans activité."] : []),
      ...(p.pending > 0 ? [`${p.pending} rapport(s) en attente de validation ne sont pas comptés.`] : []),
    ],
    deterministicTldr: `<b>Synthèse opérationnelle.</b> ${p.tot.jours} journées travaillées par ${actifs} chauffeur${actifs > 1 ? "s" : ""}, à <b>${fmt(caJour)} F par jour</b>${objectif > 0 ? ` pour un objectif de ${fmt(objectif)} F` : ""}.${perf ? ` ${atteints} chauffeur${atteints > 1 ? "s" : ""} sur ${perf.chauffeurs.length} à l'objectif${perf.manqueAGagner > 0 ? `, ${fmt(perf.manqueAGagner)} F de manque à gagner` : ""}.` : ""}${totJ > 0 ? ` ${okJ} journées sur ${totJ} atteignent l'objectif.` : ""}${gainRepos > 0 ? ` Les repos mal placés coûtent environ ${fmt(gainRepos)} F par mois.` : ""}${refus > 0 ? ` ${fmt(refus)} courses refusées.` : ""}`,
    profile: {
      roles: ROLES_OPERATIONS,
      editorSystem: EDITOR_OPERATIONS,
      decisionStyle: "actions",
      caps: { forces: 3, alertes: 5, info: 0, decisions: 6 },
      labels: { tldr: "Synthèse opérationnelle", alertes: "Alertes", forces: "Ce qui fonctionne", decisions: "Plan d'action", manques: "Données manquantes" },
      layout: ["tldr", "kpis", { sections: sections.map((_, i) => i) }, "alertes", "forces", "decisions", "manques"],
    },
  };
}

/**
 * White-label des libellés (retour Abdou 03/09) : le mot « Yango » des textes
 * générés est remplacé par le platform_label du tenant (migration 038) — même
 * règle que displayLabel côté UI. Valeurs stockées (catégories, colonnes) intactes.
 */
function whiteLabelDataset(dataset: ReportDataset, label: string): ReportDataset {
  if (!label || label === "Yango") return dataset;
  const wl = (s: string) => s.replace(/Yango/g, label);
  return {
    ...dataset,
    kpis: dataset.kpis.map((k) => ({ ...k, label: wl(k.label), sub: k.sub ? wl(k.sub) : k.sub })),
    sections: dataset.sections.map((s) => s.kind === "table"
      ? { ...s, title: wl(s.title), note: s.note ? wl(s.note) : s.note,
          columns: s.columns.map((c) => ({ ...c, label: wl(c.label) })),
          rows: s.rows.map((r) => ({ ...r, cells: r.cells.map(wl) })) }
      : s.kind === "figure"
      ? { ...s, title: wl(s.title), note: s.note ? wl(s.note) : s.note, svg: wl(s.svg) }
      : { ...s, title: wl(s.title), note: s.note ? wl(s.note) : s.note,
          bars: s.bars.map((b) => ({ ...b, label: wl(b.label), amountLabel: wl(b.amountLabel) })) }),
    context: (dataset.context ?? []).map(wl),
    deterministicInsights: dataset.deterministicInsights.map((i) => ({ ...i, html: wl(i.html) })),
    deterministicDecisions: (dataset.deterministicDecisions ?? []).map((d) => ({ html: wl(d.html) })),
    deterministicTldr: wl(dataset.deterministicTldr),
  };
}

/** Point d'entrée de l'adaptateur. */
export async function buildFleetDataset(
  tenantId: string, dateFrom: string, dateTo: string, kind: FleetReportKind, segment: SegmentFilter = "all"
): Promise<{ dataset: ReportDataset; tenantName: string; platformLabel: string }> {
  const [{ data: tenant }, { data: ts }] = await Promise.all([
    admin.from("tenants").select("name").eq("id", tenantId).single(),
    admin.from("tenant_settings").select("platform_label, operator_name").eq("tenant_id", tenantId).maybeSingle(),
  ]);
  const tenantName = tenant?.name || "M3A Fleet";
  const platformLabel = (ts?.platform_label || "Yango").trim() || "Yango";
  const dataset =
    kind === "ytd" ? await ytdDataset(tenantId, dateTo, tenantName, segment)
    : kind === "deepdive" ? await deepdiveDataset(tenantId, dateFrom, dateTo, tenantName, segment)
    : await monthlyDataset(tenantId, dateFrom, dateTo, tenantName, segment);
  return { dataset: whiteLabelDataset(dataset, platformLabel), tenantName, platformLabel };
}
