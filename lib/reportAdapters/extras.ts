/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
/**
 * Lectures complémentaires du rapport de direction (demande d'Abdou, 04/10/2026 :
 * « on a toute la base de données, j'attends un excellent rapport pour dirigeant »).
 *
 * - demandeHoraire : à quelles heures la flotte gagne son chiffre (exports Yango Fleetroom) ;
 * - echeances      : assurances, visites techniques, permis et contrats à échéance.
 *
 * Chaque bloc est facultatif : sans donnée, il renvoie null et le rapport sort sans lui.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Insight, Section } from "@/lib/report-agent/types";
import { fetchAllRows } from "@/lib/fetchAllRows";

const fmt = (v: number) => Math.round(v).toLocaleString("fr-FR").replace(/ /g, " ");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const frFull = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

export interface ExtraBlock {
  /** null : seulement des constats, pas de tableau. */
  section: Section | null;
  facts: Record<string, string | number | null>;
  insights: Insight[];
}

const TRANCHES: [string, number, number][] = [
  ["Nuit · 00h–06h", 0, 6], ["Matin · 06h–09h", 6, 9], ["Matinée · 09h–12h", 9, 12], ["Midi · 12h–15h", 12, 15],
  ["Après-midi · 15h–18h", 15, 18], ["Soir · 18h–21h", 18, 21], ["Fin de soirée · 21h–24h", 21, 24],
];

/** Répartition horaire des courses terminées (heure de prise en charge, heure de Dakar = UTC). */
export async function demandeHoraire(
  admin: SupabaseClient<any, any, any>, tenantId: string, dateFrom: string, dateTo: string,
): Promise<ExtraBlock | null> {
  const orders = await fetchAllRows<any>(() => admin.from("yango_orders")
    .select("started_at,cash,cashless,status")
    .eq("tenant_id", tenantId).eq("status", "Terminé").gte("jour", dateFrom).lte("jour", dateTo)
    .order("jour").order("order_id"));
  const rows = orders.filter((o) => o.started_at);
  if (rows.length < 30) return null; // trop peu de courses pour parler de « demande »

  const agg = TRANCHES.map(([label]) => ({ label, courses: 0, ca: 0 }));
  for (const o of rows) {
    const h = new Date(o.started_at).getUTCHours();
    const i = TRANCHES.findIndex(([, a, b]) => h >= a && h < b);
    if (i < 0) continue;
    agg[i].courses += 1;
    agg[i].ca += (Number(o.cash) || 0) + (Number(o.cashless) || 0);
  }
  const total = agg.reduce((s, a) => s + a.courses, 0);
  const caTotal = agg.reduce((s, a) => s + a.ca, 0);
  const max = Math.max(...agg.map((a) => a.ca), 1);
  const part = (v: number, t: number) => (t > 0 ? Math.round((v / t) * 100) : 0);
  const tri = [...agg].sort((a, b) => b.ca - a.ca);
  const fort = tri[0], faible = tri.filter((a) => a.label !== TRANCHES[0][0]).slice(-1)[0];

  const key = (label: string) => label.split(" · ")[1].replace(/[^0-9h]/g, "_");
  const facts: Record<string, string | number | null> = {
    demande_courses_analysees: total,
    demande_tranche_la_plus_forte: fort.label,
    demande_tranche_la_plus_forte_part_ca_pourcent: part(fort.ca, caTotal),
  };
  for (const a of agg) {
    facts[`demande_${key(a.label)}_courses`] = a.courses;
    facts[`demande_${key(a.label)}_ca_fcfa`] = Math.round(a.ca);
    facts[`demande_${key(a.label)}_part_ca_pourcent`] = part(a.ca, caTotal);
  }

  return {
    section: {
      kind: "bars",
      title: "Demande · à quelles heures la flotte fait son chiffre",
      bars: agg.map((a) => ({
        label: a.label,
        amountLabel: `${fmt(a.ca)} F · ${part(a.ca, caTotal)} % · ${fmt(a.courses)} c.`,
        pct: Math.max(1, Math.round((a.ca / max) * 100)),
        accent: a === fort,
      })),
      note: `Courses terminées des exports Yango, à l'heure de prise en charge (${fmt(total)} courses). Montant = espèces + carte encaissées ; part = part du chiffre de la période ; « c. » = courses.`,
    },
    facts,
    insights: [{
      severity: "info",
      html: `<b>La tranche ${esc(fort.label.split(" · ")[1])} fait ${part(fort.ca, caTotal)} % du chiffre</b> (${fmt(fort.courses)} courses)${faible && faible !== fort ? `, contre ${part(faible.ca, caTotal)} % pour ${esc(faible.label.split(" · ")[1])}` : ""}. Les repos, pleins et passages au garage se placent dans les tranches creuses ; les véhicules doivent rouler dans les tranches fortes.`,
    }],
  };
}

