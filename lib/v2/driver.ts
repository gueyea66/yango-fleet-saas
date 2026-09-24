/**
 * Logique d'affichage pure de l'app chauffeur v2 (aucune donnée lue ni écrite).
 * Les chiffres métier (net, commissions, paliers) viennent de calc.ts /
 * calcReel.ts / salaryLevel via les hooks partagés ; ici on ne fait que les
 * mettre en forme pour les écrans des maquettes.
 */
import type { SalaryTier } from "@/lib/tenant/types";

export type DriverTab = "home" | "report" | "expense" | "history" | "profil" | "pilotage" | "repos";
export type DriverNavTab = "home" | "report" | "expense" | "pilotage";

/**
 * 7 onglets conservés → 4 dans la barre du bas. Historique et Repos s'ouvrent
 * depuis l'Accueil (onglet Accueil actif) ; le Profil, depuis l'avatar, masque la barre.
 */
export function bottomNavFor(tab: DriverTab): { visible: boolean; active: DriverNavTab | null } {
  switch (tab) {
    case "home":
    case "report":
    case "expense":
    case "pilotage":
      return { visible: true, active: tab };
    case "history":
    case "repos":
      return { visible: true, active: "home" };
    case "profil":
      return { visible: false, active: null };
  }
}

/** Jours restants après aujourd'hui dans le mois (23 sept. → 7). */
export function daysRemainingInMonth(d: Date): number {
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  return daysInMonth - d.getDate();
}

/** « il faut X XOF / jour » = montant restant ÷ jours restants (au moins 1 jour). */
export function dailyNeeded(remaining: number, daysRemaining: number): number {
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return remaining / Math.max(daysRemaining, 1);
}

/** Seuil de confiance de l'extraction vision sous lequel un champ est « à vérifier ». */
export const REVIEW_CONFIDENCE = 0.75;

export function needsReview(confidence: number | null | undefined): boolean {
  return typeof confidence === "number" && confidence < REVIEW_CONFIDENCE;
}

/**
 * Net affiché par l'app (lu sur la capture) comparé au net calculé :
 * « match » à 1 XOF près (arrondis de l'app), « none » si rien n'a été lu.
 */
export function netCheck(netAffiche: number | null | undefined, netCalcule: number, tolerance = 1): "none" | "match" | "mismatch" {
  if (netAffiche == null || !Number.isFinite(netAffiche)) return "none";
  return Math.abs(Math.round(netAffiche) - Math.round(netCalcule)) <= tolerance ? "match" : "mismatch";
}

/**
 * Carte palier (modèle « tiered ») : palier suivant, montant manquant et
 * progression — mêmes règles que l'Accueil actuel (palier courant via
 * salaryLevel, palier suivant = premier seuil au-dessus avec un salaire supérieur).
 */
export function nextTierInfo(
  net: number,
  tiers: SalaryTier[],
  level: SalaryTier,
): { next: SalaryTier | null; missing: number; progressPct: number } {
  const next = tiers.find((r) => r.min_net > net && r.total_salary > level.total_salary) ?? null;
  if (!next) return { next: null, missing: 0, progressPct: 100 };
  const span = next.min_net - level.min_net;
  const progressPct = span > 0 ? Math.max(0, Math.min(100, ((net - level.min_net) / span) * 100)) : 100;
  return { next, missing: next.min_net - net, progressPct };
}

export interface CalendarCell {
  date: string | null; // AAAA-MM-JJ, null = case vide avant le 1er
  day: number | null;
}

/** Grille du mois, semaine commençant le lundi. `month0` : 0 = janvier. */
export function buildMonthGrid(year: number, month0: number): CalendarCell[] {
  const first = new Date(year, month0, 1);
  const lead = (first.getDay() + 6) % 7; // lundi = 0
  const days = new Date(year, month0 + 1, 0).getDate();
  const mm = String(month0 + 1).padStart(2, "0");
  const cells: CalendarCell[] = Array.from({ length: lead }, () => ({ date: null, day: null }));
  for (let d = 1; d <= days; d++) cells.push({ date: `${year}-${mm}-${String(d).padStart(2, "0")}`, day: d });
  return cells;
}

export type DayStatus = "approved" | "submitted" | "rejected" | "repos" | null;

/**
 * État d'un jour à partir de ses rapports : le rapport actif l'emporte
 * (validé > en attente), sinon un rejet. Un rapport « [REPOS] » actif = repos.
 * Les rapports archivés sont ignorés.
 */
export function dayStatus(reports: { status?: string | null; comment?: string | null }[]): DayStatus {
  const live = reports.filter((r) => r.status !== "archived");
  const isRepos = (r: { comment?: string | null }) => (r.comment || "").startsWith("[REPOS]");
  const active = live.find((r) => r.status === "approved") ?? live.find((r) => r.status === "submitted");
  if (active) return isRepos(active) ? "repos" : (active.status as "approved" | "submitted");
  if (live.some((r) => r.status === "rejected")) return "rejected";
  return null;
}

const JOURS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
const JOURS_COURTS = ["Dim.", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."];
const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

/** « Mardi 23 septembre » */
export function longDateFr(d: Date): string {
  return `${JOURS[d.getDay()]} ${d.getDate()} ${MOIS[d.getMonth()]}`;
}

/** « septembre » */
export function monthNameFr(month0: number): string {
  return MOIS[((month0 % 12) + 12) % 12];
}

/** « 2026-09-22 » → « Lun. 22/09 » */
export function shortDayFr(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  return `${JOURS_COURTS[dt.getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

/** Salutation selon l'heure locale : Bonsoir à partir de 18 h. */
export function greeting(hour: number): string {
  return hour >= 18 || hour < 4 ? "Bonsoir" : "Bonjour";
}

/** Prénom pour la salutation (« Moussa Diop » → « Moussa »). */
export function firstName(fullName: string | null | undefined): string {
  return (fullName || "").trim().split(/\s+/)[0] || "";
}

/** Montant saisi (« 8 000 », « 8000,5 ») → nombre ; vide ou invalide → 0. */
export function parseAmountInput(raw: string): number {
  const v = parseFloat(String(raw).replace(/[\s  ]/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
}
