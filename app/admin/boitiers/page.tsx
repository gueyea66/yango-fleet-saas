"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { fetchJsonRetry } from "@/lib/fetchJsonRetry";
import { parseRconf } from "@/lib/telematics/devices";

/**
 * Boîtiers GPS — installation autonome par le gestionnaire.
 *
 * Le parcours suit l'ordre réel d'une installation chez un client :
 *   1. enrôler le boîtier et le rattacher à un véhicule ;
 *   2. relever sa configuration (RCONF) — c'est ce qui garantit le retour ;
 *   3. envoyer le SMS de bascule généré ;
 *   4. voir le signal arriver.
 * La bascule n'est proposée qu'une fois le chemin de retour connu.
 */

type Step = { label: string; sms: string; explanation: string };
type Device = {
  id: string;
  externalId: string;
  model: string | null;
  firmware: string | null;
  label: string | null;
  active: boolean;
  vehicleId: string | null;
  plate: string | null;
  lastSeenAt: string | null;
  rconfAt: string | null;
  installedAt: string | null;
  originalServer: string | null;
  hasPassword: boolean;
  plan: { ok: boolean; errors: string[]; steps: Step[]; rollback: Step | null };
};
type Vehicle = { id: string; plate: string; name: string };
type Payload = {
  gateway: { ip: string | null; port: number | null; host: string | null; configured: boolean };
  vehicles: Vehicle[];
  devices: Device[];
};

function signal(iso: string | null): { text: string; tone: "ok" | "warn" | "bad" | "none" } {
  if (!iso) return { text: "Aucun signal reçu", tone: "none" };
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 2) return { text: "Signal à l'instant", tone: "ok" };
  if (min < 15) return { text: `Signal il y a ${min} min`, tone: "ok" };
  if (min < 60) return { text: `Silencieux depuis ${min} min`, tone: "warn" };
  const h = Math.round(min / 60);
  return { text: h < 48 ? `Silencieux depuis ${h} h` : `Silencieux depuis ${Math.round(h / 24)} j`, tone: "bad" };
}

const TONE = {
  ok: "text-emerald-400 border-emerald-700 bg-emerald-950/40",
  warn: "text-amber-300 border-amber-700 bg-amber-950/40",
  bad: "text-red-300 border-red-800 bg-red-950/40",
  none: "text-gray-400 border-gray-700 bg-gray-900/60",
};

const inputCls =
  "w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2.5 min-h-[44px] " +
  "focus:outline-none focus:ring-2 focus:ring-yellow-500 placeholder:text-gray-500";

function CopySms({ sms }: { sms: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-stretch gap-2">
      <code className="flex-1 font-mono text-base sm:text-lg text-white bg-black/40 border border-gray-700
                       rounded-lg px-3 py-2.5 break-all select-all">
        {sms}
      </code>
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(sms); setCopied(true); setTimeout(() => setCopied(false), 2000); }
          catch { /* presse-papiers indisponible : le texte reste sélectionnable */ }
        }}
        className="min-w-[88px] px-3 rounded-lg border border-gray-600 text-sm text-gray-200
                   hover:border-gray-400 hover:text-white transition-colors duration-200 cursor-pointer
                   focus:outline-none focus:ring-2 focus:ring-yellow-500"
        aria-label={`Copier le SMS ${sms}`}
      >
        {copied ? "Copié" : "Copier"}
      </button>
    </div>
  );
}

