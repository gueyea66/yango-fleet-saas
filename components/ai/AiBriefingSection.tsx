"use client";

/**
 * Couche IA V3 — section briefing + insights + recommandations (SCR-01).
 * 100% additive : si la couche est coupée (204) ou en erreur, le composant
 * rend `null` — le dashboard est identique à la V2, aucun trou, aucun spinner.
 * Sémiologie : chiffres = badge bleu « Calculé » ; texte LLM = badge ambre « IA ».
 */
import React, { useEffect, useState } from "react";
import { Sparkles, Calculator, ChevronDown, ChevronUp, CheckCircle2, XCircle } from "lucide-react";

const fmt = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n || 0));
// Les anciens contenus stockés peuvent contenir du markdown brut (**) — nettoyé à l'affichage
const stripMd = (s: string) => s.replace(/\*\*/g, "").trim();

const KPI_LABELS: Record<string, string> = {
  net_operationnel: "Net opérationnel (7 j)",
  carburant_km: "Carburant / km",
  taux_soumission: "Taux de soumission",
};
const CAUSE_LABELS: Record<string, string> = {
  recettes: "Recettes",
  solde_consomme: "Solde Yango consommé",
  carburant_consomme: "Carburant consommé",
  depenses_ope: "Dépenses opérationnelles",
};

function CalcBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-blue-500/15 text-blue-400" title="Chiffre issu du moteur de calcul déterministe">
      <Calculator size={9} /> Calculé
    </span>
  );
}
function AiBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide bg-amber-500/15 text-amber-400" title="Texte rédigé par IA à partir des chiffres calculés">
      <Sparkles size={9} /> IA
    </span>
  );
}

interface Briefing {
  briefing_date: string;
  status: string;
  computed_at: string;
  confidence_score: number;
  has_newer_data: boolean;
  is_today?: boolean;
  content_json: {
    narrative_fr: string | null;
    narrative_points?: string[] | null;
    action_fr?: string | null;
    narrative_source?: "llm" | "deterministic" | null;
    degraded_message_fr: string | null;
    kpis: Array<{ kpi_name: string; value: number; unit: string; delta_pct_wow: number | null }>;
    projections: { net_projete_fcfa: number; jours_restants_mois: number };
  };
}
interface Insight {
  id: string; kpi_name: string; delta_value: number; delta_pct: number | null;
  narrative_fr: string | null; is_stale: boolean; period_start: string; period_end: string;
  causes: Array<{ component: string; delta_fcfa: number; contribution_pct: number }>;
}
interface Reco {
  id: string; priority: string; impact_fcfa: number; title_fr: string;
  detail_fr: string | null; status: string;
}

