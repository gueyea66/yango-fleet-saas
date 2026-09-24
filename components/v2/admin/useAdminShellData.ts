import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getTrialStatus, type TrialStatus } from "@/lib/plans";

/**
 * Lectures de la coque admin v2 (aucune écriture) :
 * - échéance d'essai / abonnement : mêmes colonnes que TrialBanner ;
 * - nombre d'éléments « À valider » (rapports + dépenses soumis) pour le badge.
 */
export function useAdminShellData(tenantId: string | null, refreshKey: unknown) {
  const [trial, setTrial] = useState<{ status: TrialStatus; expiresAt: string | null } | null>(null);
  const [pending, setPending] = useState<number | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client non typé sur le schéma fleet (convention du projet)
      const sb = createClient() as any;
      const { data: tenant } = await sb.from("tenants").select("trial_ends_at, plan_expires_at").eq("id", tenantId).maybeSingle();
      if (alive && tenant) {
        setTrial({ status: getTrialStatus(tenant.trial_ends_at, tenant.plan_expires_at), expiresAt: tenant.plan_expires_at ?? tenant.trial_ends_at });
      }
    })();
    return () => { alive = false; };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    let alive = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- idem
      const sb = createClient() as any;
      const [r, e] = await Promise.all([
        sb.from("daily_reports").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "submitted"),
        sb.from("expenses").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "submitted"),
      ]);
      if (alive) setPending((r?.count ?? 0) + (e?.count ?? 0));
    })();
    return () => { alive = false; };
  }, [tenantId, refreshKey]);

  return { trial, pending };
}
