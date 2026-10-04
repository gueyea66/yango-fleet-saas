/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * Lecture « Performance » du rapport d'activité (demande d'Abdou, 04/10/2026).
 *
 * Reprend le menu Performance de l'app : CA par jour travaillé face à l'objectif
 * du tenant (atteint / proche / sous), classement, jours sans déclaration, et les
 * indicateurs Fleetroom quand le tenant importe ses exports Yango (acceptation,
 * refus, heures en course, XOF/km).
 *
 * Chiffres : STRICTEMENT ceux de /api/admin/analytics?report=classement (même
 * lecture, mêmes fonctions lib/analytics). Rien n'est recalculé ici.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insight, Kpi, Section } from "@/lib/report-agent/types";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { driverStats, sortStats, type DriverStat } from "@/lib/analytics/driverStats";
import { OBJECTIF_DEFAUT, statutDe } from "@/lib/analytics/trends";

const fmt = (v: number) => Math.round(v).toLocaleString("fr-FR").replace(/ /g, " ");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dash = "—";
/** Même pseudonyme que lib/reportAdapters/fleet.ts : aucun nom ne part vers le LLM. */
const pseudoOf = (id: string) => `drv_${id.replace(/-/g, "").slice(0, 6)}`;

const TAG: Record<string, string> = {
  atteint: '<span class="tag green">atteint</span>',
  proche: '<span class="tag amber">proche</span>',
  sous: '<span class="tag navy">sous</span>',
};

