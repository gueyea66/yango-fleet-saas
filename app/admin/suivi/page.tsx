"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { fetchJsonRetry } from "@/lib/fetchJsonRetry";

/**
 * Suivi GPS — dernière position, trace du jour, et rapprochement entre les
 * kilomètres réellement parcourus et ceux déclarés au compteur.
 *
 * Principe tenu partout dans cet écran : un chiffre incertain est montré comme
 * incertain. La couverture GPS est affichée À CÔTÉ de l'écart, et un écart
 * calculé sur une journée mal captée est signalé comme non exploitable plutôt
 * que présenté comme un fait.
 */

type Position = {
  recorded_at: string;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  valid_fix: boolean;
};

type Recon = {
  day: string;
  km_gps: number | null;
  km_declares: number | null;
  ecart_km: number | null;
  ecart_pct: number | null;
  coverage: number | null;
  points: number | null;
  trips: number | null;
  jours_couverts: number | null;
  ecart_exploitable: boolean | null;
};

type Payload = {
  installed: boolean;
  error?: string;
  day: string;
  devices: { id: string; external_id: string; label: string | null; plate: string | null;
             vehicle_id: string | null; last_seen_at: string | null; active: boolean }[];
  selectedVehicleId?: string | null;
  positions: Position[];
  positionCount: number;
  lastPosition: Position | null;
  events: { type: string; occurred_at: string; latitude: number | null;
            longitude: number | null; confidence: number }[];
  daily: { day: string; distance_m: number; moving_s: number; idle_s: number;
           trips: number; coverage: number; points: number }[];
  reconciliation: Recon[];
};

const today = () => new Date().toISOString().slice(0, 10);

function ageLabel(iso: string | null): { text: string; tone: "ok" | "warn" | "bad" } {
  if (!iso) return { text: "jamais vu", tone: "bad" };
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 5) return { text: "à l'instant", tone: "ok" };
  if (min < 60) return { text: `il y a ${min} min`, tone: min < 15 ? "ok" : "warn" };
  const h = Math.round(min / 60);
  if (h < 24) return { text: `il y a ${h} h`, tone: "bad" };
  return { text: `il y a ${Math.round(h / 24)} j`, tone: "bad" };
}

const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
};

const TONE: Record<string, string> = {
  ok: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-red-400",
};

