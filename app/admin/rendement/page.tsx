"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { useUiV2 } from "@/components/v2/useUiV2";
import AdminFrameV2 from "@/components/v2/admin/AdminFrameV2";
import { RendementV2, type RendementPayload, type PeriodeRendement } from "@/components/v2/admin/RendementV2";
import { VueDefautMenu } from "@/components/v2/admin/VueDefautMenu";
import { defaultPeriod } from "@/lib/v2/periodFilter";
import { figerPeriode, lireVueDefaut, ecrireVueDefaut, type VueDefaut } from "@/lib/v2/vueDefaut";

/**
 * Performance → Rendement. La page ne fait que demander le calcul pour la
 * période choisie ; tout l'affichage est dans RendementV2.
 */
export default function RendementPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const uiV2 = useUiV2();
  const [periode, setPeriode] = useState<PeriodeRendement>({ jours: 90, du: null, au: null });
  const [vue, setVue] = useState<VueDefaut | null>(null);
  const [vuePrete, setVuePrete] = useState(false);
  // La période de Rendement fait partie de la vue par défaut du gestionnaire.
  useEffect(() => {
    if (!user?.id) return;
    const v = lireVueDefaut(user.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lecture de l'appareil après montage
    setVue(v);
    if (v?.rendement) setPeriode(v.rendement);
    setVuePrete(true);
  }, [user?.id]);
  const [data, setData] = useState<RendementPayload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => { if (!loading && !user) router.push("/auth/login"); }, [user, loading, router]);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setBusy(true); setError(null);
    try {
      const qs = periode.du && periode.au ? `du=${periode.du}&au=${periode.au}` : `jours=${periode.jours}`;
      const res = await fetch(`/api/admin/rendement?${qs}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      if (my === seq.current) setData(json);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : "Calcul impossible");
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, [periode]);

  // attendre la vue par défaut : sinon on calculerait 90 jours pour rien avant de recalculer sa période
  useEffect(() => { if (user && vuePrete) void Promise.resolve().then(load); }, [user, vuePrete, load]);

  if (loading || !user) return null;

  const menuVue = (
    <VueDefautMenu existe={!!vue?.rendement}
      onEnregistrer={() => {
        // complète la vue existante, ou en crée une avec les réglages ordinaires du tableau de bord
        const v: VueDefaut = { ...(vue ?? { periode: figerPeriode(defaultPeriod(new Date()), new Date()), chauffeurs: [], segment: "all", horsYango: true }), rendement: periode };
        ecrireVueDefaut(user.id, v); setVue(v);
      }}
      onAppliquer={() => { if (vue?.rendement) setPeriode(vue.rendement); }}
      onOublier={() => { if (vue) { const { rendement: _r, ...reste } = vue; void _r; ecrireVueDefaut(user.id, reste); setVue(reste); } }} />
  );
  const ecran = <RendementV2 data={data} periode={periode} onPeriode={setPeriode} loading={busy} error={error} entete={menuVue} />;
  if (uiV2) return <AdminFrameV2 tab="rendement">{ecran}</AdminFrameV2>;
  return <main style={{ minHeight: "100vh", background: "var(--sk-deep)", padding: "24px 20px 64px" }}>{ecran}</main>;
}
