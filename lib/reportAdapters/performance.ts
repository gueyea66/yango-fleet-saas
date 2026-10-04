/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * Lecture « Performance » du rapport d'activité (demande d'Abdou, 04/10/2026).
 *
 * Reprend le menu Performance de l'app : CA par jour travaillé face à l'objectif
 * du tenant (atteint / proche / sous), classement, jours sans activité, et les
 * indicateurs Fleetroom quand le tenant importe ses exports Yango (acceptation,
 * refus, heures en course, XOF/km).
 *
 * Chiffres : STRICTEMENT ceux de /api/admin/analytics?report=classement (même
 * lecture, mêmes fonctions lib/analytics). Deux dérivés sont ajoutés pour le
 * dirigeant, tous deux étiquetés comme estimations :
 *  - manque à gagner = (objectif − CA/jour) × jours travaillés, chauffeurs sous l'objectif ;
 *  - CA non réalisé sur refus = courses refusées × CA moyen par course du chauffeur.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insight, Kpi, Section } from "@/lib/report-agent/types";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { driverStats, sortStats, type DriverStat } from "@/lib/analytics/driverStats";
import { OBJECTIF_DEFAUT, statutDe } from "@/lib/analytics/trends";
import { segmentResolver, type SegmentFilter } from "@/lib/analytics/segment";

const fmt = (v: number) => Math.round(v).toLocaleString("fr-FR").replace(/ /g, " ");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dash = "—";
const dec1 = (v: number) => v.toFixed(1).replace(".", ",");
/** Même pseudonyme que lib/reportAdapters/fleet.ts : aucun nom ne part vers le LLM. */
const pseudoOf = (id: string) => `drv_${id.replace(/-/g, "").slice(0, 6)}`;

const TAG: Record<string, string> = {
  atteint: '<span class="tag green">atteint</span>',
  proche: '<span class="tag amber">proche</span>',
  sous: '<span class="tag red">sous</span>',
};

export interface PerformanceBlock {
  sections: Section[];
  kpi: Kpi;
  facts: Record<string, string | number | null>;
  insights: Insight[];
  context: string[];
  /** Estimation : ce que la flotte aurait encaissé en plus si chaque chauffeur avait tenu l'objectif. */
  manqueAGagner: number;
  hasFleetroom: boolean;
}

async function readObjectif(admin: SupabaseClient<any, any, any>, tenantId: string): Promise<number> {
  const { data, error } = await admin.from("remuneration_config").select("objectif_ca_jour").eq("tenant_id", tenantId).limit(1);
  if (error) return OBJECTIF_DEFAUT; // colonne absente avant la migration 074
  const v = Number((data?.[0] as any)?.objectif_ca_jour);
  return v > 0 ? v : OBJECTIF_DEFAUT;
}

