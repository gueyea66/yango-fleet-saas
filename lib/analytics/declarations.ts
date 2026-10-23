/**
 * Suivi des déclarations : qui a déclaré quoi, jour par jour, et ce qui manque.
 *
 * Fonction PURE : chauffeurs, rapports, dépenses (et courses Yango quand elles
 * existent) en entrée, une grille chauffeur × jour en sortie. Rien n'est
 * stocké ; l'écran recalcule à chaque ouverture.
 *
 * Ce qui est attendu d'un chauffeur sous contrat, pour chaque jour ÉCHU :
 *   - une déclaration de recette, ou un repos déclaré ;
 *   - si la journée est travaillée, des chiffres (une déclaration à zéro sans
 *     repos est signalée : elle ne dit ni « j'ai roulé » ni « j'étais au repos ») ;
 *   - du carburant : une dépense « Carburant » le jour même ou la veille
 *     travaillée. Un plein ne se fait pas tous les jours ; deux journées
 *     travaillées de suite sans carburant déclaré, en revanche, se signalent.
 *
 * Le jour en cours n'est jamais dû : les rapports se soumettent en fin de
 * journée (même règle que la relance, app/api/admin/remind-drivers).
 *
 * Quand les courses Yango sont importées, elles servent de témoin : des courses
 * un jour sans déclaration, ou un jour déclaré « repos », sont une incohérence.
 */
import { lireAbsence, type CategorieAbsence } from "@/lib/absence";
import { isDriverActiveOn, type DriverActivityFields } from "@/lib/drivers";

export const CAT_CARBURANT = "Carburant";
/** Journées travaillées consécutives sans carburant déclaré avant de signaler. */
export const JOURS_SANS_CARBURANT_TOLERES = 1;

export interface ChauffeurLigne extends DriverActivityFields {
  id: string;
  full_name?: string | null;
  driver_id?: string | null;
  yango_driver_id?: string | null;
  plate?: string | null;
}
export interface RapportLigne {
  driver_id: string;
  date: string;
  status?: string | null;
  comment?: string | null;
  source?: string | null;
  yango_gross?: number | null;
  off_yango_revenue?: number | null;
  gross_earnings?: number | null;
  yango_trip_count?: number | null;
  off_yango_trip_count?: number | null;
}
export interface DepenseLigne {
  driver_id: string | null;
  category?: string | null;
  amount?: number | null;
  status?: string | null;
  expense_date?: string | null;
  created_at?: string | null;
}
/** Courses Yango terminées, déjà comptées par chauffeur (identifiant Yango) et par jour. */
export type CoursesYango = Map<string, number>;
export const cleCourses = (yangoDriverId: string, jour: string) => `${yangoDriverId}|${jour}`;

export type EtatRecette = "declaree" | "attente" | "repos" | "sans_chiffre" | "manquante" | "en_cours" | "hors_contrat";
export type EtatCarburant = "ok" | "attente" | "absent" | "sans_objet";
export type Alerte = "declaration_manquante" | "sans_chiffre" | "carburant_manquant" | "roule_sans_declarer" | "repos_mais_roule";

export const ALERTES: { key: Alerte; label: string; phrase: string }[] = [
  { key: "declaration_manquante", label: "Déclarations manquantes", phrase: "aucune recette ni repos déclaré" },
  { key: "sans_chiffre", label: "Sans chiffre", phrase: "déclaration à zéro, sans repos déclaré" },
  { key: "carburant_manquant", label: "Carburant manquant", phrase: "journées travaillées sans carburant déclaré" },
  { key: "roule_sans_declarer", label: "Roulé sans déclarer", phrase: "des courses Yango, mais aucune recette déclarée" },
  { key: "repos_mais_roule", label: "Repos mais roulé", phrase: "repos déclaré, mais des courses Yango ce jour-là" },
];