export default function AiBriefingSection() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [recos, setRecos] = useState<Reco[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [openInsight, setOpenInsight] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const b = await fetch("/api/ai/briefing/today");
        if (!alive || b.status === 204 || !b.ok) return; // couche coupée → rien
        const bj = await b.json();
        if (!bj?.ai_layer_enabled) return;
        setEnabled(true);
        setBriefing(bj.briefing ?? null);

        const [i, r] = await Promise.all([
          fetch("/api/ai/insights").then((x) => (x.ok && x.status !== 204 ? x.json() : null)).catch(() => null),
          fetch("/api/ai/recommendations").then((x) => (x.ok && x.status !== 204 ? x.json() : null)).catch(() => null),
        ]);
        if (!alive) return;
        setInsights(i?.insights ?? []);
        setRecos((r?.recommendations ?? []).slice(0, 3));
      } catch {
        /* couche IA silencieuse en cas d'erreur — jamais de régression V2 */
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!enabled) return null;

  const c = briefing?.content_json;

  const setRecoStatus = async (id: string, status: "acted_on" | "ignored") => {
    setRecos((prev) => prev.filter((r) => r.id !== id));
    await fetch(`/api/ai/recommendations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).catch(() => {});
  };

  return (
    <div className="mb-6 rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-4">
      {/* ── Briefing du jour ── */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-white/90">
            Briefing {briefing ? `du ${briefing.briefing_date}` : "quotidien"}
          </h3>
          {briefing && (
            <span className="text-[10px] text-white/40">
              calculé {new Date(briefing.computed_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              {" · confiance "}{Math.round((briefing.confidence_score ?? 0) * 100)}%
              {briefing.has_newer_data && " · nouvelles données disponibles"}
            </span>
          )}
        </div>

        {!briefing && (
          <p className="mt-2 text-xs text-white/50">
            Le premier briefing sera généré au prochain batch (06h00). Les chiffres du dashboard restent la référence.
          </p>
        )}

        {/* Briefing structuré : points courts + action mise en avant */}
        {c?.narrative_points?.length ? (
          <div className="mt-2 space-y-1.5">
            {c.narrative_points.map((p, i) => (
              <p key={i} className="text-sm leading-relaxed text-white/80 flex gap-2">
                <span className="text-amber-400/70 shrink-0">›</span>
                <span>{stripMd(p)}</span>
              </p>
            ))}
            <span className="inline-block">{c.narrative_source === "deterministic" ? <CalcBadge /> : <AiBadge />}</span>
            {c.action_fr && (
              <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-400">Action du jour</span>
                <p className="text-sm text-white/90">{stripMd(c.action_fr)}</p>
              </div>
            )}
          </div>
        ) : c?.narrative_fr ? (
          <p className="mt-2 text-sm leading-relaxed text-white/80">
            {stripMd(c.narrative_fr)} <AiBadge />
          </p>
        ) : null}
        {c && !c.narrative_fr && !c.narrative_points?.length && c.degraded_message_fr && (
          <p className="mt-2 text-xs text-white/50">{c.degraded_message_fr}</p>
        )}

        {c && (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {c.kpis.map((k) => (
              <div key={k.kpi_name} className="rounded-lg bg-white/[0.04] px-3 py-2">
                <div className="text-[10px] text-white/50">{KPI_LABELS[k.kpi_name] ?? k.kpi_name}</div>
                <div className="text-sm font-semibold text-white/90">
                  {fmt(k.value)} {k.unit} <CalcBadge />
                </div>
                {k.delta_pct_wow != null && (
                  <div className={`text-[10px] ${k.delta_pct_wow >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {k.delta_pct_wow >= 0 ? "+" : ""}{k.delta_pct_wow}% vs sem. préc.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Insights (décomposition des causes) ── */}
      {insights.length > 0 && (
        <div className="space-y-2">
          {insights.map((ins) => (
            <div key={ins.id} className="rounded-lg bg-white/[0.04] px-3 py-2">
              <button
                className="w-full flex items-center justify-between text-left"
                onClick={() => setOpenInsight(openInsight === ins.id ? null : ins.id)}
              >
                <span className="text-xs text-white/80">
                  {KPI_LABELS[ins.kpi_name] ?? ins.kpi_name} :{" "}
                  <span className={ins.delta_value < 0 ? "text-red-400" : "text-emerald-400"}>
                    {ins.delta_value >= 0 ? "+" : ""}{fmt(ins.delta_value)}
                    {ins.delta_pct != null ? ` (${ins.delta_pct >= 0 ? "+" : ""}${ins.delta_pct}%)` : ""}
                  </span>{" "}
                  <CalcBadge />
                  {ins.is_stale && <span className="ml-1 text-[9px] text-white/40">données du {ins.period_end}</span>}
                </span>
                {ins.causes.length > 0 && (openInsight === ins.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
              </button>
              {ins.narrative_fr && (
                <p className="mt-1 text-xs text-white/60">{stripMd(ins.narrative_fr)} <AiBadge /></p>
              )}
              {openInsight === ins.id && ins.causes.length > 0 && (
                <div className="mt-2 space-y-1">
                  {ins.causes.map((cause) => (
                    <div key={cause.component} className="flex items-center justify-between text-[11px]">
                      <span className="text-white/60">{CAUSE_LABELS[cause.component] ?? cause.component}</span>
                      <span className={cause.delta_fcfa < 0 ? "text-red-400" : "text-emerald-400"}>
                        {cause.delta_fcfa >= 0 ? "+" : ""}{fmt(cause.delta_fcfa)} FCFA · {cause.contribution_pct}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Recommandations (max 3, un CTA chacune) ── */}
      {recos.length > 0 && (
        <div className="space-y-2">
          {recos.map((r) => (
            <div key={r.id} className="rounded-lg border border-white/10 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`mr-1.5 inline-block rounded px-1 text-[9px] font-bold ${
                    r.priority === "HIGH" ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"
                  }`}>{r.priority}</span>
                  <span className="text-xs text-white/80">{r.title_fr}</span>{" "}
                  <CalcBadge />
                  {r.detail_fr && <p className="mt-1 text-[11px] text-white/50">{r.detail_fr}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  <button title="J'ai agi" onClick={() => setRecoStatus(r.id, "acted_on")}
                    className="p-1 rounded hover:bg-white/10 text-emerald-400"><CheckCircle2 size={15} /></button>
                  <button title="Ignorer" onClick={() => setRecoStatus(r.id, "ignored")}
                    className="p-1 rounded hover:bg-white/10 text-white/40"><XCircle size={15} /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
