/**
 * Contrôles de cohérence DÉTERMINISTES post-extraction — jamais de LLM ici
 * (règle d'or : le LLM ne calcule pas, ne juge pas les chiffres).
 * Lecture seule sur fleet.daily_reports (table métier existante, non modifiée).
 * Alertes informatives, non bloquantes : le chauffeur peut corriger ou ignorer.
 */

import { aiAdmin } from "./adminClient";
import { ExtractedFields } from "./extractionParser";

export interface CoherenceAlert {
  field: string;
  type: "odometer_rollback" | "gross_anomaly";
  message: string;
}

const fmtKm = (n: number) => n.toLocaleString("fr-FR");

/**
 * MVP : contrôle odometer_rollback — le km extrait ne peut pas être inférieur
 * au dernier km validé du chauffeur (un compteur ne recule jamais).
 * (V1 ajoutera gross_anomaly vs médiane 7 jours.)
 */
export async function runCoherenceChecks(
  tenantId: string,
  driverId: string,
  dateRef: string,
  fields: ExtractedFields
): Promise<CoherenceAlert[]> {
  const alerts: CoherenceAlert[] = [];

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
          message: `Kilométrage lu (${fmtKm(fields.end_odometer)} km) inférieur au dernier rapport (${fmtKm(lastKm)} km le ${data?.date}) — vérifie la photo du compteur.`,
        });
      }
    } catch (err) {
      // Un contrôle de cohérence ne doit jamais faire échouer l'extraction
      console.error("[ai/coherenceChecks] lecture historique impossible:", String(err).slice(0, 200));
    }
  }

  return alerts;
}