/** null : aucun chauffeur n'a travaillé sur la période (le rapport sort sans ce bloc). */
export async function performanceBlock(
  admin: SupabaseClient<any, any, any>, tenantId: string, dateFrom: string, dateTo: string,
  segment: SegmentFilter = "all",
): Promise<PerformanceBlock | null> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const seedFrom = new Date(Date.parse(dateFrom) - 180 * 86_400_000).toISOString().slice(0, 10);
  const [objectif, { data: profiles }, reportsAll, ordersAll, seeds, { data: vehicles }] = await Promise.all([
    readObjectif(admin, tenantId),
    admin.from("profiles")
      .select("id, full_name, driver_id, yango_driver_id, active, account_type, hire_date, contract_end_date")
      .eq("tenant_id", tenantId).eq("role", "driver"),
    fetchAllRows(() => admin.from("daily_reports")
      .select("driver_id,vehicle_id,date,status,comment,yango_gross,yango_bonus,off_yango_revenue,yango_trip_count,off_yango_trip_count,net_after_expenses,end_odometer")
      .eq("tenant_id", tenantId).eq("status", "approved").gte("date", dateFrom).lte("date", dateTo).order("date").order("id")),
    fetchAllRows(() => admin.from("yango_orders")
      .select("yango_driver_id,plate,jour,status,cancel_reason,started_at,ended_at,distance_m,cash,cashless")
      .eq("tenant_id", tenantId).gte("jour", dateFrom).lte("jour", dateTo).order("jour").order("order_id")),
    // amorce du km compteur : dernière déclaration validée avec compteur avant la période
    fetchAllRows(() => admin.from("daily_reports").select("driver_id,date,end_odometer")
      .eq("tenant_id", tenantId).eq("status", "approved").gt("end_odometer", 0)
      .lt("date", dateFrom).gte("date", seedFrom).order("date").order("id")),
    admin.from("vehicles").select("id,driver_id,plate,fleet_segment").eq("tenant_id", tenantId),
  ]);

  // Périmètre (flotte interne / véhicules partenaires) : même règle que le menu Performance.
  const seg = segmentResolver((vehicles || []) as any[]);
  const profileOfYango = new Map(((profiles || []) as any[]).filter((p) => p.yango_driver_id).map((p) => [p.yango_driver_id as string, p.id as string]));
  const reports = segment === "all" ? (reportsAll as any[]) : (reportsAll as any[]).filter((r) => seg.ofReport(r) === segment);
  const orders = segment === "all" ? (ordersAll as any[])
    : (ordersAll as any[]).filter((o) => seg.ofPlate(o.plate, profileOfYango.get(o.yango_driver_id) ?? null) === segment);
  const actifs = new Set<string>([...reports.map((r) => r.driver_id as string), ...orders.map((o) => profileOfYango.get(o.yango_driver_id) ?? "")]);
  const drivers = segment === "all" ? ((profiles || []) as any[])
    : ((profiles || []) as any[]).filter((d) => seg.ofDriver(d.id) === segment || actifs.has(d.id));

  const stats = driverStats({
    drivers, reports, seeds: seeds as any[], orders,
    periode: { from: dateFrom, to: dateTo }, today: todayIso,
  });
  // classés par CA par jour : c'est le critère de l'objectif
  const rows = sortStats(stats.rows.filter((r) => r.jours > 0), "ca")
    .sort((a, b) => (b.caParJour ?? 0) - (a.caParJour ?? 0));
  if (rows.length === 0) return null;
  const fr = stats.hasFleetroom;

  const statut = (r: DriverStat) => statutDe(r.caParJour, objectif);
  const manqueOf = (r: DriverStat) => (r.caParJour != null && r.caParJour < objectif ? Math.round((objectif - r.caParJour) * r.jours) : 0);
  const perduRefusOf = (r: DriverStat) => (r.fleetroom && r.caParCourse != null ? Math.round(r.fleetroom.refus * r.caParCourse) : 0);
  const atteints = rows.filter((r) => statut(r) === "atteint");
  const proches = rows.filter((r) => statut(r) === "proche");
  const sous = rows.filter((r) => statut(r) === "sous");
  const jours = rows.reduce((s, r) => s + r.jours, 0);
  const ca = rows.reduce((s, r) => s + r.ca, 0);
  const caJourFlotte = jours > 0 ? ca / jours : null;
  const manque = rows.reduce((s, r) => s + manqueOf(r), 0);
  const refus = rows.reduce((s, r) => s + (r.fleetroom?.refus ?? 0), 0);
  const perduRefus = rows.reduce((s, r) => s + perduRefusOf(r), 0);

  const sections: Section[] = [{
    kind: "table",
    title: `Performance · chaque chauffeur face à l'objectif de ${fmt(objectif)} F par jour`,
    columns: [
      { label: "#" }, { label: "Chauffeur" }, { label: "Jours", align: "right" },
      { label: fr ? "Sans activité" : "Sans décl.", align: "right" }, { label: "CA / jour", align: "right" },
      { label: "Objectif" }, { label: "Manque à gagner", align: "right" },
      { label: "Courses / jour", align: "right" }, { label: "CA / course", align: "right" },
    ],
    rows: [
      ...rows.map((r, i) => {
        const st = statut(r);
        const m = manqueOf(r);
        return {
          cells: [
            String(i + 1), esc(r.name),
            `${r.jours}${r.repos ? ` <span style="color:var(--ink3)">+${r.repos}r</span>` : ""}`,
            r.sansDeclaration ? String(r.sansDeclaration) : dash,
            r.caParJour == null ? dash : `<b>${fmt(r.caParJour)}</b>`,
            st ? `${TAG[st]} ${r.caParJour == null ? "" : `${Math.round((r.caParJour / objectif) * 100)} %`}` : dash,
            m > 0 ? `<span class="neg">−${fmt(m)}</span>` : dash,
            r.coursesParJour == null ? dash : dec1(r.coursesParJour),
            r.caParCourse == null ? dash : fmt(r.caParCourse),
          ],
          highlight: st === "atteint" ? "ok" as const : undefined,
        };
      }),
      {
        cells: ["", "FLOTTE", String(jours), "", caJourFlotte == null ? dash : fmt(caJourFlotte), "",
          manque > 0 ? `−${fmt(manque)}` : dash, "", ""],
        total: true,
      },
    ],
    note: `CA / jour = (Yango + bonus + hors Yango) ÷ jours travaillés, repos exclus. Atteint : objectif tenu ; proche : au moins 80 % ; sous : en dessous. Manque à gagner (estimation) = (objectif − CA / jour) × jours travaillés. ${fr ? "« Sans activité » = jours de la période sans course ni repos déclaré." : "« Sans décl. » = jours de la période sans déclaration ni repos."}`,
  }];

  if (fr) {
    sections.push({
      kind: "table",
      title: "Qualité de service Yango · acceptation, refus et temps de travail",
      columns: [
        { label: "Chauffeur" }, { label: "Acceptation", align: "right" }, { label: "Refus", align: "right" },
        { label: "CA non réalisé", align: "right" }, { label: "H en course", align: "right" },
        { label: "H / jour", align: "right" }, { label: "Occupation", align: "right" }, { label: "XOF / km", align: "right" },
      ],
      rows: [
        ...rows.filter((r) => r.fleetroom).map((r) => {
          const f = r.fleetroom!;
          const faible = f.tauxAcceptation != null && f.tauxAcceptation < 0.9;
          return {
            cells: [
              esc(r.name),
              f.tauxAcceptation == null ? dash : `${faible ? '<span class="neg">' : ""}${Math.round(f.tauxAcceptation * 100)} %${faible ? "</span>" : ""}`,
              String(f.refus), perduRefusOf(r) > 0 ? `−${fmt(perduRefusOf(r))}` : dash,
              dec1(f.heuresCourse), f.joursActifs > 0 ? dec1(f.heuresCourse / f.joursActifs) : dash,
              f.occupation == null ? dash : `${Math.round(f.occupation * 100)} %`,
              f.xofParKm == null ? dash : fmt(f.xofParKm),
            ],
          };
        }),
        { cells: ["FLOTTE", "", String(refus), perduRefus > 0 ? `−${fmt(perduRefus)}` : dash, "", "", "", ""], total: true },
      ],
      note: "Source : exports Yango Fleetroom. Acceptation = courses proposées non refusées. CA non réalisé (estimation) = courses refusées × CA moyen par course du chauffeur. H en course = temps passé avec un client ; H / jour = par jour actif ; occupation = part de l'amplitude de travail passée en course.",
    });
  }

  const facts: Record<string, string | number | null> = {
    performance_objectif_ca_par_jour_fcfa: objectif,
    performance_chauffeurs_actifs: rows.length,
    performance_chauffeurs_objectif_atteint: atteints.length,
    performance_chauffeurs_proches_objectif: proches.length,
    performance_chauffeurs_sous_objectif: sous.length,
    performance_ca_par_jour_flotte_fcfa: caJourFlotte == null ? null : Math.round(caJourFlotte),
    performance_manque_a_gagner_estime_fcfa: manque,
  };
  // Leviers : montants déjà calculés, pour que les options de décision portent un impact chiffré.
  const joursPerdus = rows.reduce((t, r) => t + (r.sansDeclaration ?? 0), 0);
  facts.levier_objectif_gain_si_tous_a_l_objectif_fcfa = manque;
  facts.levier_objectif_gain_si_ecart_reduit_de_moitie_fcfa = Math.round(manque / 2);
  facts.levier_jours_sans_activite_total = joursPerdus;
  facts.levier_jours_sans_activite_valeur_a_l_objectif_fcfa = Math.round(joursPerdus * objectif);
  facts.levier_jours_sans_activite_valeur_si_moitie_recuperee_fcfa = Math.round((joursPerdus * objectif) / 2);
  if (fr) {
    facts.levier_refus_gain_si_refus_divises_par_deux_fcfa = Math.round(perduRefus / 2);
    facts.performance_courses_refusees = refus;
    facts.performance_ca_non_realise_sur_refus_estime_fcfa = perduRefus;
  }
  for (const r of rows) {
    const k = `chauffeur_${pseudoOf(r.driverId)}`;
    facts[`${k}_statut_objectif`] = statut(r);
    facts[`${k}_pourcent_objectif`] = r.caParJour == null ? null : Math.round((r.caParJour / objectif) * 100);
    facts[`${k}_manque_a_gagner_estime_fcfa`] = manqueOf(r);
    facts[`${k}_jours_sans_activite`] = r.sansDeclaration;
    facts[`${k}_courses_par_jour`] = r.coursesParJour == null ? null : Math.round(r.coursesParJour * 10) / 10;
    facts[`${k}_ca_par_course_fcfa`] = r.caParCourse == null ? null : Math.round(r.caParCourse);
    if (r.fleetroom) {
      facts[`${k}_taux_acceptation_pourcent`] = r.fleetroom.tauxAcceptation == null ? null : Math.round(r.fleetroom.tauxAcceptation * 100);
      facts[`${k}_refus`] = r.fleetroom.refus;
      facts[`${k}_ca_non_realise_sur_refus_estime_fcfa`] = perduRefusOf(r);
      facts[`${k}_heures_en_course`] = Math.round(r.fleetroom.heuresCourse * 10) / 10;
    }
  }

  const insights: Insight[] = [];
  const noms = (l: DriverStat[]) => l.map((r) => `${esc(r.name)} (${fmt(r.caParJour ?? 0)} F/j)`).join(", ");
  insights.push({
    severity: atteints.length === rows.length ? "ok" : sous.length > 0 ? "warn" : "info",
    html: `<b>Objectif ${fmt(objectif)} F par jour : ${atteints.length} chauffeur${atteints.length > 1 ? "s" : ""} sur ${rows.length}${manque > 0 ? `, soit ${fmt(manque)} F de manque à gagner` : ""}.</b>`
      + (atteints.length ? ` Atteint : ${noms(atteints)}.` : "")
      + (proches.length ? ` Proche : ${noms(proches)}.` : "")
      + (sous.length ? ` Sous l'objectif : ${noms(sous)}.` : "")
      + (manque > 0 ? " C'est le premier gisement de recette : il ne demande ni véhicule ni chauffeur de plus." : ""),
  });
  if (fr && refus > 0) {
    const pires = rows.filter((r) => r.fleetroom && r.fleetroom.refus > 0).sort((a, b) => perduRefusOf(b) - perduRefusOf(a)).slice(0, 3);
    insights.push({
      severity: perduRefus > manque * 0.5 ? "warn" : "info",
      html: `<b>${fmt(refus)} courses refusées, environ ${fmt(perduRefus)} F non réalisés.</b> ${pires.map((r) => `${esc(r.name)} : ${r.fleetroom!.refus} refus (acceptation ${Math.round((r.fleetroom!.tauxAcceptation ?? 0) * 100)} %)`).join(" ; ")}. Une course refusée est une recette offerte à un concurrent et pèse sur la priorité du chauffeur chez Yango.`,
    });
  }
  const trous = rows.filter((r) => (r.sansDeclaration ?? 0) >= 3).sort((a, b) => (b.sansDeclaration ?? 0) - (a.sansDeclaration ?? 0));
  if (trous.length) {
    const joursPerdus = trous.reduce((s, r) => s + (r.sansDeclaration ?? 0), 0);
    insights.push({
      severity: "warn",
      html: `<b>${joursPerdus} ${fr ? "jours sans activité ni repos déclaré" : "jours sans déclaration ni repos"}.</b> ${trous.map((r) => `${esc(r.name)} : ${r.sansDeclaration}`).join(", ")}. ${fr ? `À ${fmt(objectif)} F par jour, chaque journée de véhicule immobilisé est une recette qui ne se rattrape pas.` : "Un jour non déclaré n'entre ni dans le CA ni dans le CA par jour."}`,
    });
  }

  return {
    sections,
    kpi: {
      label: `Objectif ${fmt(objectif)} / jour`,
      value: `${atteints.length} / ${rows.length} chauffeurs`,
      sub: manque > 0 ? `manque à gagner ${fmt(manque)} F` : "objectif tenu par tous",
    },
    facts,
    insights,
    context: [
      `Lecture performance : l'objectif est de ${fmt(objectif)} F de CA par jour travaillé et par chauffeur (statut atteint, proche à partir de 80 %, sous en dessous). Juge chaque chauffeur d'abord sur ce critère, avant le total du mois : un total élevé peut venir du nombre de jours.`,
      "Le « manque à gagner estimé » chiffre l'écart à l'objectif sur les jours réellement travaillés : c'est le gain accessible sans investissement. Cite-le comme une estimation.",
      ...(fr ? ["Les faits taux_acceptation, refus, heures_en_course et ca_non_realise_sur_refus viennent des exports Yango (Fleetroom) : un CA par jour faible avec beaucoup de refus ou peu d'heures en course est un sujet d'assiduité, pas de demande."] : []),
    ],
    manqueAGagner: manque,
    hasFleetroom: fr,
  };
}
