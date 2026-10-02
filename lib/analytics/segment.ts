/**
 * Segment (interne / partenaire) d'une ligne d'activité, pour le filtre
 * « type de véhicule » de Performance.
 *
 * Ordre de résolution : le véhicule déclaré sur la ligne (vehicle_id, ou la
 * plaque d'une commande Fleetroom), sinon le véhicule actuellement affecté au
 * chauffeur, sinon « interne » (même repli que segmentDe).
 */
import { segmentDe, type Segment } from "@/lib/fleetSegment";

export type SegmentFilter = Segment | "all";
export const isSegmentFilter = (s: string | null): s is SegmentFilter => s === "all" || s === "interne" || s === "partenaire";

export interface VehicleLite {
  id: string;
  driver_id?: string | null;
  plate?: string | null;
  fleet_segment?: string | null;
}

const normPlate = (p?: string | null) => (p || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function segmentResolver(vehicles: VehicleLite[]) {
  const byId = new Map(vehicles.map((v) => [v.id, segmentDe(v)]));
  const byPlate = new Map(vehicles.filter((v) => v.plate).map((v) => [normPlate(v.plate), segmentDe(v)]));
  const byDriver = new Map<string, Segment>();
  for (const v of vehicles) if (v.driver_id) byDriver.set(v.driver_id, segmentDe(v));
  const ofDriver = (driverId?: string | null): Segment => (driverId && byDriver.get(driverId)) || "interne";
  return {
    ofDriver,
    ofReport: (r: { vehicle_id?: string | null; driver_id?: string | null }): Segment =>
      (r.vehicle_id && byId.get(r.vehicle_id)) || ofDriver(r.driver_id),
    ofPlate: (plate: string | null | undefined, driverId?: string | null): Segment =>
      (plate && byPlate.get(normPlate(plate))) || ofDriver(driverId),
    counts: (): Record<Segment, number> => {
      const c: Record<Segment, number> = { interne: 0, partenaire: 0 };
      for (const v of vehicles) c[segmentDe(v)]++;
      return c;
    },
  };
}
