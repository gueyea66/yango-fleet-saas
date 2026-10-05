/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * Analyses avancées du rapport de direction (demande d'Abdou, 04/10/2026 : « l'analyse
 * des meilleurs jours, le jour idéal de repos et tous les insights avancés que la base
 * peut offrir », « manque de visuel »).
 *
 * Tout est calculé ici, rien n'est laissé au LLM :
 *  - recette jour par jour face à l'objectif (graphique) ;
 *  - meilleurs jours de la semaine et jour de repos conseillé par chauffeur (sur 3 mois,
 *    pour avoir assez d'observations par jour de semaine) ;
 *  - régularité : jours à l'objectif, meilleure et plus faible journée ;
 *  - carte jour × tranche horaire et horaires de travail (exports Yango Fleetroom).
 *
 * Un chauffeur ou un jour avec trop peu d'observations n'est pas commenté : mieux vaut
 * pas de conseil qu'un conseil tiré de deux journées.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insight, Section } from "@/lib/report-agent/types";
import { columnsChart, heatmap } from "@/lib/report-agent/charts";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { segmentResolver, type SegmentFilter } from "@/lib/analytics/segment";
import { readDriverSegments } from "@/lib/analytics/driverSegments";
import { OBJECTIF_DEFAUT } from "@/lib/analytics/trends";

const fmt = (v: number) => Math.round(v).toLocaleString("fr-FR").replace(/ /g, " ");
const fmtK = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".", ",")} M` : v >= 1000 ? `${Math.round(v / 1000)} k` : String(Math.round(v)));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const pseudoOf = (id: string) => `drv_${id.replace(/-/g, "").slice(0, 6)}`;
const JOURS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const JOURS_MIN = JOURS.map((j) => j.toLowerCase());
const wdOf = (d: string) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
const isRepos = (r: { comment?: string | null }) => String(r.comment || "").startsWith("[REPOS]");
const caOf = (r: any) => (Number(r.yango_gross) || 0) + (Number(r.yango_bonus) || 0) + (Number(r.off_yango_revenue) || 0);
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}h${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

/** Observations minimales pour commenter un jour de semaine d'un chauffeur. */
const MIN_OBS = 3;
/** Tranches de deux heures de la carte jour × heure (06h → minuit ; la nuit est regroupée). */
const TRANCHES: [string, number, number][] = [
  ["0–6h", 0, 6], ["6–8h", 6, 8], ["8–10h", 8, 10], ["10–12h", 10, 12], ["12–14h", 12, 14],
  ["14–16h", 14, 16], ["16–18h", 16, 18], ["18–20h", 18, 20], ["20–22h", 20, 22], ["22–24h", 22, 24],
];

export interface AvanceBlock {
  /** Recette jour par jour (graphique). */
  quotidien: Section | null;
  /** Meilleurs jours et repos conseillé. */
  jours: Section[];
  /** Régularité par chauffeur. */
  regularite: Section | null;
  /** Carte jour × heure et horaires (Fleetroom). */
  horaires: Section[];
  facts: Record<string, string | number | null>;
  insights: Insight[];
  context: string[];
  /** Repos à déplacer : chauffeurs dont l'arrêt tombe sur un jour plus rémunérateur que leur jour faible. */
  repos: { nom: string; jourConseille: string; jourPris: string; gain: number }[];
}

async function readObjectif(admin: SupabaseClient<any, any, any>, tenantId: string): Promise<number> {
  const { data, error } = await admin.from("remuneration_config").select("objectif_ca_jour").eq("tenant_id", tenantId).limit(1);
  if (error) return OBJECTIF_DEFAUT;
  const v = Number((data?.[0] as any)?.objectif_ca_jour);
  return v > 0 ? v : OBJECTIF_DEFAUT;
}

export async function avanceBlock(
  admin: SupabaseClient<any, any, any>, tenantId: string, dateFrom: string, dateTo: string,
  segment: SegmentFilter = "all",
): Promise<AvanceBlock | null> {
  // fenêtre longue (3 mois glissants jusqu'à la fin de la période) pour les habitudes par jour de semaine
  const longFrom = new Date(Date.parse(dateTo) - 91 * 86_400_000).toISOString().slice(0, 10);
  const from = longFrom < dateFrom ? longFrom : dateFrom;
  const [objectif, { data: profiles }, { data: vehicles }, reportsAll, ordersAll] = await Promise.all([
    readObjectif(admin, tenantId),
    admin.from("profiles").select("id, full_name, driver_id, yango_driver_id, active, account_type, hire_date, contract_end_date")
      .eq("tenant_id", tenantId).eq("role", "driver"),
    admin.from("vehicles").select("id,driver_id,plate,fleet_segment").eq("tenant_id", tenantId),
    fetchAllRows<any>(() => admin.from("daily_reports")
      .select("driver_id,vehicle_id,date,comment,yango_gross,yango_bonus,off_yango_revenue,yango_trip_count,off_yango_trip_count")
      .eq("tenant_id", tenantId).eq("status", "approved").gte("date", from).lte("date", dateTo).order("date").order("id")),
    fetchAllRows<any>(() => admin.from("yango_orders")
      .select("yango_driver_id,plate,jour,status,started_at,ended_at,cash,cashless")
      .eq("tenant_id", tenantId).eq("status", "Terminé").gte("jour", from).lte("jour", dateTo).order("jour").order("order_id")),
  ]);

  const seg = segmentResolver((vehicles || []) as any[], await readDriverSegments(admin, tenantId));
  const profs = ((profiles || []) as any[]).filter((p) => p.account_type !== "technical");
  const nameOf = new Map(profs.map((p) => [p.id as string, (p.full_name || p.driver_id || "Chauffeur") as string]));
  const profileOfYango = new Map(profs.filter((p) => p.yango_driver_id).map((p) => [p.yango_driver_id as string, p.id as string]));
  const reports = reportsAll.filter((r) => nameOf.has(r.driver_id) && (segment === "all" || seg.ofReport(r) === segment));
  const worked = reports.filter((r) => !isRepos(r) && caOf(r) > 0);
  const inPeriod = (d: string) => d >= dateFrom && d <= dateTo;
  const cur = worked.filter((r) => inPeriod(r.date));
  if (cur.length < 5) return null;
  const orders = ordersAll.filter((o) => o.started_at && (segment === "all" || seg.ofPlate(o.plate, profileOfYango.get(o.yango_driver_id) ?? null) === segment));

  const facts: Record<string, string | number | null> = {};
  const insights: Insight[] = [];
  const context: string[] = [];
  const reposADeplacer: AvanceBlock["repos"] = [];

  // ── 1. recette jour par jour : moyenne par chauffeur au travail, face à l'objectif
  const byDay = new Map<string, { ca: number; n: number }>();
  for (const r of cur) { const a = byDay.get(r.date) ?? { ca: 0, n: 0 }; a.ca += caOf(r); a.n += 1; byDay.set(r.date, a); }
  const days: string[] = [];
  for (let t = Date.parse(dateFrom); t <= Date.parse(dateTo); t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  const moyJour = days.map((d) => { const a = byDay.get(d); return a ? a.ca / a.n : 0; });
  const actifsJour = days.map((d) => byDay.get(d)?.n ?? 0);
  const joursActifs = moyJour.filter((v) => v > 0).length;
  const joursObjectif = moyJour.filter((v) => v >= objectif).length;
  const best = moyJour.indexOf(Math.max(...moyJour));
  const dayLabel = (d: string) => `${JOURS[wdOf(d)].slice(0, 3).toLowerCase()}. ${fr(d)}`;
  const quotidien: Section | null = days.length >= 7 && days.length <= 62 ? {
    kind: "figure",
    title: "Recette jour par jour face à l'objectif",
    svg: columnsChart({
      label: "Recette moyenne par chauffeur au travail, jour par jour",
      categories: days.map((d) => d.slice(8, 10)), series: [{ name: "Recette moyenne par chauffeur", values: moyJour }],
      fmt: fmtK, target: { value: objectif, label: `Objectif ${fmt(objectif)} F` }, highlight: best, labelEvery: days.length > 16 ? 2 : 1, height: 210,
    }),
    data: { jours_avec_activite: joursActifs, jours_ou_la_moyenne_atteint_l_objectif: joursObjectif, meilleure_journee: `${dayLabel(days[best])} (${fmt(moyJour[best])} F par chauffeur)` },
    note: `Recette moyenne d'un chauffeur au travail chaque jour (Yango + bonus + hors Yango). La moyenne de la flotte atteint l'objectif ${joursObjectif} jour${joursObjectif > 1 ? "s" : ""} sur ${joursActifs}. Meilleure journée : ${dayLabel(days[best])}, ${fmt(moyJour[best])} F par chauffeur avec ${actifsJour[best]} chauffeur${actifsJour[best] > 1 ? "s" : ""} au travail.`,
  } : null;
  facts.quotidien_jours_avec_activite = joursActifs;
  facts.quotidien_jours_ou_la_moyenne_atteint_l_objectif = joursObjectif;
  facts.quotidien_meilleure_journee_moyenne_par_chauffeur_fcfa = Math.round(moyJour[best]);
  facts.quotidien_meilleure_journee_date = fr(days[best]);

  // ── 2. meilleurs jours de la semaine (3 mois) et repos conseillé par chauffeur
  const flotte = JOURS.map(() => ({ ca: 0, n: 0 }));
  for (const r of worked) { const w = wdOf(r.date); flotte[w].ca += caOf(r); flotte[w].n += 1; }
  const moyFlotte = flotte.map((a) => (a.n >= MIN_OBS ? a.ca / a.n : 0));
  const rangs = moyFlotte.map((v, i) => ({ v, i })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
  const jours: Section[] = [];
  if (rangs.length >= 5) {
    const fort = rangs[0], faible = rangs[rangs.length - 1];
    const maxMoy = fort.v;
    jours.push({
      kind: "bars",
      title: "Les meilleurs jours de la semaine (3 derniers mois)",
      bars: JOURS.map((j, i) => ({
        label: j,
        amountLabel: flotte[i].n >= MIN_OBS ? `${fmt(moyFlotte[i])} F · ${flotte[i].n} journées` : "trop peu de journées",
        pct: Math.max(1, Math.round((moyFlotte[i] / maxMoy) * 100)),
        accent: i === fort.i,
      })),
      note: `Recette moyenne d'une journée de chauffeur, du ${fr(from)} au ${fr(dateTo)}. Jour le plus fort : ${JOURS_MIN[fort.i]} (${fmt(fort.v)} F) ; jour le plus faible : ${JOURS_MIN[faible.i]} (${fmt(faible.v)} F), soit ${fmt(fort.v - faible.v)} F d'écart par journée.`,
    });
    facts.jours_semaine_le_plus_fort = JOURS_MIN[fort.i];
    facts.jours_semaine_le_plus_fort_recette_moyenne_fcfa = Math.round(fort.v);
    facts.jours_semaine_le_plus_faible = JOURS_MIN[faible.i];
    facts.jours_semaine_le_plus_faible_recette_moyenne_fcfa = Math.round(faible.v);
    facts.jours_semaine_ecart_fort_faible_fcfa = Math.round(fort.v - faible.v);
    JOURS_MIN.forEach((j, i) => { if (flotte[i].n >= MIN_OBS) facts[`jours_semaine_${j}_recette_moyenne_fcfa`] = Math.round(moyFlotte[i]); });

    // par chauffeur : jour fort, jour faible (repos conseillé), repos réellement pris
    const actifsPeriode = Array.from(new Set(cur.map((r) => r.driver_id as string)));
    const reposRows: { cells: string[]; highlight?: "ok" | "alert" }[] = [];
    let gainTotal = 0;
    const malPlaces: string[] = [];
    for (const id of actifsPeriode) {
      const mine = worked.filter((r) => r.driver_id === id);
      const acc = JOURS.map(() => ({ ca: 0, n: 0 }));
      for (const r of mine) { const w = wdOf(r.date); acc[w].ca += caOf(r); acc[w].n += 1; }
      const moy = acc.map((a) => (a.n >= MIN_OBS ? a.ca / a.n : null));
      const connus = moy.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v != null);
      if (connus.length < 4) continue; // pas assez de recul sur ce chauffeur
      const tri = [...connus].sort((a, b) => b.v - a.v);
      const dFort = tri[0], dFaible = tri[tri.length - 1];
      const moyenne = mine.reduce((s, r) => s + caOf(r), 0) / mine.length;
      // jours de la période sans activité, par jour de semaine : le repos réellement pris
      const travailles = new Set(mine.filter((r) => inPeriod(r.date)).map((r) => r.date));
      const p = profs.find((x) => x.id === id);
      const debut = p?.hire_date && p.hire_date > dateFrom ? String(p.hire_date).slice(0, 10) : dateFrom;
      const fin = p?.contract_end_date && p.contract_end_date < dateTo ? String(p.contract_end_date).slice(0, 10) : dateTo;
      const abs = JOURS.map(() => 0);
      for (const d of days) if (d >= debut && d <= fin && !travailles.has(d)) abs[wdOf(d)] += 1;
      const absMax = Math.max(...abs);
      const jourPris = absMax >= 2 ? abs.indexOf(absMax) : -1;
      // gain mensuel estimé : chaque semaine, le repos tombe sur le jour faible plutôt que sur le jour réellement pris
      const moyPris = jourPris >= 0 ? moy[jourPris] : null;
      const gain = jourPris >= 0 && jourPris !== dFaible.i && moyPris != null && moyPris > dFaible.v ? Math.round((moyPris - dFaible.v) * 4) : 0;
      gainTotal += gain;
      const nom = nameOf.get(id)!;
      if (gain > 0 && jourPris >= 0) reposADeplacer.push({ nom, jourConseille: JOURS_MIN[dFaible.i], jourPris: JOURS_MIN[jourPris], gain });
      if (gain > 0 && jourPris >= 0) malPlaces.push(`${esc(nom)} s'arrête surtout le ${JOURS_MIN[jourPris]} (${fmt(moyPris!)} F en moyenne quand il roule ce jour-là) alors que son jour le plus faible est le ${JOURS_MIN[dFaible.i]} (${fmt(dFaible.v)} F)`);
      reposRows.push({
        cells: [
          `<span class="nw">${esc(nom)}</span>`, `${JOURS[dFort.i]} · <b>${fmt(dFort.v)}</b>`, `${JOURS[dFaible.i]} · ${fmt(dFaible.v)}`,
          `<span class="tag green">${JOURS[dFaible.i]}</span>`,
          jourPris >= 0 ? `${JOURS[jourPris]} (${absMax} fois)` : "pas de jour fixe",
          gain > 0 ? `<span class="pos">+${fmt(gain)}</span>` : "—",
        ],
        highlight: gain > 0 ? "alert" : undefined,
      });
      const k = `chauffeur_${pseudoOf(id)}`;
      facts[`${k}_jour_le_plus_fort`] = JOURS_MIN[dFort.i];
      facts[`${k}_jour_le_plus_fort_recette_moyenne_fcfa`] = Math.round(dFort.v);
      facts[`${k}_jour_de_repos_conseille`] = JOURS_MIN[dFaible.i];
      facts[`${k}_jour_le_plus_faible_recette_moyenne_fcfa`] = Math.round(dFaible.v);
      facts[`${k}_jour_de_repos_pris_en_pratique`] = jourPris >= 0 ? JOURS_MIN[jourPris] : null;
      facts[`${k}_gain_mensuel_estime_si_repos_deplace_fcfa`] = gain;
      facts[`${k}_recette_moyenne_par_jour_3_mois_fcfa`] = Math.round(moyenne);
    }
    if (reposRows.length > 0) {
      jours.push({
        kind: "table",
        title: "Jour de repos conseillé par chauffeur",
        columns: [
          { label: "Chauffeur" }, { label: "Jour le plus fort" }, { label: "Jour le plus faible" },
          { label: "Repos conseillé" }, { label: "Arrêt observé" }, { label: "Gain / mois", align: "right" },
        ],
        rows: reposRows,
        note: `Calculé sur 3 mois (du ${fr(from)} au ${fr(dateTo)}), jours avec au moins ${MIN_OBS} journées travaillées ; un chauffeur sans assez de recul n'apparaît pas. Repos conseillé = son jour de semaine le moins rémunérateur. Arrêt observé = le jour où il n'a le plus souvent pas roulé sur la période. Gain par mois (estimation) = écart entre ces deux jours × 4 semaines, quand le repos tombe aujourd'hui sur un jour plus rémunérateur.`,
      });
      facts.repos_gain_mensuel_estime_si_repos_bien_places_fcfa = gainTotal;
      if (malPlaces.length) {
        insights.push({
          severity: "warn",
          html: `<b>Repos mal placés : environ ${fmt(gainTotal)} F par mois à récupérer.</b> ${malPlaces.slice(0, 4).join(" ; ")}. Déplacer le repos sur le jour faible ne coûte rien et ne demande aucun jour de travail en plus.`,
        });
      }
    }
    insights.push({
      severity: "info",
      html: `<b>Le ${JOURS_MIN[fort.i]} est le meilleur jour (${fmt(fort.v)} F par chauffeur), le ${JOURS_MIN[faible.i]} le plus faible (${fmt(faible.v)} F).</b> Sur 3 mois, une journée de ${JOURS_MIN[fort.i]} rapporte ${fmt(fort.v - faible.v)} F de plus qu'une journée de ${JOURS_MIN[faible.i]} : repos, entretiens et passages au garage se placent le ${JOURS_MIN[faible.i]}, jamais le ${JOURS_MIN[fort.i]}.`,
    });
    context.push("Les faits jours_semaine_ et jour_de_repos_ sont calculés sur 3 mois glissants : conseille le jour de repos de chaque chauffeur à partir de son jour le plus faible, et chiffre le gain avec les faits gain_mensuel_estime (ce sont des estimations).");
  }

  // ── 3. régularité : jours à l'objectif, meilleure et plus faible journée
  const regRows: { nom: string; n: number; ok: number; best: any; worst: any; mediane: number }[] = [];
  for (const id of new Set(cur.map((r) => r.driver_id as string))) {
    const mine = cur.filter((r) => r.driver_id === id).sort((a, b) => caOf(a) - caOf(b));
    if (mine.length < 5) continue;
    regRows.push({
      nom: nameOf.get(id)!, n: mine.length, ok: mine.filter((r) => caOf(r) >= objectif).length,
      best: mine[mine.length - 1], worst: mine[0], mediane: caOf(mine[Math.floor(mine.length / 2)]),
    });
    const k = `chauffeur_${pseudoOf(id)}`;
    facts[`${k}_jours_a_l_objectif`] = mine.filter((r) => caOf(r) >= objectif).length;
    facts[`${k}_meilleure_journee_fcfa`] = Math.round(caOf(mine[mine.length - 1]));
    facts[`${k}_plus_faible_journee_fcfa`] = Math.round(caOf(mine[0]));
    facts[`${k}_journee_mediane_fcfa`] = Math.round(caOf(mine[Math.floor(mine.length / 2)]));
  }
  regRows.sort((a, b) => b.ok / b.n - a.ok / a.n);
  const totOk = regRows.reduce((s, r) => s + r.ok, 0), totN = regRows.reduce((s, r) => s + r.n, 0);
  const regularite: Section | null = regRows.length ? {
    kind: "table",
    title: `Régularité · combien de journées atteignent ${fmt(objectif)} F`,
    columns: [
      { label: "Chauffeur" }, { label: "Journées à l'objectif", align: "right" },
      { label: "Journée médiane", align: "right" }, { label: "Meilleure journée", align: "right" }, { label: "Plus faible journée", align: "right" },
    ],
    rows: [
      ...regRows.map((r) => ({
        cells: [
          `<span class="nw">${esc(r.nom)}</span>`, `<b>${r.ok}</b> / ${r.n} · ${Math.round((r.ok / r.n) * 100)} %`,
          fmt(r.mediane), `${fmt(caOf(r.best))} <span style="color:var(--ink3)">${fr(r.best.date)}</span>`,
          `${fmt(caOf(r.worst))} <span style="color:var(--ink3)">${fr(r.worst.date)}</span>`,
        ],
      })),
      { cells: ["FLOTTE", `${totOk} / ${totN} · ${totN ? Math.round((totOk / totN) * 100) : 0} %`, "", "", ""], total: true },
    ],
    note: "Une moyenne peut cacher des journées très inégales. Journée médiane = la journée « du milieu » : la moitié des journées du chauffeur font mieux, l'autre moitié moins bien. Chauffeurs avec au moins 5 journées sur la période.",
  } : null;
  if (totN > 0) {
    facts.regularite_journees_a_l_objectif = totOk;
    facts.regularite_journees_travaillees = totN;
    facts.regularite_part_journees_a_l_objectif_pourcent = Math.round((totOk / totN) * 100);
    const irreg = regRows.filter((r) => r.ok / r.n < 0.3 && caOf(r.best) >= objectif);
    if (irreg.length) {
      insights.push({
        severity: "warn",
        html: `<b>${totOk} journées sur ${totN} atteignent l'objectif (${Math.round((totOk / totN) * 100)} %).</b> ${irreg.slice(0, 3).map((r) => `${esc(r.nom)} : ${r.ok} sur ${r.n}, pourtant ${fmt(caOf(r.best))} F le ${fr(r.best.date)}`).join(" ; ")}. Ces chauffeurs savent faire une bonne journée : le sujet est la constance, pas la capacité.`,
      });
    }
  }

  // ── 4. carte jour × heure et horaires de travail (exports Yango)
  const horaires: Section[] = [];
  const curOrders = orders.filter((o) => inPeriod(o.jour));
  if (curOrders.length >= 100) {
    const grid = JOURS.map(() => TRANCHES.map(() => 0));
    const nJours = JOURS.map(() => new Set<string>());
    for (const o of curOrders) {
      const d = new Date(o.started_at);
      const w = wdOf(o.jour), h = d.getUTCHours();
      const j = TRANCHES.findIndex(([, a, b]) => h >= a && h < b);
      if (j < 0) continue;
      grid[w][j] += (Number(o.cash) || 0) + (Number(o.cashless) || 0);
      nJours[w].add(o.jour);
    }
    // moyenne par jour calendaire de ce jour de semaine : un mois compte 4 ou 5 lundis
    const moy = grid.map((row, w) => row.map((v) => (nJours[w].size ? v / nJours[w].size : 0)));
    const cells = moy.flatMap((row, w) => row.map((v, j) => ({ v, w, j }))).sort((a, b) => b.v - a.v);
    const top = cells.slice(0, 3), creux = cells.filter((c) => c.j > 0 && c.v > 0).slice(-3).reverse();
    const nom = (c: { w: number; j: number }) => `${JOURS_MIN[c.w]} ${TRANCHES[c.j][0]}`;
    horaires.push({
      kind: "figure",
      title: "Quand la flotte gagne son chiffre · jour × heure",
      svg: heatmap({
        label: "Chiffre moyen par jour de semaine et tranche horaire",
        rows: JOURS, cols: TRANCHES.map((t) => t[0]), values: moy, fmt: fmtK, legend: "Chiffre de la flotte",
      }),
      data: { creneaux_les_plus_forts: top.map((c) => `${nom(c)} : ${fmt(c.v)} F`), creneaux_les_plus_faibles: creux.map((c) => `${nom(c)} : ${fmt(c.v)} F`) },
      note: `Chiffre encaissé par la flotte (espèces + carte), moyenne par jour de semaine, à l'heure de prise en charge. Créneaux les plus forts : ${top.map((c) => `${nom(c)} (${fmt(c.v)} F)`).join(", ")}. Créneaux les plus creux en journée : ${creux.map((c) => `${nom(c)} (${fmt(c.v)} F)`).join(", ")}.`,
    });
    top.forEach((c, i) => { facts[`creneau_fort_${i + 1}`] = nom(c); facts[`creneau_fort_${i + 1}_chiffre_moyen_fcfa`] = Math.round(c.v); });
    creux.forEach((c, i) => { facts[`creneau_creux_${i + 1}`] = nom(c); facts[`creneau_creux_${i + 1}_chiffre_moyen_fcfa`] = Math.round(c.v); });
    insights.push({
      severity: "info",
      html: `<b>Créneaux à ne pas manquer : ${top.map((c) => nom(c)).join(", ")}.</b> Ce sont les trois créneaux où la flotte encaisse le plus (${fmt(top[0].v)} F en moyenne sur le premier). Les pleins, pauses et passages au garage se placent sur les créneaux creux : ${creux.map((c) => nom(c)).join(", ")}.`,
    });

    // horaires de travail par chauffeur : première prise en charge, dernière fin, courses par heure
    const parChauffeur = new Map<string, Map<string, { debut: number; fin: number; n: number; duree: number }>>();
    for (const o of curOrders) {
      const id = profileOfYango.get(o.yango_driver_id);
      if (!id) continue;
      const s = new Date(o.started_at), e = o.ended_at ? new Date(o.ended_at) : s;
      const hs = s.getUTCHours() + s.getUTCMinutes() / 60;
      // une course finie après minuit compte dans la journée de départ
      const he = hs + Math.max(0, (e.getTime() - s.getTime()) / 3_600_000);
      const m = parChauffeur.get(id) ?? parChauffeur.set(id, new Map()).get(id)!;
      const a = m.get(o.jour) ?? { debut: 24, fin: 0, n: 0, duree: 0 };
      a.debut = Math.min(a.debut, hs); a.fin = Math.max(a.fin, he); a.n += 1; a.duree += he - hs;
      m.set(o.jour, a);
    }
    const rows = Array.from(parChauffeur.entries()).filter(([, m]) => m.size >= 5).map(([id, m]) => {
      const v = Array.from(m.values());
      const moyenne = (f: (a: { debut: number; fin: number; n: number; duree: number }) => number) => v.reduce((s, a) => s + f(a), 0) / v.length;
      const debut = moyenne((a) => a.debut), fin = moyenne((a) => a.fin), amp = moyenne((a) => a.fin - a.debut);
      const enCourse = moyenne((a) => a.duree), courses = moyenne((a) => a.n);
      // mêmes jours que les horaires : un jour sans commandes importées n'a pas d'amplitude
      const ca = cur.filter((r) => r.driver_id === id && m.has(r.date));
      const caJour = ca.length ? ca.reduce((s, r) => s + caOf(r), 0) / ca.length : 0;
      return { id, nom: nameOf.get(id) ?? id, debut, fin, amp, enCourse, courses, caJour, caHeure: amp > 0 ? caJour / amp : 0 };
    }).sort((a, b) => b.caHeure - a.caHeure);
    if (rows.length) {
      horaires.push({
        kind: "table",
        title: "Horaires de travail et rendement à l'heure",
        columns: [
          { label: "Chauffeur" }, { label: "Début moyen", align: "right" }, { label: "Fin moyenne", align: "right" },
          { label: "Amplitude", align: "right" }, { label: "En course", align: "right" },
          { label: "Courses / jour", align: "right" }, { label: "Recette / heure", align: "right" },
        ],
        rows: rows.map((r) => ({
          cells: [
            `<span class="nw">${esc(r.nom)}</span>`, hhmm(r.debut), hhmm(r.fin % 24), `${r.amp.toFixed(1).replace(".", ",")} h`,
            `${r.enCourse.toFixed(1).replace(".", ",")} h · ${r.amp > 0 ? Math.round((r.enCourse / r.amp) * 100) : 0} %`,
            r.courses.toFixed(1).replace(".", ","), `<b>${fmt(r.caHeure)}</b>`,
          ],
        })),
        note: "Source : exports Yango. Début = première prise en charge, fin = fin de la dernière course, moyennes des jours travaillés. Amplitude = temps entre les deux ; « en course » = temps passé avec un client et sa part de l'amplitude. Recette / heure = recette moyenne par jour ÷ amplitude : à amplitude égale, c'est ce qui sépare un bon chauffeur d'un chauffeur présent.",
      });
      for (const r of rows) {
        const k = `chauffeur_${pseudoOf(r.id)}`;
        facts[`${k}_heure_de_debut_moyenne`] = hhmm(r.debut);
        facts[`${k}_heure_de_fin_moyenne`] = hhmm(r.fin % 24);
        facts[`${k}_amplitude_moyenne_heures`] = Math.round(r.amp * 10) / 10;
        facts[`${k}_recette_par_heure_d_amplitude_fcfa`] = Math.round(r.caHeure);
      }
      const tardifs = rows.filter((r) => r.debut >= 9 && r.debut < 12);
      const decales = rows.filter((r) => r.debut >= 12);
      const meilleur = rows[0], dernier = rows[rows.length - 1];
      if (rows.length >= 2 && meilleur.caHeure > dernier.caHeure * 1.25) {
        insights.push({
          severity: "info",
          html: `<b>Rendement à l'heure : de ${fmt(dernier.caHeure)} à ${fmt(meilleur.caHeure)} F.</b> ${esc(meilleur.nom)} encaisse ${fmt(meilleur.caHeure)} F par heure d'amplitude, ${esc(dernier.nom)} ${fmt(dernier.caHeure)} F.${tardifs.length ? ` ${tardifs.map((r) => `${esc(r.nom)} démarre en moyenne à ${hhmm(r.debut)}`).join(" ; ")} : une partie du créneau du matin lui échappe.` : ""}${decales.length ? ` ${decales.map((r) => `${esc(r.nom)} travaille en horaires décalés (début moyen ${hhmm(r.debut)})`).join(" ; ")}.` : ""}`,
        });
      }
    }
    context.push("Les faits creneau_fort_, creneau_creux_, heure_de_debut, amplitude et recette_par_heure viennent des exports Yango : sers-t'en pour dire à quelle heure les véhicules doivent rouler et quel chauffeur est présent sans être productif.");
  }

  return { quotidien, jours, regularite, horaires, facts, insights, context, repos: reposADeplacer.sort((a, b) => b.gain - a.gain) };
}
