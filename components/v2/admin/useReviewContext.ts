import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ReviewContext {
  loaded: boolean;
  plate: string | null;
  extraction: {
    net_affiche: number | null;
    confidences: Record<string, number | null> | null;
    fields_read: number;
    coherence_alerts: { message: string }[];
  } | null;
  prevOdometer: number | null;
  prevDate: string | null;
  gps: { km_gps: number | null; coverage: number | null; points: number | null } | null;
}

/**
 * Lectures d'appui du panneau de détail v2 (aucune écriture) :
 * extraction vision du jour (fleet.ai_extractions, RLS admin_tenant), rapport
 * validé précédent (compteur), km GPS du véhicule ce jour-là
 * (v_telematics_reconciliation) et plaque.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ligne de rapport non typée (convention du projet)
export function useReviewContext(report: any | null): ReviewContext {
  const [ctx, setCtx] = useState<ReviewContext>({ loaded: false, plate: null, extraction: null, prevOdometer: null, prevDate: null, gps: null });

  useEffect(() => {
    if (!report) return;
    let alive = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client non typé sur le schéma fleet
      const sb = createClient() as any;
      const [ext, prev, veh] = await Promise.all([
        sb.from("ai_extractions").select("proposed_values, field_level_confidence, coherence_alerts, status, created_at")
          .eq("tenant_id", report.tenant_id).eq("driver_id", report.driver_id).eq("date_ref", report.date)
          .in("status", ["completed", "validated"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        sb.from("daily_reports").select("date, end_odometer")
          .eq("tenant_id", report.tenant_id).eq("driver_id", report.driver_id).eq("status", "approved")
          .lt("date", report.date).not("end_odometer", "is", null).order("date", { ascending: false }).limit(1).maybeSingle(),
        report.vehicle_id
          ? sb.from("vehicles").select("id, plate").eq("id", report.vehicle_id).maybeSingle()
          : sb.from("vehicles").select("id, plate").eq("driver_id", report.driver_id).limit(1).maybeSingle(),
      ]);
      const vehicle = veh?.data ?? null;
      let gps: ReviewContext["gps"] = null;
      if (vehicle?.id) {
        const { data } = await sb.from("v_telematics_reconciliation").select("km_gps, coverage, points")
          .eq("vehicle_id", vehicle.id).eq("day", report.date).maybeSingle();
        if (data) gps = { km_gps: data.km_gps != null ? Number(data.km_gps) : null, coverage: data.coverage ?? null, points: data.points ?? null };
      }
      const e = ext?.data;
      if (!alive) return;
      setCtx({
        loaded: true,
        plate: vehicle?.plate ?? null,
        extraction: e ? {
          net_affiche: e.proposed_values?.net_affiche ?? null,
          confidences: e.field_level_confidence ?? null,
          fields_read: Object.values(e.proposed_values || {}).filter((v) => v != null).length,
          coherence_alerts: Array.isArray(e.coherence_alerts) ? e.coherence_alerts : [],
        } : null,
        prevOdometer: prev?.data?.end_odometer ?? null,
        prevDate: prev?.data?.date ?? null,
        gps,
      });
    })().catch(() => { if (alive) setCtx((c) => ({ ...c, loaded: true })); });
    return () => { alive = false; };
  }, [report]);

  return ctx;
}
