"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { useTenant } from "@/lib/tenant/context";
import { createClient } from "@/lib/supabase/client";
import AdminShellV2 from "./AdminShellV2";

/**
 * Coque v2 pour les pages gestionnaire séparées (suivi GPS, boîtiers) : même
 * sidebar que /admin, le contenu reste celui de la page actuelle. Un clic sur
 * une destination interne ouvre /admin?tab=… (lu par /admin drapeau allumé).
 */
export default function AdminFrameV2({ tab, children }: { tab: string; children: ReactNode }) {
  const { user, signOut } = useAuth();
  const { settings } = useTenant();
  const router = useRouter();
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client non typé sur le schéma fleet
      const sb = createClient() as any;
      const { data } = await sb.from("profiles").select("tenant_id").eq("id", user.id).maybeSingle();
      if (alive && data?.tenant_id) setTenantId(data.tenant_id);
    })();
    return () => { alive = false; };
  }, [user]);

  return (
    <AdminShellV2
      tab={tab}
      onTab={(t) => router.push(`/admin?tab=${encodeURIComponent(t)}`)}
      appName={settings.app_name}
      operatorName={settings.operator_name}
      userName={user?.user_metadata?.full_name || user?.email || "Admin"}
      tenantId={tenantId}
      sessionError={null}
      onSignOut={() => signOut()}
      onReconnect={() => signOut()}
      filters={{ drivers: [], driverId: "", onDriverChange: () => {} }}
    >
      <div className="v2-embed">{children}</div>
    </AdminShellV2>
  );
}