export interface PerformanceBlock {
  section: Section;
  kpi: Kpi;
  facts: Record<string, string | number | null>;
  insights: Insight[];
  context: string[];
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
): Promise<PerformanceBlock | null> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const seedFrom = new Date(Date.parse(dateFrom) - 180 * 86_400_000).toISOString().slice(0, 10);
  const [objectif, { data: profiles }, reports, orders, seeds] = await Promise.all([
    readObjectif(admin, tenantId),
    admin.from("profiles")
      .select("id, full_name, driver_id, yango_driver_id, active, account_type, hire_date, contract_end_date")
      .eq("tenant_id", tenantId).eq("role", "driver"),
    fetchAllRows(() => admin.from("daily_reports")
      .select("driver_id,date,status,comment,yango_gross,yango_bonus,off_yango_revenue,yango_trip_count,off_yango_trip_count,net_after_expenses,end_odometer")
      .eq("tenant_id", tenantId).eq("status", "approved").gte("date", dateFrom).lte("date", dateTo).order("date").order("id")),
    fetchAllRows(() => admin.from("yango_orders")
      .select("yango_driver_id,jour,status,cancel_reason,started_at,ended_at,distance_m,cash,cashless")
      .eq("tenant_id", tenantId).gte("jour", dateFrom).lte("jour", dateTo).order("jour").order("order_id")),
    // amorce du km compteur : dernière déclaration validée avec compteur avant la période
    fetchAllRows(() => admin.from("daily_reports").select("driver_id,date,end_odometer")
      .eq("tenant_id", tenantId).eq("status", "approved").gt("end_odometer", 0)
      .lt("date", dateFrom).gte("date", seedFrom).order("date").order("id")),
  ]);

  const stats = driverStats({
    drivers: (profiles || []) as any[], reports: reports as any[], seeds: seeds as any[], orders: orders as any[],
    periode: { from: dateFrom, to: dateTo }, today: todayIso,
  });
  const rows = sortStats(stats.rows.filter((r) => r.jours > 0), "ca");
  if (rows.length === 0) return null;
  const fr = stats.hasFleetroom;

  const statut = (r: DriverStat) => statutDe(r.caParJour, objectif);
  const atteints = rows.filter((r) => statut(r) === "atteint");
  const proches = rows.filter((r) => statut(r) === "proche");
  const sous = rows.filter((r) => statut(r) === "sous");
  const jours = rows.reduce((s, r) => s + r.jours, 0);
  const ca = rows.reduce((s, r) => s + r.ca, 0);
  const caJourFlotte = jours > 0 ? ca / jours : null;

  const pctOf = (v: number | null) => (v == null ? dash : `${Math.round(v * 100)} %`);
  const columns = [
    { label: "#" }, { label: "Chauffeur" }, { label: "Jours", align: "right" as const },
    { label: fr ? "Sans activité" : "Sans décl.", align: "right" as const }, { label: "CA / jour", align: "right" as const },
    { label: `Objectif ${fmt(objectif)}` }, { label: "Courses / jour", align: "right" as const },
    { label: "CA / course", align: "right" as const },
    ...(fr ? [
      { label: "Acceptation", align: "right" as const }, { label: "Refus", align: "right" as const },
      { label: "H en course", align: "right" as const }, { label: "XOF / km", align: "right" as const },
    ] : []),
  ];
  const section: Section = {
    kind: "table",
    title: `Performance · CA par jour travaillé face à l'objectif de ${fmt(objectif)} F`,
    columns,
    rows: rows.map((r, i) => {
      const st = statut(r);
      const f = r.fleetroom;
      return {
        cells: [
          String(i + 1), esc(r.name),
          `${r.jours}${r.repos ? ` <span style="color:var(--ink3)">+${r.repos}r</span>` : ""}`,
          r.sansDeclaration ? String(r.sansDeclaration) : dash,
          r.caParJour == null ? dash : `<b>${fmt(r.caParJour)}</b>`,
          st ? `${TAG[st]} ${r.caParJour == null ? "" : `${Math.round((r.caParJour / objectif) * 100)} %`}` : dash,
          r.coursesParJour == null ? dash : r.coursesParJour.toFixed(1).replace(".", ","),
          r.caParCourse == null ? dash : fmt(r.caParCourse),
          ...(fr ? [
            pctOf(f?.tauxAcceptation ?? null), f ? String(f.refus) : dash,
            f ? f.heuresCourse.toFixed(1).replace(".", ",") : dash,
            f?.xofParKm == null ? dash : fmt(f.xofParKm),
          ] : []),
        ],
        highlight: st === "atteint" ? "ok" as const : undefined,
      };
    }),
    note: `CA / jour = (Yango + bonus + hors Yango) ÷ jours travaillés, repos exclus. Atteint : objectif tenu ; proche : au moins 80 % ; sous : en dessous. ${fr ? "« Sans activité » = jours de la période sans course ni repos déclaré." : "« Sans décl. » = jours de la période sans déclaration ni repos."}${fr ? " Acceptation, refus, heures en course et XOF / km viennent des exports Yango Fleetroom." : ""}`,
  };

  const facts: Record<string, string | number | null> = {
    performance_objectif_ca_par_jour_fcfa: objectif,
    performance_chauffeurs_actifs: rows.length,
    performance_chauffeurs_objectif_atteint: atteints.length,
    performance_chauffeurs_proches_objectif: proches.length,
    performance_chauffeurs_sous_objectif: sous.length,
    performance_ca_par_jour_flotte_fcfa: caJourFlotte == null ? null : Math.round(caJourFlotte),
  };
  for (const r of rows) {
    const k = `chauffeur_${pseudoOf(r.driverId)}`;
    facts[`${k}_statut_objectif`] = statut(r);
    facts[`${k}_pourcent_objectif`] = r.caParJour == null ? null : Math.round((r.caParJour / objectif) * 100);
    facts[`${k}_jours_sans_declaration`] = r.sansDeclaration;
    facts[`${k}_courses_par_jour`] = r.coursesParJour == null ? null : Math.round(r.coursesParJour * 10) / 10;
    if (r.fleetroom) {
      facts[`${k}_taux_acceptation_pourcent`] = r.fleetroom.tauxAcceptation == null ? null : Math.round(r.fleetroom.tauxAcceptation * 100);
      facts[`${k}_refus`] = r.fleetroom.refus;
      facts[`${k}_heures_en_course`] = Math.round(r.fleetroom.heuresCourse * 10) / 10;
    }
  }

  const insights: Insight[] = [];
  const noms = (l: DriverStat[]) => l.map((r) => `${esc(r.name)} (${fmt(r.caParJour ?? 0)} F/j)`).join(", ");
  insights.push({
    severity: atteints.length === rows.length ? "ok" : sous.length > 0 ? "warn" : "info",
    html: `<b>Objectif ${fmt(objectif)} F par jour : ${atteints.length} chauffeur${atteints.length > 1 ? "s" : ""} sur ${rows.length}.</b>`
      + (atteints.length ? ` Atteint : ${noms(atteints)}.` : "")
      + (proches.length ? ` Proche : ${noms(proches)}.` : "")
      + (sous.length ? ` Sous l'objectif : ${noms(sous)}.` : ""),
  });
  const trous = rows.filter((r) => (r.sansDeclaration ?? 0) >= 3);
  if (trous.length) {
    insights.push({
      severity: "warn",
      html: `<b>${fr ? "Jours sans activité ni repos déclaré" : "Jours sans déclaration ni repos"}.</b> ${trous.map((r) => `${esc(r.name)} : ${r.sansDeclaration}`).join(", ")}. ${fr ? "Ces jours n'entrent pas dans le CA par jour : un chauffeur peut tenir l'objectif les jours travaillés et rester loin du potentiel du mois." : "Un jour non déclaré n'entre ni dans le CA ni dans le CA par jour."}`,
    });
  }

  return {
    section,
    kpi: {
      label: `Objectif ${fmt(objectif)} / jour`,
      value: `${atteints.length} / ${rows.length}`,
      sub: `chauffeurs à l'objectif${caJourFlotte == null ? "" : ` · flotte ${fmt(caJourFlotte)} F/j`}`,
    },
    facts,
    insights,
    context: [
      `Lecture performance : l'objectif est de ${fmt(objectif)} F de CA par jour travaillé et par chauffeur (statut atteint, proche à partir de 80 %, sous en dessous). Juge chaque chauffeur d'abord sur ce critère, avant le total du mois : un total élevé peut venir du nombre de jours.`,
      ...(fr ? ["Les faits taux_acceptation, refus et heures_en_course viennent des exports Yango (Fleetroom) : un CA par jour faible avec beaucoup de refus ou peu d'heures en course est un sujet d'assiduité, pas de demande."] : []),
    ],
  };
}
