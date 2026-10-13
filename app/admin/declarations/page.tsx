"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { useUiV2 } from "@/components/v2/useUiV2";
import AdminFrameV2 from "@/components/v2/admin/AdminFrameV2";
import { DeclarationsV2, type DeclarationsPayload } from "@/components/v2/admin/DeclarationsV2";

/**
 * À valider → Déclarations. La page ne fait que demander le suivi pour la
 * fenêtre choisie ; l'affichage et les actions sont dans DeclarationsV2.
 */
export default function DeclarationsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const uiV2 = useUiV2();
  const [jours, setJours] = useState(14);
  const [data, setData] = useState<DeclarationsPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => { if (!loading && !user) router.push("/auth/login"); }, [user, loading, router]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/admin/declarations?jours=${jours}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      if (my === seq.current) setData(json);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : "Lecture impossible");
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, [jours]);

  useEffect(() => { if (user) void Promise.resolve().then(load); }, [user, load]);

  if (loading || !user) return null;

  const ecran = <DeclarationsV2 data={data} jours={jours} onJours={setJours} loading={busy} error={error} onRecharger={load} />;
  if (uiV2) return <AdminFrameV2 tab="declarations">{ecran}</AdminFrameV2>;
  return <main style={{ minHeight: "100vh", background: "var(--sk-deep)", padding: "24px 20px 64px" }}>{ecran}</main>;
}
