/**
 * Km des courses Yango (import Fleetroom), rattachés aux véhicules par la plaque.
 *
 * Deux usages :
 *  - rythme d'usure pour l'amortissement quand aucun compteur n'est déclaré
 *    (`kmMoisCoursesParVehicule`, voir `kmParMoisVehicule` dans lib/calc) ;
 *  - km « actifs » Yango jour par jour, à comparer aux km GPS dans le suivi
 *    (`kmCoursesParJour`) : l'écart est fait d'approche et de km à vide.
 *
 * Les commandes portent la plaque lue dans le libellé Fleetroom, déjà
 * normalisée (`normalizePlate`). Les plaques saisies dans l'app peuvent avoir
 * tirets et espaces : `plaqueCle` les ramène à la même forme.
 */
import { fetchAllRows } from "@/lib/fetchAllRows";
import { kmParMoisDepuisCourses } from "@/lib/calc";

/** Fenêtre de mesure du rythme : assez longue pour lisser une immobilisation. */
export const FENETRE_KM_COURSES_JOURS = 60;
const TERMINE = "Terminé";

const CYRILLIQUE: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", У: "Y",
};

/** « AB-872-JG », « ab 872 jg », « АА195SJ » (cyrillique) → « AB872JG » / « AA195SJ ». */
export function plaqueCle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const p = raw.toUpperCase().replace(/[АВЕКМНОРСТХУ]/g, (c) => CYRILLIQUE[c]).replace(/[^A-Z0-9]/g, "");
  return p || null;
}

const jourMoins = (jour: string, n: number) =>
  new Date(Date.parse(`${jour}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/**
 * Km/mois en course par véhicule, sur les `FENETRE_KM_COURSES_JOURS` derniers
 * jours. Un véhicule sans course mesurable est absent de la table.
 * `sb` : client sur le schéma fleet (service ou admin du tenant).
 */
export async function kmMoisCoursesParVehicule(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, tenantId: string, vehicles: Array<{ id: string; plate?: string | null }>,
  today = new Date().toISOString().slice(0, 10),
): Promise<Map<string, number>> {
  const idParPlaque = new Map<string, string>();
  for (const v of vehicles) {
    const p = plaqueCle(v.plate);
    if (p) idParPlaque.set(p, v.id);
  }
  const out = new Map<string, number>();
  if (idParPlaque.size === 0) return out;

  const rows = await fetchAllRows<{ plate: string | null; jour: string | null; distance_m: number | null }>(() =>
    sb.from("yango_orders").select("plate,jour,distance_m")
      .eq("tenant_id", tenantId).eq("status", TERMINE)
      .in("plate", [...idParPlaque.keys()])
      .gte("jour", jourMoins(today, FENETRE_KM_COURSES_JOURS)).lte("jour", today)
      .order("jour").order("order_id"));

  const parPlaque = new Map<string, Array<{ jour: string | null; distance_m: number | null }>>();
  for (const r of rows) {
    const p = plaqueCle(r.plate);
    if (!p) continue;
    (parPlaque.get(p) ?? parPlaque.set(p, []).get(p)!).push(r);
  }
  for (const [p, courses] of parPlaque) {
    const km = kmParMoisDepuisCourses(courses);
    const id = idParPlaque.get(p);
    if (id && km != null) out.set(id, km);
  }
  return out;
}

/** Km en course et nombre de courses terminées, jour par jour, pour une plaque. */
export async function kmCoursesParJour(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: any, tenantId: string, plate: string | null | undefined, from: string, to: string,
): Promise<Map<string, { km: number; courses: number }>> {
  const out = new Map<string, { km: number; courses: number }>();
  const p = plaqueCle(plate);
  if (!p) return out;
  const rows = await fetchAllRows<{ jour: string | null; distance_m: number | null }>(() =>
    sb.from("yango_orders").select("jour,distance_m")
      .eq("tenant_id", tenantId).eq("status", TERMINE).eq("plate", p)
      .gte("jour", from).lte("jour", to)
      .order("jour").order("order_id"));
  for (const r of rows) {
    if (!r.jour) continue;
    const d = out.get(r.jour) ?? { km: 0, courses: 0 };
    d.km += (r.distance_m ?? 0) / 1000;
    d.courses += 1;
    out.set(r.jour, d);
  }
  return out;
}