export default function SuiviPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [date, setDate] = useState(today());
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/auth/login");
  }, [user, loading, router]);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ date });
      if (vehicleId) qs.set("vehicleId", vehicleId);
      const json = await fetchJsonRetry(`/api/admin/telematics?${qs}`);
      setData(json as Payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "chargement impossible");
    } finally {
      setBusy(false);
    }
  }, [date, vehicleId]);

  useEffect(() => { if (user) void load(); }, [user, load]);

  // ── Carte : chargée à la demande, jamais dans le bundle initial ────────
  useEffect(() => {
    if (!data?.positions?.length || !mapEl.current) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !mapEl.current) return;

      mapRef.current?.remove();
      const pts = data.positions
        .filter((p) => p.valid_fix)
        .map((p) => [p.latitude, p.longitude] as [number, number]);
      if (pts.length === 0) return;

      const map = L.map(mapEl.current, { attributionControl: true });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);

      L.polyline(pts, { color: "#f5a623", weight: 4, opacity: 0.85 }).addTo(map);
      // Marqueurs vectoriels : pas d'images à charger, donc pas d'icône cassée.
      L.circleMarker(pts[0], { radius: 6, color: "#10b981", fillOpacity: 1 })
        .addTo(map).bindPopup("Départ");
      L.circleMarker(pts[pts.length - 1], { radius: 7, color: "#f5a623", fillOpacity: 1 })
        .addTo(map).bindPopup("Dernière position");

      for (const ev of data.events) {
        if (ev.type !== "LONG_STOP" || ev.latitude == null || ev.longitude == null) continue;
        L.circleMarker([ev.latitude, ev.longitude], {
          radius: 5, color: "#60a5fa", fillOpacity: 0.9,
        }).addTo(map).bindPopup("Arrêt long");
      }

      map.fitBounds(L.latLngBounds(pts), { padding: [24, 24] });
    })();

    return () => { cancelled = true; };
  }, [data]);

  useEffect(() => () => { mapRef.current?.remove(); }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-lg text-gray-300">Chargement…</p>
      </div>
    );
  }
  if (!user) return null;

  const dayAgg = data?.daily?.find((d) => d.day === data.day);
  const lastSeen = ageLabel(data?.lastPosition?.recorded_at ?? null);
  const device = data?.devices?.[0];

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <button
            onClick={() => router.back()}
            className="text-gray-400 hover:text-white mb-4 text-sm transition-colors duration-200
                       focus:outline-none focus:ring-2 focus:ring-yellow-500 rounded px-1 cursor-pointer"
          >
            ← Retour
          </button>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-white">Suivi GPS</h1>
              <p className="text-gray-400 mt-1 text-sm">
                Position réelle des véhicules et écart avec les kilomètres déclarés
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {(data?.devices?.length ?? 0) > 1 && (
                <label className="text-sm">
                  <span className="block text-xs uppercase tracking-widest text-gray-400 mb-1">
                    Véhicule
                  </span>
                  <select
                    value={vehicleId ?? data?.selectedVehicleId ?? ""}
                    onChange={(e) => setVehicleId(e.target.value || null)}
                    className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 min-h-[44px]
                               focus:outline-none focus:ring-2 focus:ring-yellow-500 cursor-pointer"
                  >
                    {data?.devices.map((d) => (
                      <option key={d.id} value={d.vehicle_id ?? ""}>
                        {d.plate ?? d.label ?? d.external_id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="text-sm">
                <span className="block text-xs uppercase tracking-widest text-gray-400 mb-1">
                  Journée
                </span>
                <input
                  type="date"
                  value={date}
                  max={today()}
                  onChange={(e) => setDate(e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 min-h-[44px]
                             focus:outline-none focus:ring-2 focus:ring-yellow-500 cursor-pointer"
                />
              </label>
            </div>
          </div>
        </header>

        {error && (
          <div role="alert" className="mb-6 rounded-lg border border-red-800 bg-red-950/50 p-4">
            <p className="text-red-300 text-sm">{error}</p>
            <button
              onClick={() => void load()}
              className="mt-2 text-sm text-red-200 underline hover:text-white cursor-pointer"
            >
              Réessayer
            </button>
          </div>
        )}

        {/* Socle absent : dire quoi faire, plutôt qu'un écran vide */}
        {data && !data.installed && (
          <div className="rounded-lg border border-amber-800 bg-amber-950/40 p-6">
            <h2 className="text-amber-200 font-semibold mb-2">Socle télématique non installé</h2>
            <p className="text-amber-100/80 text-sm">
              Les tables GPS n&apos;existent pas encore dans cette base. Appliquer les migrations
              <code className="mx-1 px-1.5 py-0.5 rounded bg-black/40 font-mono text-xs">049</code>
              et
              <code className="mx-1 px-1.5 py-0.5 rounded bg-black/40 font-mono text-xs">050</code>
              (voir <span className="font-mono text-xs">docs/TELEMATICS/01-RUNBOOK.md</span>).
            </p>
          </div>
        )}

        {data?.installed && data.devices.length === 0 && (
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-8 text-center">
            <h2 className="text-white font-semibold mb-2">Aucun boîtier enrôlé</h2>
            <p className="text-gray-400 text-sm max-w-md mx-auto">
              Aucun traceur n&apos;est encore rattaché à un véhicule de cette organisation.
              L&apos;enrôlement se fait avec le script
              <span className="font-mono text-xs mx-1">scripts/telematics-enroll.mjs</span>,
              avant de basculer le boîtier vers la passerelle.
            </p>
          </div>
        )}

        {data?.installed && data.devices.length > 0 && (
          <>
            {/* ── Indicateurs du jour ─────────────────────────────────── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <article className="bg-gray-800 border-l-4 border-yellow-500 rounded-lg p-4">
                <h2 className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                  Dernier signal
                </h2>
                <p className={`text-xl sm:text-2xl font-bold font-mono mt-2 ${TONE[lastSeen.tone]}`}>
                  {lastSeen.text}
                </p>
                <p className="text-xs text-gray-500 mt-1 font-mono">
                  {device?.plate ?? device?.external_id}
                </p>
              </article>

              <article className="bg-gray-800 border-l-4 border-blue-500 rounded-lg p-4">
                <h2 className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                  Km GPS du jour
                </h2>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono mt-2 tabular-nums">
                  {dayAgg ? (dayAgg.distance_m / 1000).toFixed(1) : "—"}
                  <span className="text-sm text-gray-400"> km</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {dayAgg ? `${dayAgg.trips} trajet${dayAgg.trips > 1 ? "s" : ""}` : "pas encore calculé"}
                </p>
              </article>

              <article className="bg-gray-800 border-l-4 border-emerald-500 rounded-lg p-4">
                <h2 className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                  Temps en mouvement
                </h2>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono mt-2 tabular-nums">
                  {dayAgg ? fmtDuration(dayAgg.moving_s) : "—"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {dayAgg ? `${fmtDuration(dayAgg.idle_s)} à l'arrêt` : ""}
                </p>
              </article>

              <article className="bg-gray-800 border-l-4 border-gray-500 rounded-lg p-4">
                <h2 className="text-xs uppercase text-gray-400 tracking-widest font-semibold">
                  Couverture GPS
                </h2>
                <p className={`text-xl sm:text-2xl font-bold font-mono mt-2 tabular-nums ${
                  dayAgg ? (dayAgg.coverage >= 0.8 ? TONE.ok : TONE.warn) : "text-white"
                }`}>
                  {dayAgg ? `${Math.round(dayAgg.coverage * 100)} %` : "—"}
                </p>
                <p className="text-xs text-gray-500 mt-1 tabular-nums">
                  {data.positionCount} point{data.positionCount > 1 ? "s" : ""} reçus
                </p>
              </article>
            </div>

            {/* ── Carte ───────────────────────────────────────────────── */}
            <section className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden mb-6">
              <h2 className="px-4 py-3 text-sm font-semibold text-white border-b border-gray-700">
                Trace du {new Date(`${data.day}T12:00:00Z`).toLocaleDateString("fr-FR", {
                  weekday: "long", day: "numeric", month: "long",
                })}
              </h2>
              {busy ? (
                <div className="h-[420px] animate-pulse bg-gray-700/40" aria-label="Chargement de la carte" />
              ) : data.positions.length === 0 ? (
                <div className="h-[420px] flex flex-col items-center justify-center text-center px-6">
                  <p className="text-white font-medium">Aucune position ce jour-là</p>
                  <p className="text-gray-400 text-sm mt-2 max-w-sm">
                    Soit le boîtier n&apos;émettait pas encore, soit il n&apos;a pas eu de réseau.
                    Les journées sans donnée ne sont jamais comblées par une estimation.
                  </p>
                </div>
              ) : (
                <div
                  ref={mapEl}
                  className="h-[420px] w-full"
                  role="img"
                  aria-label={`Trajet du ${data.day}, ${data.positionCount} positions`}
                />
              )}
            </section>

            {/* ── Rapprochement ───────────────────────────────────────── */}
            <section className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700">
                <h2 className="text-sm font-semibold text-white">
                  Km réels contre km déclarés
                </h2>
                <p className="text-xs text-gray-400 mt-1">
                  Un écart n&apos;est retenu que si la journée est bien couverte et que la
                  déclaration porte sur cette seule journée.
                </p>
              </div>

              {data.reconciliation.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-white font-medium">Pas encore de rapprochement</p>
                  <p className="text-gray-400 text-sm mt-2">
                    Il faut au moins une journée avec des positions GPS et une déclaration validée.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-900/60 text-gray-400">
                      <tr>
                        <th scope="col" className="text-left font-semibold px-4 py-3">Jour</th>
                        <th scope="col" className="text-right font-semibold px-4 py-3">Km GPS</th>
                        <th scope="col" className="text-right font-semibold px-4 py-3">Km déclarés</th>
                        <th scope="col" className="text-right font-semibold px-4 py-3">Écart</th>
                        <th scope="col" className="text-right font-semibold px-4 py-3">Couverture</th>
                        <th scope="col" className="text-left font-semibold px-4 py-3">Lecture</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-700">
                      {data.reconciliation.map((r) => {
                        const usable = r.ecart_exploitable === true;
                        const big = usable && r.ecart_pct !== null && Math.abs(r.ecart_pct) >= 15;
                        return (
                          <tr key={r.day} className="hover:bg-gray-700/40 transition-colors duration-150">
                            <td className="px-4 py-3 text-gray-200 font-mono tabular-nums">{r.day}</td>
                            <td className="px-4 py-3 text-right text-white font-mono tabular-nums">
                              {r.km_gps ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-right text-white font-mono tabular-nums">
                              {r.km_declares ?? "—"}
                            </td>
                            <td className={`px-4 py-3 text-right font-mono tabular-nums ${
                              !usable ? "text-gray-500" : big ? TONE.warn : TONE.ok
                            }`}>
                              {r.ecart_km === null ? "—"
                                : `${r.ecart_km > 0 ? "+" : ""}${r.ecart_km}${
                                    r.ecart_pct !== null ? ` (${r.ecart_pct > 0 ? "+" : ""}${r.ecart_pct} %)` : ""
                                  }`}
                            </td>
                            <td className={`px-4 py-3 text-right font-mono tabular-nums ${
                              (r.coverage ?? 0) >= 0.8 ? "text-gray-300" : TONE.warn
                            }`}>
                              {r.coverage === null ? "—" : `${Math.round(r.coverage * 100)} %`}
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs">
                              {r.km_declares === null ? "aucune déclaration validée"
                                : (r.jours_couverts ?? 1) > 1
                                  ? `déclaration couvrant ${r.jours_couverts} jours — non comparable`
                                  : !usable ? "couverture GPS insuffisante"
                                  : big ? "écart à examiner"
                                  : "cohérent"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
