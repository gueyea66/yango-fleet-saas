/**
 * Contrôles de cohérence DÉTERMINISTES post-extraction — jamais de LLM ici
 * (règle d'or : le LLM ne calcule pas, ne juge pas les chiffres — l'arithmétique
 * de contrôle vit dans du code, pas dans le modèle).
 * Lecture seule sur fleet.daily_reports (table métier existante, non modifiée).
 * Alertes informatives, non bloquantes : le chauffeur peut corriger ou ignorer.
 */

import { aiAdmin } from "./adminClient";
import { ExtractedFields } from "./extractionParser";

export interface CoherenceAlert {
  field: string;
  type: "odometer_rollback" | "gross_anomaly" | "net_mismatch";
  message: string;
}

const fmt = (n: number) => n.toLocaleString("fr-FR");

/**
 * Contre-vérification ARITHMÉTIQUE pure (code, testable) : sur l'écran Yango
 * Pro, espèces + carte + bonus − commission service − commission partenaire −
 * services supplémentaires = net affiché. Si les valeurs lues ne se recoupent
 * pas (tolérance 5 FCFA d'arrondi), au moins une lecture est fausse → alerte.
 */
export function checkNetCoherence(fields: ExtractedFields): CoherenceAlert | null {
  if (fields.net_affiche === null) return null;
  // Sans le champ principal (espèces), la reconstitution n'a pas de sens.
  if (fields.yango_cash === null) return null;
  const expected =
    (fields.yango_cash ?? 0) +
    (fields.yango_card ?? 0) +
    (fields.yango_bonus ?? 0) -
    (fields.commission_yango ?? 0) -
    (fields.commission_partenaire ?? 0) -
    (fields.services_supplementaires ?? 0);
  if (Math.abs(expected - fields.net_affiche) <= 5) return null;
  return {
    field: "net_affiche",
    type: "net_mismatch",
    message: `Les montants lus ne se recoupent pas : espèces + carte + bonus − commissions − services = ${fmt(expected)} FCFA, mais l'écran affiche un net de ${fmt(fields.net_affiche)} FCFA — vérifie chaque champ avant de soumettre.`,
  };
}

/**
 * Contrôles complets :
 *  - net_mismatch : reconstitution du net affiché (pur, synchrone)
 *  - odometer_rollback : le km extrait ne peut pas être inférieur au dernier
 *    km validé du chauffeur (un compteur ne recule jamais)
 * (V1 ajoutera gross_anomaly vs médiane 7 jours.)
 */
export async function runCoherenceChecks(
  tenantId: string,
  driverId: string,
  dateRef: string,
  fields: ExtractedFields
): Promise<CoherenceAlert[]> {
  const alerts: CoherenceAlert[] = [];

  const netAlert = checkNetCoherence(fields);
  if (netAlert) alerts.push(netAlert);

  if (fields.end_odometer !== null) {
    try {
      const { data } = await aiAdmin()
        .from("daily_reports")
        .select("end_odometer, date")
        .eq("tenant_id", tenantId)
        .eq("driver_id", driverId)
        .lt("date", dateRef)
        .in("status", ["submitted", "approved"])
        .gt("end_odometer", 0)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastKm = data?.end_odometer as number | undefined;
      if (typeof lastKm === "number" && lastKm > 0 && fields.end_odometer < lastKm) {
        alerts.push({
          field: "end_odometer",
          type: "odometer_rollback",
          message: `Kilométrage lu (${fmt(fields.end_odometer)} km) inférieur au dernier rapport (${fmt(lastKm)} km le ${data?.date}) — vérifie la photo du compteur.`,
        });
      }
    } catch (err) {
      // Un contrôle de cohérence ne doit jamais faire échouer l'extraction
      console.error("[ai/coherenceChecks] lecture historique impossible:", String(err).slice(0, 200));
    }
  }

  return alerts;
}