export interface Case {
  jour: string;
  recette: EtatRecette;
  /** Recette déclarée du jour (Yango + hors Yango) ; null sans déclaration. */
  ca: number | null;
  source: string | null;
  /** Le seul rapport du jour a été rejeté : à refaire. */
  rejetee: boolean;
  carburant: EtatCarburant;
  depenses: { nombre: number; montant: number; enAttente: number };
  coursesYango: number | null;
  alertes: Alerte[];
  /** Type d'absence quand la journée est un « repos » au sens large (repos, panne, congé, malade). */
  absence: CategorieAbsence | null;
}
export interface LigneChauffeur {
  id: string;
  nom: string;
  plaque: string | null;
  cases: Case[];
  dus: number;
  enRegle: number;
  alertes: Record<Alerte, number>;
  /** Dernier jour avec une dépense de carburant, toutes périodes lues confondues. */
  dernierCarburant: string | null;
}
export interface SuiviDeclarations {
  du: string;
  au: string;
  aujourdhui: string;
  jours: string[];
  chauffeurs: LigneChauffeur[];
  total: { dus: number; enRegle: number; taux: number | null; alertes: Record<Alerte, number>; chauffeursConcernes: number };
  /** Anciens chauffeurs (plus actifs aujourd'hui) sous contrat sur la fenêtre, masqués ou non selon le filtre. */
  anciens: number;
  /** Les courses Yango sont-elles disponibles pour servir de témoin ? */
  temoinYango: boolean;
  aTraiter: { chauffeurId: string; nom: string; jour: string; alerte: Alerte; detail: string }[];
}

const jourSuivant = (iso: string, n = 1) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const estRepos = (r: RapportLigne) => lireAbsence(r.comment) != null;
const recetteDe = (r: RapportLigne) => {
  const detail = (r.yango_gross ?? 0) + (r.off_yango_revenue ?? 0);
  return detail > 0 ? detail : r.gross_earnings ?? 0;
};
const zeroAlertes = (): Record<Alerte, number> => ({
  declaration_manquante: 0, sans_chiffre: 0, carburant_manquant: 0, roule_sans_declarer: 0, repos_mais_roule: 0,
});
const montant = (v: number) => Math.round(v).toLocaleString("fr-FR").replace(/ /g, " ");

