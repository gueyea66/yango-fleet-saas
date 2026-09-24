/**
 * Navigation gestionnaire v2 : 13+ onglets actuels → 6 + 2 destinations.
 * Les identifiants d'onglets NE changent PAS (`pending`, `history`,
 * `calendrier`…) : chaque destination regroupe des onglets existants en
 * sous-onglets, donc l'état, les liens et les tests restent valables.
 */
import type { FilterPeriod } from "./filters";

export type AdminDestination = "dash" | "valid" | "pilot" | "fleet" | "team" | "fin" | "hist" | "set";

export interface SubTab {
  tab: string;       // identifiant d'onglet existant
  label: string;
  route?: string;    // onglet qui ouvre sa propre page (NAV_ROUTES actuel)
  /** raccourci v2 vers un écran existant sous un autre identifiant (hors coveredTabs) */
  extra?: boolean;
}

export interface DestinationDef {
  key: AdminDestination;
  label: string;
  secondary?: boolean;           // sous le séparateur (Historique, Paramètres)
  menu?: boolean;                // sous-onglets en menu local vertical (Paramètres, 4d)
  subTabs: SubTab[];
  /** Blocs de la FilterBar (README) — aucun = pas de barre. */
  filter: { period?: boolean; dates?: boolean; driver?: boolean };
}

export const ADMIN_DESTINATIONS: DestinationDef[] = [
  { key: "dash", label: "Tableau de bord", subTabs: [{ tab: "dashboard", label: "Tableau de bord" }], filter: { period: true, driver: true } },
  { key: "valid", label: "À valider", subTabs: [{ tab: "pending", label: "À valider" }], filter: { period: true, driver: true } },
  { key: "pilot", label: "Pilotage", subTabs: [{ tab: "pilotage", label: "Pilotage" }], filter: {} },
  {
    key: "fleet", label: "Véhicules", filter: {},
    subTabs: [
      { tab: "vehicles", label: "Véhicules" },
      { tab: "suivi", label: "Suivi GPS", route: "/admin/suivi" },
      { tab: "boitiers", label: "Boîtiers", route: "/admin/boitiers" },
    ],
  },
  {
    key: "team", label: "Équipe", filter: {},
    subTabs: [
      { tab: "drivers", label: "Conducteurs", route: "/admin/drivers" },
      { tab: "kyc", label: "KYC" },
    ],
  },
  {
    key: "fin", label: "Finance", filter: { period: true, driver: true },
    subTabs: [
      { tab: "payments", label: "Paiements" },
      { tab: "avances", label: "Avances" },
      // Journal (ActionLogsTab) aussi visible ici ; l'onglet « journal » reste dans Paramètres.
      { tab: "finjournal", label: "Journal", extra: true },
    ],
  },
  {
    key: "hist", label: "Historique", secondary: true, filter: { period: true, driver: true },
    subTabs: [
      { tab: "history", label: "Calendrier" },
      { tab: "calendrier", label: "Planning" },
    ],
  },
  {
    key: "set", label: "Paramètres", secondary: true, menu: true, filter: {},
    subTabs: [
      { tab: "settings", label: "Entreprise & marque" },
      { tab: "remuneration", label: "Rémunération" },
      { tab: "import", label: "Import historique" },
      { tab: "journal", label: "Journal" },
    ],
  },
];

/** Destination d'un onglet existant (onglet inconnu → Tableau de bord). */
export function destinationFor(tab: string): DestinationDef {
  return ADMIN_DESTINATIONS.find((d) => d.subTabs.some((s) => s.tab === tab)) ?? ADMIN_DESTINATIONS[0];
}

/** Onglet ouvert au clic sur une destination : le premier sous-onglet interne. */
export function entryTab(dest: DestinationDef): SubTab {
  return dest.subTabs.find((s) => !s.route) ?? dest.subTabs[0];
}

/** Tous les identifiants d'onglets couverts (contrôle : aucun onglet perdu). */
export function coveredTabs(): string[] {
  return ADMIN_DESTINATIONS.flatMap((d) => d.subTabs.filter((s) => !s.extra).map((s) => s.tab));
}

/**
 * Période de la FilterBar ↔ sélection de mois existante (filterMonths).
 * Le tableau de bord actuel raisonne en mois : « Mois » = un mois, « Année » =
 * les 12. Jour / 7 j ne sont pas exprimables sans toucher aux hooks (écart).
 */
export function periodFromMonths(months: number[]): FilterPeriod {
  return months.length >= 12 ? "annee" : "mois";
}

export function monthsForPeriod(period: FilterPeriod, currentMonth: number): number[] {
  return period === "annee" ? Array.from({ length: 12 }, (_, i) => i + 1) : [currentMonth];
}