/** Assurances, visites techniques, permis et contrats : expirés ou à échéance sous 60 jours. */
export async function echeances(
  admin: SupabaseClient<any, any, any>, tenantId: string, today: string,
): Promise<ExtraBlock | null> {
  const [{ data: vehicles }, { data: profiles }] = await Promise.all([
    admin.from("vehicles").select("plate,status,insurance_expiry,visite_expiry").eq("tenant_id", tenantId),
    admin.from("profiles").select("full_name,driver_id,active,account_type,license_expiry,contract_end_date")
      .eq("tenant_id", tenantId).eq("role", "driver"),
  ]);
  const horizon = new Date(Date.parse(today) + 60 * 86_400_000).toISOString().slice(0, 10);
  const items: { objet: string; nature: string; date: string }[] = [];
  let sansDate = 0;
  for (const v of (vehicles || []) as any[]) {
    if (v.status && /vendu|retir|inactif/i.test(String(v.status))) continue;
    for (const [nature, d] of [["Assurance", v.insurance_expiry], ["Visite technique", v.visite_expiry]] as const) {
      if (!d) { sansDate += 1; continue; }
      if (String(d).slice(0, 10) <= horizon) items.push({ objet: `Véhicule ${v.plate}`, nature, date: String(d).slice(0, 10) });
    }
  }
  for (const p of (profiles || []) as any[]) {
    if (p.active === false || p.account_type === "technical") continue;
    const nom = p.full_name || p.driver_id || "Chauffeur";
    if (p.license_expiry && String(p.license_expiry).slice(0, 10) <= horizon) items.push({ objet: nom, nature: "Permis de conduire", date: String(p.license_expiry).slice(0, 10) });
    const fin = p.contract_end_date ? String(p.contract_end_date).slice(0, 10) : null;
    if (fin && fin >= today && fin <= horizon) items.push({ objet: nom, nature: "Fin de contrat", date: fin });
  }
  if (items.length === 0 && sansDate === 0) return null;
  items.sort((a, b) => a.date.localeCompare(b.date));
  const expires = items.filter((i) => i.date < today && i.nature !== "Fin de contrat");
  const jours = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
  const tag = (d: string) => {
    const j = jours(d);
    return j < 0 ? `<span class="tag red">expiré depuis ${-j} j</span>` : j <= 30 ? `<span class="tag amber">dans ${j} j</span>` : `<span class="tag navy">dans ${j} j</span>`;
  };

  const insights: Insight[] = [];
  if (expires.length) {
    insights.push({
      severity: "alert",
      html: `<b>${expires.length} document${expires.length > 1 ? "s" : ""} expiré${expires.length > 1 ? "s" : ""}.</b> ${expires.slice(0, 6).map((i) => `${esc(i.nature)} · ${esc(i.objet)} (${frFull(i.date)})`).join(" ; ")}. Un véhicule ou un chauffeur qui roule sans document valide expose la flotte à l'immobilisation et au refus de prise en charge d'un sinistre.`,
    });
  }
  if (sansDate > 0) {
    insights.push({
      severity: "warn",
      html: `<b>${sansDate} date${sansDate > 1 ? "s" : ""} d'assurance ou de visite technique non renseignée${sansDate > 1 ? "s" : ""}.</b> Tant qu'elles manquent dans l'application, aucune alerte d'échéance ne peut partir.`,
    });
  }
  if (items.length === 0) {
    return { section: null, facts: { echeances_dates_non_renseignees: sansDate }, insights };
  }
  return {
    section: {
      kind: "table",
      title: "Échéances à surveiller · 60 prochains jours",
      columns: [{ label: "Objet" }, { label: "Document" }, { label: "Échéance", align: "right" }, { label: "Délai" }],
      rows: items.slice(0, 20).map((i) => ({
        cells: [esc(i.objet), esc(i.nature), frFull(i.date), tag(i.date)],
        highlight: i.date < today && i.nature !== "Fin de contrat" ? "alert" as const : undefined,
      })),
      note: `Situation au ${frFull(today)}.${sansDate > 0 ? ` ${sansDate} date(s) d'assurance ou de visite technique ne sont pas renseignées dans l'application.` : ""}`,
    },
    facts: {
      echeances_documents_expires: expires.length,
      echeances_a_venir_60_jours: items.length - expires.length,
      echeances_dates_non_renseignees: sansDate,
    },
    insights,
  };
}
