/* eslint-disable @typescript-eslint/no-explicit-any -- client Supabase non typé (convention du projet) */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DriverSegmentLite } from "./segment";

/**
 * Segment choisi par le gestionnaire pour chaque chauffeur (profiles.fleet_segment,
 * migration 078). Lecture à part : avant la migration la colonne n'existe pas, on
 * renvoie alors une liste vide et le segment reste déduit du véhicule.
 */
export async function readDriverSegments(admin: SupabaseClient<any, any, any>, tenantId: string): Promise<DriverSegmentLite[]> {
  const { data, error } = await admin.from("profiles").select("id, fleet_segment")
    .eq("tenant_id", tenantId).not("fleet_segment", "is", null);
  if (error) return [];
  return (data || []) as DriverSegmentLite[];
}