export default function BoitiersPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Formulaire d'ajout
  const [externalId, setExternalId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [label, setLabel] = useState("");
  const [rconf, setRconf] = useState("");
  // Relevé à coller sur un boîtier existant
  const [rconfEdit, setRconfEdit] = useState("");

  useEffect(() => { if (!loading && !user) router.push("/auth/login"); }, [user, loading, router]);

  const load = useCallback(async () => {
    try {
      const json = (await fetchJsonRetry("/api/admin/telematics/devices")) as Payload;
      setData(json);
      setError(null);
      setSelectedId((cur) => cur ?? json.devices[0]?.id ?? null);
      if (json.devices.length === 0) setAdding(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "chargement impossible");
    }
  }, []);

  useEffect(() => { if (user) void load(); }, [user, load]);

  // Pendant une installation, on guette le signal sans que l'installateur ait à recharger.
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => { if (!document.hidden) void load(); }, 15000);
    return () => clearInterval(t);
  }, [user, load]);

  const preview = useMemo(() => (rconf.trim() ? parseRconf(rconf) : null), [rconf]);
  const editPreview = useMemo(() => (rconfEdit.trim() ? parseRconf(rconfEdit) : null), [rconfEdit]);
  const device = data?.devices.find((d) => d.id === selectedId) ?? null;

  async function send(method: "POST" | "PATCH", body: Record<string, unknown>) {
    setBusy(true);
    setNotice([]);
    try {
      const res = await fetch("/api/admin/telematics/devices", {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Erreur ${res.status}`);
      if (json.warnings?.length) setNotice(json.warnings);
      return json;
    } catch (e) {
      setNotice([e instanceof Error ? e.message : "Opération impossible"]);
      return null;
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-gray-900"><p className="text-gray-300">Chargement…</p></div>;
  }
  if (!user) return null;

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6">
          <button onClick={() => router.back()}
            className="text-gray-400 hover:text-white mb-4 text-sm transition-colors duration-200 cursor-pointer
                       focus:outline-none focus:ring-2 focus:ring-yellow-500 rounded px-1">
            ← Retour
          </button>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">Boîtiers GPS</h1>
              <p className="text-gray-400 mt-1 text-sm max-w-xl">
                Installer un traceur, le rattacher à un véhicule, et vérifier qu&apos;il émet —
                sans intervention technique.
              </p>
            </div>
            <button
              onClick={() => { setAdding(true); setSelectedId(null); setNotice([]); }}
              className="min-h-[44px] px-5 rounded-lg bg-yellow-500 text-gray-900 font-semibold text-sm
                         hover:bg-yellow-400 transition-colors duration-200 cursor-pointer
                         focus:outline-none focus:ring-2 focus:ring-yellow-300"
            >
              Ajouter un boîtier
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="mb-5 rounded-lg border border-red-800 bg-red-950/50 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {data && !data.gateway.configured && (
          <div role="alert" className="mb-5 rounded-lg border border-amber-700 bg-amber-950/40 p-4">
            <p className="text-amber-200 font-semibold text-sm">Passerelle non configurée</p>
            <p className="text-amber-100/80 text-sm mt-1">
              Les SMS de bascule ne peuvent pas être générés tant que l&apos;adresse IP de la passerelle
              n&apos;est pas renseignée côté serveur (TELEMATICS_GATEWAY_IP et TELEMATICS_GATEWAY_PORT).
            </p>
          </div>
        )}

        {notice.length > 0 && (
          <div role="status" aria-live="polite" className="mb-5 rounded-lg border border-blue-800 bg-blue-950/40 p-4">
            {notice.map((n) => <p key={n} className="text-blue-100 text-sm">{n}</p>)}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* ── Liste ─────────────────────────────────────────────── */}
          <section className="lg:col-span-2 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden self-start">
            <h2 className="px-4 py-3 text-sm font-semibold text-white border-b border-gray-700">
              {data ? `${data.devices.length} boîtier${data.devices.length > 1 ? "s" : ""}` : "Boîtiers"}
            </h2>
            {data && data.devices.length === 0 ? (
              <p className="p-6 text-sm text-gray-400">Aucun boîtier enrôlé pour l&apos;instant.</p>
            ) : (
              <ul className="divide-y divide-gray-700">
                {data?.devices.map((d) => {
                  const s = signal(d.lastSeenAt);
                  return (
                    <li key={d.id}>
                      <button
                        onClick={() => { setSelectedId(d.id); setAdding(false); setRconfEdit(""); setNotice([]); }}
                        className={`w-full text-left px-4 py-3 transition-colors duration-150 cursor-pointer
                                    focus:outline-none focus:ring-2 focus:ring-inset focus:ring-yellow-500
                                    ${d.id === selectedId && !adding ? "bg-gray-700/60" : "hover:bg-gray-700/40"}`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-white tabular-nums">{d.externalId}</span>
                          <span className="text-sm text-yellow-500 font-mono">{d.plate ?? "non rattaché"}</span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`px-2 py-0.5 rounded border ${TONE[s.tone]}`}>{s.text}</span>
                          {!d.active && <span className="px-2 py-0.5 rounded border border-gray-600 text-gray-400">désactivé</span>}
                          {d.installedAt
                            ? <span className="text-emerald-400">installé</span>
                            : d.rconfAt ? <span className="text-gray-300">prêt à basculer</span>
                            : <span className="text-amber-300">relevé RCONF à faire</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* ── Panneau de droite ─────────────────────────────────── */}
          <section className="lg:col-span-3 bg-gray-800 border border-gray-700 rounded-lg p-4 sm:p-6">
            {adding ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const json = await send("POST", { externalId, vehicleId: vehicleId || null, label, rconf });
                  if (json?.device) {
                    setAdding(false); setExternalId(""); setVehicleId(""); setLabel(""); setRconf("");
                    await load();
                    setSelectedId(json.device.id);
                  }
                }}
                className="space-y-5"
              >
                <div>
                  <h2 className="text-lg font-semibold text-white">Ajouter un boîtier</h2>
                  <p className="text-sm text-gray-400 mt-1">
                    Commencez par envoyer <span className="font-mono text-white">RCONF</span> par SMS au boîtier,
                    puis collez sa réponse ci-dessous : elle remplit tout le reste.
                  </p>
                </div>

                <div>
                  <label htmlFor="rconf" className="block text-sm font-medium text-gray-200 mb-1.5">
                    Réponse au SMS RCONF <span className="text-gray-500 font-normal">(recommandé)</span>
                  </label>
                  <textarea id="rconf" rows={4} value={rconf} onChange={(e) => {
                      setRconf(e.target.value);
                      const p = parseRconf(e.target.value);
                      if (p.deviceId && !externalId) setExternalId(p.deviceId);
                    }}
                    placeholder="ST-901-868L:V4.35,ID:…,UP:…,IP:…"
                    className={`${inputCls} font-mono text-sm`} />
                  {preview && (
                    <div className="mt-2 rounded-lg border border-gray-700 bg-gray-900/60 p-3 text-sm space-y-1">
                      <p className="text-gray-300">
                        {preview.model ?? "Modèle inconnu"} {preview.firmware ?? ""} ·
                        boîtier <span className="font-mono text-white">{preview.deviceId ?? "—"}</span>
                      </p>
                      <p className={preview.password ? "text-emerald-400" : "text-amber-300"}>
                        {preview.password ? "Mot de passe SMS détecté" : "Mot de passe SMS introuvable"}
                      </p>
                      <p className={preview.serverIp ? "text-emerald-400" : "text-amber-300"}>
                        {preview.serverIp
                          ? `Retour garanti vers ${preview.serverIp}:${preview.serverPort}`
                          : "Serveur d'origine introuvable — retour arrière non garanti"}
                      </p>
                      {preview.warnings.map((w) => <p key={w} className="text-amber-300">{w}</p>)}
                    </div>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="externalId" className="block text-sm font-medium text-gray-200 mb-1.5">
                      Identifiant du boîtier <span className="text-red-400" aria-hidden="true">*</span>
                    </label>
                    <input id="externalId" required inputMode="numeric" autoComplete="off"
                      value={externalId} onChange={(e) => setExternalId(e.target.value)}
                      placeholder="Chiffres sur l'étiquette" className={`${inputCls} font-mono`} />
                  </div>
                  <div>
                    <label htmlFor="vehicle" className="block text-sm font-medium text-gray-200 mb-1.5">Véhicule</label>
                    <select id="vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
                      className={`${inputCls} cursor-pointer`}>
                      <option value="">— à rattacher plus tard —</option>
                      {data?.vehicles.map((v) => (
                        <option key={v.id} value={v.id}>{v.plate}{v.name ? ` · ${v.name}` : ""}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="label" className="block text-sm font-medium text-gray-200 mb-1.5">
                    Libellé <span className="text-gray-500 font-normal">(facultatif)</span>
                  </label>
                  <input id="label" value={label} onChange={(e) => setLabel(e.target.value)}
                    placeholder="Ex. benne n°4, sous le tableau de bord" className={inputCls} />
                </div>

                <div className="flex flex-wrap gap-3">
                  <button type="submit" disabled={busy || !externalId.trim()}
                    className="min-h-[44px] px-5 rounded-lg bg-yellow-500 text-gray-900 font-semibold text-sm
                               hover:bg-yellow-400 transition-colors duration-200 cursor-pointer
                               disabled:opacity-40 disabled:cursor-not-allowed
                               focus:outline-none focus:ring-2 focus:ring-yellow-300">
                    {busy ? "Enregistrement…" : "Enregistrer le boîtier"}
                  </button>
                  {(data?.devices.length ?? 0) > 0 && (
                    <button type="button" onClick={() => { setAdding(false); setSelectedId(data?.devices[0]?.id ?? null); }}
                      className="min-h-[44px] px-4 rounded-lg border border-gray-600 text-gray-300 text-sm
                                 hover:text-white hover:border-gray-400 transition-colors duration-200 cursor-pointer">
                      Annuler
                    </button>
                  )}
                </div>
              </form>
            ) : device ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white font-mono">{device.externalId}</h2>
                    <p className="text-sm text-gray-400">
                      {[device.model, device.firmware].filter(Boolean).join(" ") || "Modèle non relevé"}
                      {device.label ? ` · ${device.label}` : ""}
                    </p>
                  </div>
                  <span className={`px-3 py-1.5 rounded-lg border text-sm ${TONE[signal(device.lastSeenAt).tone]}`}>
                    {signal(device.lastSeenAt).text}
                  </span>
                </div>

                <div>
                  <label htmlFor="relink" className="block text-sm font-medium text-gray-200 mb-1.5">Véhicule rattaché</label>
                  <select id="relink" value={device.vehicleId ?? ""} disabled={busy}
                    onChange={async (e) => { if (await send("PATCH", { id: device.id, action: "link", vehicleId: e.target.value || null })) await load(); }}
                    className={`${inputCls} cursor-pointer`}>
                    <option value="">— aucun —</option>
                    {data?.vehicles.map((v) => (
                      <option key={v.id} value={v.id}>{v.plate}{v.name ? ` · ${v.name}` : ""}</option>
                    ))}
                  </select>
                </div>

                {/* Relevé RCONF : condition de la bascule */}
                {!device.rconfAt || !device.hasPassword ? (
                  <div className="rounded-lg border border-amber-700 bg-amber-950/30 p-4 space-y-3">
                    <div>
                      <h3 className="text-amber-200 font-semibold text-sm">Étape préalable : relever la configuration</h3>
                      <p className="text-amber-100/80 text-sm mt-1">
                        Envoyez <span className="font-mono text-white">RCONF</span> au numéro de la carte SIM du boîtier,
                        et collez la réponse. Sans elle, le retour à la plateforme d&apos;origine n&apos;est pas garanti.
                      </p>
                    </div>
                    <label htmlFor="rconfEdit" className="sr-only">Réponse RCONF</label>
                    <textarea id="rconfEdit" rows={4} value={rconfEdit} onChange={(e) => setRconfEdit(e.target.value)}
                      placeholder="Collez ici la réponse du boîtier" className={`${inputCls} font-mono text-sm`} />
                    {editPreview && (
                      <p className={`text-sm ${editPreview.serverIp ? "text-emerald-400" : "text-amber-300"}`}>
                        {editPreview.serverIp
                          ? `Retour garanti vers ${editPreview.serverIp}:${editPreview.serverPort}`
                          : "Serveur d'origine introuvable dans ce texte"}
                      </p>
                    )}
                    <button disabled={busy || !rconfEdit.trim()}
                      onClick={async () => { if (await send("PATCH", { id: device.id, action: "rconf", rconf: rconfEdit })) { setRconfEdit(""); await load(); } }}
                      className="min-h-[44px] px-5 rounded-lg bg-yellow-500 text-gray-900 font-semibold text-sm
                                 hover:bg-yellow-400 transition-colors duration-200 cursor-pointer
                                 disabled:opacity-40 disabled:cursor-not-allowed">
                      Enregistrer le relevé
                    </button>
                  </div>
                ) : (
                  <>
                    <div>
                      <h3 className="text-white font-semibold">Installation</h3>
                      <p className="text-sm text-gray-400 mt-1">
                        À envoyer dans cet ordre au numéro de la carte SIM du boîtier.
                        {device.originalServer && <> Plateforme d&apos;origine relevée : <span className="font-mono text-gray-200">{device.originalServer}</span>.</>}
                      </p>
                    </div>

                    {device.plan.ok ? (
                      <ol className="space-y-4">
                        {device.plan.steps.map((s, i) => (
                          <li key={i} className="space-y-2">
                            <p className="text-sm text-gray-200">
                              <span className="font-mono text-yellow-500 mr-2">{i + 1}.</span>{s.label}
                            </p>
                            <CopySms sms={s.sms} />
                            <p className="text-xs text-gray-400">{s.explanation}</p>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div role="alert" className="rounded-lg border border-red-800 bg-red-950/40 p-4">
                        {device.plan.errors.map((e) => <p key={e} className="text-sm text-red-300">{e}</p>)}
                      </div>
                    )}

                    {device.plan.rollback && (
                      <div className="rounded-lg border border-gray-600 bg-gray-900/60 p-4 space-y-2">
                        <h3 className="text-sm font-semibold text-gray-100">En cas de problème : {device.plan.rollback.label.toLowerCase()}</h3>
                        <CopySms sms={device.plan.rollback.sms} />
                        <p className="text-xs text-gray-400">{device.plan.rollback.explanation}</p>
                      </div>
                    )}

                    {!device.installedAt && (
                      <details className="text-sm">
                        <summary className="cursor-pointer text-gray-300 hover:text-white">
                          Coller la réponse RCONF de confirmation
                        </summary>
                        <div className="mt-3 space-y-3">
                          <textarea rows={3} value={rconfEdit} onChange={(e) => setRconfEdit(e.target.value)}
                            aria-label="Réponse RCONF après bascule"
                            className={`${inputCls} font-mono text-sm`} />
                          <button disabled={busy || !rconfEdit.trim()}
                            onClick={async () => { if (await send("PATCH", { id: device.id, action: "rconf", rconf: rconfEdit })) { setRconfEdit(""); await load(); } }}
                            className="min-h-[44px] px-4 rounded-lg border border-gray-600 text-gray-200
                                       hover:border-gray-400 hover:text-white transition-colors duration-200 cursor-pointer
                                       disabled:opacity-40 disabled:cursor-not-allowed">
                            Vérifier la bascule
                          </button>
                        </div>
                      </details>
                    )}
                  </>
                )}

                <div className="pt-4 border-t border-gray-700 flex flex-wrap gap-3">
                  <button disabled={busy}
                    onClick={async () => { if (await send("PATCH", { id: device.id, action: device.active ? "deactivate" : "activate" })) await load(); }}
                    className={`min-h-[44px] px-4 rounded-lg border text-sm transition-colors duration-200 cursor-pointer
                                ${device.active ? "border-red-800 text-red-300 hover:bg-red-950/40" : "border-emerald-700 text-emerald-300 hover:bg-emerald-950/40"}`}>
                    {device.active ? "Désactiver ce boîtier" : "Réactiver ce boîtier"}
                  </button>
                  <p className="text-xs text-gray-500 self-center max-w-sm">
                    Un boîtier désactivé voit ses positions refusées. Son historique est conservé.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">Sélectionnez un boîtier, ou ajoutez-en un.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