export function suiviDeclarations(input: {
  chauffeurs: ChauffeurLigne[];
  rapports: RapportLigne[];
  depenses: DepenseLigne[];
  courses?: CoursesYango;
  du: string;
  au: string;
  aujourdhui: string;
  /** Ne montrer que les chauffeurs encore actifs aujourd'hui (défaut : tous ceux sous contrat sur la fenêtre). */
  actifsSeulement?: boolean;
}): SuiviDeclarations {
  const { du, aujourdhui } = input;
  const au = input.au > aujourdhui ? aujourdhui : input.au;
  const jours: string[] = [];
  for (let j = du; j <= au; j = jourSuivant(j)) jours.push(j);
  const temoinYango = Boolean(input.courses?.size);

  // Rapports actifs par chauffeur et jour ; un rapport validé prime sur un rapport en attente.
  const rapports = new Map<string, RapportLigne>();
  const rejetes = new Set<string>();
  for (const r of input.rapports) {
    const k = `${r.driver_id}|${r.date.slice(0, 10)}`;
    if (r.status === "rejected") { rejetes.add(k); continue; }
    const deja = rapports.get(k);
    if (!deja || (deja.status !== "approved" && r.status === "approved")) rapports.set(k, r);
  }

  const depenses = new Map<string, DepenseLigne[]>();
  for (const d of input.depenses) {
    if (!d.driver_id || d.status === "rejected") continue;
    const jour = (d.expense_date ?? d.created_at ?? "").slice(0, 10);
    if (!jour) continue;
    const k = `${d.driver_id}|${jour}`;
    (depenses.get(k) ?? depenses.set(k, []).get(k)!).push(d);
  }

  const aTraiter: SuiviDeclarations["aTraiter"] = [];
  const lignes: LigneChauffeur[] = [];
  let anciens = 0;

  for (const c of input.chauffeurs) {
    // Hors du périmètre : jamais sous contrat sur la fenêtre (compte technique, parti avant, arrivé après).
    if (!jours.some((j) => isDriverActiveOn(c, j, { requireHired: true }))) continue;
    // Parti depuis : il a des journées dues sur la fenêtre, mais plus personne à relancer.
    if (!isDriverActiveOn(c, aujourdhui)) {
      anciens++;
      if (input.actifsSeulement) continue;
    }
    const nom = c.full_name || c.driver_id || "Chauffeur";
    const ligne: LigneChauffeur = { id: c.id, nom, plaque: c.plate?.trim() || null, cases: [], dus: 0, enRegle: 0, alertes: zeroAlertes(), dernierCarburant: null };
    let sansCarburant = 0; // journées travaillées de suite sans carburant déclaré

    for (const jour of jours) {
      const k = `${c.id}|${jour}`;
      const r = rapports.get(k);
      const dep = depenses.get(k) ?? [];
      const carb = dep.filter((d) => d.category === CAT_CARBURANT);
      const courses = temoinYango && c.yango_driver_id ? input.courses!.get(cleCourses(c.yango_driver_id, jour)) ?? 0 : null;
      const sousContrat = isDriverActiveOn(c, jour, { requireHired: true });

      let recette: EtatRecette;
      if (!sousContrat) recette = "hors_contrat";
      else if (!r) recette = jour === aujourdhui ? "en_cours" : "manquante";
      else if (estRepos(r)) recette = "repos";
      else if (recetteDe(r) <= 0 && !(r.yango_trip_count ?? 0) && !(r.off_yango_trip_count ?? 0)) recette = "sans_chiffre";
      else recette = r.status === "approved" ? "declaree" : "attente";

      const travaille = recette === "declaree" || recette === "attente";
      if (carb.length) { sansCarburant = 0; ligne.dernierCarburant = jour; }
      else if (travaille) sansCarburant++;
      const carburant: EtatCarburant = !travaille ? "sans_objet"
        : carb.some((d) => d.status !== "submitted") ? "ok" : carb.length ? "attente" : "absent";

      const alertes: Alerte[] = [];
      if (recette === "manquante") alertes.push(courses ? "roule_sans_declarer" : "declaration_manquante");
      if (recette === "sans_chiffre") alertes.push(courses ? "roule_sans_declarer" : "sans_chiffre");
      if (recette === "repos" && courses) alertes.push("repos_mais_roule");
      if (travaille && !carb.length && sansCarburant > JOURS_SANS_CARBURANT_TOLERES) alertes.push("carburant_manquant");

      const cas: Case = {
        jour, recette, ca: r && !estRepos(r) ? recetteDe(r) : null, source: r?.source ?? null,
        absence: recette === "repos" && r ? lireAbsence(r.comment)!.categorie : null,
        rejetee: !r && rejetes.has(k), carburant,
        depenses: {
          nombre: dep.length, montant: dep.reduce((s, d) => s + (d.amount ?? 0), 0),
          enAttente: dep.filter((d) => d.status === "submitted").length,
        },
        coursesYango: courses, alertes,
      };
      ligne.cases.push(cas);

      if (recette !== "hors_contrat" && recette !== "en_cours") {
        ligne.dus++;
        if (!alertes.length) ligne.enRegle++;
      }
      for (const a of alertes) {
        ligne.alertes[a]++;
        aTraiter.push({
          chauffeurId: c.id, nom, jour, alerte: a,
          detail: a === "declaration_manquante" ? (cas.rejetee ? "rapport rejeté, à refaire" : "ni recette ni repos déclaré")
            : a === "sans_chiffre" ? "déclaration à zéro, sans repos déclaré"
            : a === "carburant_manquant" ? `${sansCarburant} journées travaillées de suite sans carburant déclaré`
            : a === "roule_sans_declarer" ? `${courses} course${courses! > 1 ? "s" : ""} Yango, aucune recette déclarée`
            : `repos déclaré, ${courses} course${courses! > 1 ? "s" : ""} Yango${cas.ca ? ` (${montant(cas.ca)} XOF)` : ""}`,
        });
      }
    }
    lignes.push(ligne);
  }

  const nb = (l: LigneChauffeur) => Object.values(l.alertes).reduce((s, v) => s + v, 0);
  lignes.sort((a, b) => nb(b) - nb(a) || a.nom.localeCompare(b.nom, "fr"));
  aTraiter.sort((a, b) => b.jour.localeCompare(a.jour) || a.nom.localeCompare(b.nom, "fr"));

  const totalAlertes = zeroAlertes();
  let dus = 0, enRegle = 0;
  for (const l of lignes) {
    dus += l.dus; enRegle += l.enRegle;
    for (const a of ALERTES) totalAlertes[a.key] += l.alertes[a.key];
  }
  return {
    du, au, aujourdhui, jours, chauffeurs: lignes, temoinYango, aTraiter, anciens,
    total: { dus, enRegle, taux: dus ? enRegle / dus : null, alertes: totalAlertes, chauffeursConcernes: lignes.filter((l) => nb(l) > 0).length },
  };
}
