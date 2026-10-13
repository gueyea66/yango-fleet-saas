"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { useUiV2 } from "@/components/v2/useUiV2";
import AdminFrameV2 from "@/components/v2/admin/AdminFrameV2";
import { RendementV2, type RendementPayload } from "@/components/v2/admin/RendementV2";

/**
 * Performance → Rendement. La page ne fait que demander le calcul pour la
 * période choisie ; tout l'affichage est dans RendementV2.
 */
export default function RendementPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const uiV2 = useUiV2();
  const [jours, setJours] = useState(90);
  const [data, setData] = useState<RendementPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => { if (!loading && !user) router.push("/auth/login"); }, [user, loading, router]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/rendement?jours=${jours}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      if (my === seq.current) setData(json);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : "Calcul impossible");
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, [jours]);

  useEffect(() => { if (user) void Promise.resolve().then(load); }, [user, load]);

  if (loading || !user) return null;

  const ecran = <RendementV2 data={data} jours={jours} onJours={setJours} loading={busy} error={error} />;
  if (uiV2) return <AdminFrameV2 tab="rendement">{ecran}</AdminFrameV2>;
  return <main style={{ minHeight: "100vh", background: "var(--sk-deep)", padding: "24px 20px 64px" }}>{ecran}</main>;
}
