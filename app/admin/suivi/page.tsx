"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/context";
import { fetchJsonRetry } from "@/lib/fetchJsonRetry";
import type { Map as LeafletMap, Polyline, CircleMarker, LayerGroup } from "leaflet";

/**
 * Suivi GPS — position, rejeu du trajet, et rapprochement entre kilomètres
 * réellement parcourus et kilomètres déclarés au compteur.
 *
 * Principe tenu partout : un chiffre incertain est montré comme incertain.
 * La couverture GPS est affichée À CÔTÉ de l'écart, et un écart calculé sur
 * une journée mal captée est signalé comme non exploitable plutôt que
 * présenté comme un fait.
 */

type Position = {
  recorded_at: string;
  latitude: number;
  longitude: number;
  speed_kmh: number | null;
  valid_fix: boolean;
};

type Trip = {
  id: string;
  started_at: string;
  ended_at: string;
  distance_m: number;
  duration_s: number;
  moving_s: number;
  idle_s: number;
  max_speed_kmh: number | null;
  avg_moving_speed_kmh: number | null;
  points: number;
  gaps_s: number;
  jumps_dropped: number;
  confidence: number;
  start_address: string | null;
  end_address: string | null;
  address_source: string | null;
  start_latitude: number;
  start_longitude: number;
  end_latitude: number;
  end_longitude: number;
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
  /** 'gps' = mesuré par M3A · 'import' = repris de la plateforme d'origine. */
  source?: string | null;
};

type Device = {
  id: string; external_id: string; label: string | null; plate: string | null;
  vehicle_id: string | null; last_seen_at: string | null; active: boolean; vendor: string;
};

type Payload = {
  installed: boolean;
  day: string;
  devices: Device[];
  selectedVehicleId?: string | null;
  positions: Position[];
  positionCount: number;
  lastPosition: Position | null;
  events: { type: string; occurred_at: string; latitude: number | null;
            longitude: number | null; confidence: number;
            evidence: Record<string, unknown> }[];
  trips: Trip[];
  daily: { day: string; distance_m: number; moving_s: number; idle_s: number;
           trips: number; coverage: number; points: number }[];
  reconciliation: Recon[];
};

const today = () => new Date().toISOString().slice(0, 10);

const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const hhmmss = (iso: string) =>
  new Date(iso).toLocaleTimeString("fr-FR", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC",
  });

const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
};

function ageLabel(iso: string | null): { text: string; tone: "ok" | "warn" | "bad" } {
  if (!iso) return { text: "jamais vu", tone: "bad" };
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 5) return { text: "à l'instant", tone: "ok" };
  if (min < 60) return { text: `il y a ${min} min`, tone: min < 15 ? "ok" : "warn" };
  const h = Math.round(min / 60);
  if (h < 48) return { text: `il y a ${h} h`, tone: "bad" };
  return { text: `il y a ${Math.round(h / 24)} j`, tone: "bad" };
}

const TONE: Record<string, string> = {
  ok: "text-emerald-400", warn: "text-amber-400", bad: "text-red-400",
};

/** Vitesses de rejeu, exprimées en points avancés par battement de 120 ms. */
const SPEEDS = [
  { label: "×1", step: 1 },
  { label: "×4", step: 4 },
  { label: "×12", step: 12 },
];

const IconPlay = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M4 2.5v11l9-5.5-9-5.5z" />
  </svg>
);
const IconPause = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" />
  </svg>
);
const IconRestart = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
       strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.8-3.85" /><path d="M13 2v3.2H9.8" />
  </svg>
);

export default function SuiviPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [date, setDate] = useState(today());
  const [vehicleId, setVehicleId] = useState<string | null>(null);

  // La journée consultée vit dans l'URL : un lien vers une journée précise se
  // partage, et le retour arrière du navigateur reste cohérent.
  //
  // L'URL est lue une fois au montage, et n'est réécrite QUE sur un choix
  // explicite de l'utilisateur (`chooseDate`). Un effet de synchronisation
  // aurait été plus court, mais React remonte les composants deux fois en
  // développement : au second montage il relisait une URL qu'il venait
  // lui-même de réécrire avec la date du jour, écrasant la journée demandée.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("date");
    if (p && /^\d{4}-\d{2}-\d{2}$/.test(p)) setDate(p);
  }, []);

  const chooseDate = useCallback((d: string) => {
    setDate(d);
    // Choisir une journée passée sort du direct ; revenir à aujourd'hui y ramène.
    setLive(d === today());
    const url = new URL(window.location.href);
    url.searchParams.set("date", d);
    window.history.replaceState(null, "", url.toString());
  }, []);
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Rejeu ──────────────────────────────────────────────────────────────
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const [tripId, setTripId] = useState<string | null>(null);

  /**
   * Mode direct : sur la journée en cours, l'écran se rafraîchit seul et suit
   * le véhicule. Dès que l'utilisateur touche au rejeu, il reprend la main et
   * le suivi s'arrête — sinon le curseur sauterait sous ses doigts. Un bouton
   * ramène au direct.
   */
  const [live, setLive] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);

  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const baseLine = useRef<Polyline | null>(null);
  const doneLine = useRef<Polyline | null>(null);
  const cursorMark = useRef<CircleMarker | null>(null);
  const overlays = useRef<LayerGroup | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/auth/login");
  }, [user, loading, router]);

  const load = useCallback(async (opts: { silencieux?: boolean } = {}) => {
    // Un rafraîchissement automatique ne doit ni faire clignoter l'écran ni
    // remettre le rejeu à zéro : seul un changement de journée le fait.
    if (!opts.silencieux) setBusy(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ date });
      if (vehicleId) qs.set("vehicleId", vehicleId);
      const json = await fetchJsonRetry(`/api/admin/telematics?${qs}`);
      setData(json as Payload);
      setRefreshedAt(Date.now());
      if (!opts.silencieux) {
        setCursor(0);
        setPlaying(false);
        setTripId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "chargement impossible");
    } finally {
      if (!opts.silencieux) setBusy(false);
    }
  }, [date, vehicleId]);

  useEffect(() => { if (user) void load(); }, [user, load]);

  // ── Suivi en direct ────────────────────────────────────────────────────
  const enDirect = live && date === today();

  useEffect(() => {
    if (!user || !enDirect) return;
    const t = setInterval(() => {
      // Inutile d'interroger le serveur pour un onglet que personne ne regarde.
      if (!document.hidden) void load({ silencieux: true });
    }, 30000);
    return () => clearInterval(t);
  }, [user, enDirect, load]);

  const fixes = useMemo(
    () => (data?.positions ?? []).filter((p) => p.valid_fix),
    [data],
  );

  // En direct, le curseur colle à la dernière position reçue : l'écran suit le
  // véhicule au lieu de rester figé sur le point d'ouverture de la page.
  useEffect(() => {
    if (enDirect && !playing && fixes.length > 0) setCursor(fixes.length - 1);
  }, [enDirect, playing, fixes.length]);

  /** L'utilisateur reprend la main : le suivi automatique s'arrête. */
  const reprendreLaMain = useCallback(() => setLive(false), []);

  const revenirAuDirect = useCallback(() => {
    setPlaying(false);
    setTripId(null);
    setLive(true);
    const aujourdhui = today();
    if (date !== aujourdhui) {
      setDate(aujourdhui);
      const url = new URL(window.location.href);
      url.searchParams.set("date", aujourdhui);
      window.history.replaceState(null, "", url.toString());
    } else {
      setCursor(Math.max(0, fixes.length - 1));
      void load({ silencieux: true });
    }
  }, [date, fixes.length, load]);

  // ── Carte : chargée à la demande, hors du bundle initial ───────────────
  useEffect(() => {
    if (!fixes.length || !mapEl.current) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !mapEl.current) return;

      mapRef.current?.remove();
      const pts = fixes.map((p) => [p.latitude, p.longitude] as [number, number]);

      const map = L.map(mapEl.current, { attributionControl: true, zoomControl: true });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "© OpenStreetMap",
      }).addTo(map);

      // Trace complète en sourdine, portion parcourue en évidence.
      baseLine.current = L.polyline(pts, { color: "#6b7280", weight: 3, opacity: 0.55 }).addTo(map);
      doneLine.current = L.polyline([pts[0]], { color: "#f5a623", weight: 5, opacity: 0.95 }).addTo(map);

      const group = L.layerGroup().addTo(map);
      overlays.current = group;

      L.circleMarker(pts[0], { radius: 6, color: "#10b981", fillColor: "#10b981", fillOpacity: 1 })
        .addTo(group).bindPopup("Premier point du jour");
      L.circleMarker(pts[pts.length - 1], { radius: 6, color: "#ef4444", fillColor: "#ef4444", fillOpacity: 1 })
        .addTo(group).bindPopup("Dernier point du jour");

      for (const ev of data?.events ?? []) {
        if (ev.latitude == null || ev.longitude == null) continue;
        if (ev.type === "LONG_STOP") {
          const minutes = Math.round(Number(ev.evidence?.duree_s ?? 0) / 60);
          L.circleMarker([ev.latitude, ev.longitude], {
            radius: 7, color: "#60a5fa", fillColor: "#1d4ed8", fillOpacity: 0.85, weight: 2,
          }).addTo(group).bindPopup(`Arrêt de ${minutes} min · ${hhmm(ev.occurred_at)}`);
        }
        if (ev.type === "GPS_OFFLINE") {
          const minutes = Math.round(Number(ev.evidence?.duree_s ?? 0) / 60);
          L.circleMarker([ev.latitude, ev.longitude], {
            radius: 7, color: "#f59e0b", fillColor: "#78350f", fillOpacity: 0.9, weight: 2,
          }).addTo(group).bindPopup(`Perte de signal ${minutes} min · ${hhmm(ev.occurred_at)}`);
        }
      }

      cursorMark.current = L.circleMarker(pts[0], {
        radius: 9, color: "#ffffff", weight: 3, fillColor: "#f5a623", fillOpacity: 1,
      }).addTo(map);

      map.fitBounds(L.latLngBounds(pts), { padding: [28, 28] });
    })();

    return () => { cancelled = true; };
  }, [fixes, data?.events]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  // ── Déplacement du curseur sur la carte ────────────────────────────────
  useEffect(() => {
    if (!fixes.length || !doneLine.current || !cursorMark.current) return;
    const upTo = fixes.slice(0, Math.max(1, cursor + 1))
      .map((p) => [p.latitude, p.longitude] as [number, number]);
    doneLine.current.setLatLngs(upTo);
    const here = fixes[Math.min(cursor, fixes.length - 1)];
    cursorMark.current.setLatLng([here.latitude, here.longitude]);
  }, [cursor, fixes]);

  // ── Lecture ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || fixes.length === 0) return;
    const step = SPEEDS[speedIdx].step;
    const id = setInterval(() => {
      setCursor((c) => {
        if (c + step >= fixes.length - 1) { setPlaying(false); return fixes.length - 1; }
        return c + step;
      });
    }, 120);
    return () => clearInterval(id);
  }, [playing, speedIdx, fixes.length]);

  const focusTrip = (trip: Trip) => {
    reprendreLaMain();
    setTripId(trip.id);
    const idx = fixes.findIndex((p) => Date.parse(p.recorded_at) >= Date.parse(trip.started_at));
    if (idx >= 0) setCursor(idx);
    const inTrip = fixes.filter(
      (p) => Date.parse(p.recorded_at) >= Date.parse(trip.started_at) &&
             Date.parse(p.recorded_at) <= Date.parse(trip.ended_at),
    );
    if (inTrip.length && mapRef.current) {
      const lats = inTrip.map((p) => p.latitude);
      const lons = inTrip.map((p) => p.longitude);
      mapRef.current.fitBounds(
        [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]],
        { padding: [40, 40] },
      );
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-lg text-gray-300">Chargement…</p>
      </div>
    );
  }
  if (!user) return null;

  /**
   * Ce que la vue montre réellement, en une phrase :
   *   • direct         — rafraîchi seul, curseur collé à la dernière position ;
   *   • direct muet    — rafraîchi, mais le boîtier ne dit plus rien ;
   *   • rejeu          — l'utilisateur a pris la main sur la journée en cours ;
   *   • historique     — journée passée, rien ne bougera.
   */
  const etatVue: { label: string; tone: "live" | "stale" | "static" } = (() => {
    const jour = data?.day ?? date;
    if (jour !== today()) {
      return {
        label: `Historique du ${new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR",
          { day: "numeric", month: "long", timeZone: "UTC" })}`,
        tone: "static",
      };
    }
    if (!enDirect) return { label: "Rejeu — écran figé", tone: "static" };

    const dernier = data?.lastPosition?.recorded_at ?? null;
    const minutes = dernier ? Math.round((Date.now() - Date.parse(dernier)) / 60000) : null;
    if (minutes === null) return { label: "En direct — aucune position reçue", tone: "stale" };
    if (minutes > 15) {
      return { label: `En direct — silencieux depuis ${minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`}`, tone: "stale" };
    }
    const age = refreshedAt ? Math.round((Date.now() - refreshedAt) / 1000) : null;
    return {
      label: `En direct${minutes <= 1 ? "" : ` · dernier point il y a ${minutes} min`}` +
             (age !== null && age > 60 ? ` · actualisé il y a ${Math.round(age / 60)} min` : ""),
      tone: "live",
    };
  })();

  const dayAgg = data?.daily?.find((d) => d.day === data.day);
  const device = data?.devices?.find((d) => d.vehicle_id === (vehicleId ?? data?.selectedVehicleId))
    ?? data?.devices?.[0];
  const lastSeen = ageLabel(data?.lastPosition?.recorded_at ?? null);
  const here = fixes[Math.min(cursor, Math.max(0, fixes.length - 1))];
  const isDemo = device?.vendor === "simulator";

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
                Position réelle, rejeu du trajet et écart avec les kilomètres déclarés
              </p>

              {/* État de la vue : on ne laisse jamais deviner si l'écran est
                  vivant ou figé sur un instant passé. */}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${
                  etatVue.tone === "live" ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
                  : etatVue.tone === "stale" ? "border-amber-700 bg-amber-950/40 text-amber-300"
                  : "border-gray-600 bg-gray-800 text-gray-300"}`}>
                  <span aria-hidden="true" className={`w-2 h-2 rounded-full ${
                    etatVue.tone === "live" ? "bg-emerald-400 motion-safe:animate-pulse"
                    : etatVue.tone === "stale" ? "bg-amber-400" : "bg-gray-500"}`} />
                  {etatVue.label}
                </span>

                {!enDirect && (
                  <button
                    onClick={revenirAuDirect}
                    className="min-h-[44px] px-4 rounded-lg bg-yellow-500 text-gray-900 font-semibold text-sm
                               hover:bg-yellow-400 transition-colors duration-200 cursor-pointer
                               focus:outline-none focus:ring-2 focus:ring-yellow-300"
                  >
                    Revenir au direct
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              {(data?.devices?.length ?? 0) > 1 && (
                <label className="text-sm">
                  <span className="block text-xs uppercase tracking-widest text-gray-400 mb-1">Véhicule</span>
                  <select
                    value={vehicleId ?? data?.selectedVehicleId ?? ""}
                    onChange={(e) => setVehicleId(e.target.value || null)}
                    className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 min-h-[44px]
                               focus:outline-none focus:ring-2 focus:ring-yellow-500 cursor-pointer"
                  >
                    {data?.devices.map((d) => (
                      <option key={d.id} value={d.vehicle_id ?? ""}>
                        {(d.plate ?? d.label ?? d.external_id).trim()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="text-sm">
                <span className="block text-xs uppercase tracking-widest text-gray-400 mb-1">Journée</span>
                <input
                  type="date" value={date} max={today()}
                  onChange={(e) => chooseDate(e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 min-h-[44px]
                             focus:outline-none focus:ring-2 focus:ring-yellow-500 cursor-pointer"
                />
              </label>
            </div>
          </div>
        </header>

        {isDemo && (
          <div className="mb-5 rounded-lg border border-blue-800 bg-blue-950/40 px-4 py-3">
            <p className="text-blue-200 text-sm">
              <span className="font-semibold">Démonstration</span> — ce véhicule est suivi par un
              boîtier simulé. Les positions sont fictives ; les kilomètres déclarés, eux, viennent
              bien de la base.
            </p>
          </div>
        )}

        {error && (
          <div role="alert" className="mb-6 rounded-lg border border-red-800 bg-red-950/50 p-4">
            <p className="text-red-300 text-sm">{error}</p>
            <button onClick={() => void load()}
              className="mt-2 text-sm text-red-200 underline hover:text-white cursor-pointer">
              Réessayer
            </button>
          </div>
        )}

        {data && !data.installed && (
          <div className="rounded-lg border border-amber-800 bg-amber-950/40 p-6">
            <h2 className="text-amber-200 font-semibold mb-2">Socle télématique non installé</h2>
            <p className="text-amber-100/80 text-sm">
              Appliquer les migrations 049 à 052 — voir docs/TELEMATICS/01-RUNBOOK.md.
            </p>
          </div>
        )}

        {data?.installed && data.devices.length === 0 && (
          <div className="rounded-lg border border-gray-700 bg-gray-800 p-8 text-center">
            <h2 className="text-white font-semibold mb-2">Aucun boîtier enrôlé</h2>
            <p className="text-gray-400 text-sm max-w-md mx-auto">
              Aucun traceur n&apos;est rattaché à un véhicule de cette organisation.
              L&apos;enrôlement se fait avec scripts/telematics-enroll.mjs.
            </p>
          </div>
        )}

        {data?.installed && data.devices.length > 0 && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
              <article className="bg-gray-800 border-l-4 border-yellow-500 rounded-lg p-4">
                <h2 className="text-xs uppercase text-gray-400 tracking-widest font-semibold">Dernier signal</h2>
                <p className={`text-xl sm:text-2xl font-bold font-mono mt-2 ${TONE[lastSeen.tone]}`}>
                  {lastSeen.text}
                </p>
                <p className="text-xs text-gray-500 mt-1 font-mono">{(device?.plate ?? device?.external_id ?? "").trim()}</p>
              </article>

              <article className="bg-gray-800 border-l-4 border-blue-500 rounded-lg p-4">
                <h2 className="text-xs uppercase text-gray-400 tracking-widest font-semibold">Km GPS du jour</h2>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono mt-2 tabular-nums">
                  {dayAgg ? (dayAgg.distance_m / 1000).toFixed(1) : "—"}
                  <span className="text-sm text-gray-400"> km</span>
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {dayAgg ? `${dayAgg.trips} trajet${dayAgg.trips > 1 ? "s" : ""}` : "pas encore calculé"}
                </p>
              </article>

              <article className="bg-gray-800 border-l-4 border-emerald-500 rounded-lg p-4">
                <h2 className="text-xs uppercase text-gray-400 tracking-widest font-semibold">Temps en mouvement</h2>
                <p className="text-xl sm:text-2xl font-bold text-white font-mono mt-2 tabular-nums">
                  {dayAgg ? fmtDuration(dayAgg.moving_s) : "—"}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {dayAgg ? `${fmtDuration(dayAgg.idle_s)} à l'arrêt` : ""}
                </p>
              </article>

              <article className="bg-gray-800 border-l-4 border-gray-500 rounded-lg p-4">
                <h2 className="text-xs uppercase text-gray-400 tracking-widest font-semibold">Couverture GPS</h2>
                <p className={`text-xl sm:text-2xl font-bold font-mono mt-2 tabular-nums ${
                  dayAgg ? (dayAgg.coverage >= 0.8 ? TONE.ok : TONE.warn) : "text-white"}`}>
                  {dayAgg ? `${Math.round(dayAgg.coverage * 100)} %` : "—"}
                </p>
                <p className="text-xs text-gray-500 mt-1 tabular-nums">
                  {data.positionCount} point{data.positionCount > 1 ? "s" : ""} reçus
                </p>
              </article>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
              {/* ── Carte et rejeu ──────────────────────────────────────── */}
              <section className="xl:col-span-2 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
                <h2 className="px-4 py-3 text-sm font-semibold text-white border-b border-gray-700">
                  Trajet du {new Date(`${data.day}T12:00:00Z`).toLocaleDateString("fr-FR", {
                    weekday: "long", day: "numeric", month: "long" })}
                </h2>

                {busy ? (
                  <div className="h-[420px] animate-pulse bg-gray-700/40" aria-label="Chargement de la carte" />
                ) : fixes.length === 0 ? (
                  <div className="h-[420px] flex flex-col items-center justify-center text-center px-6">
                    <p className="text-white font-medium">Aucune position ce jour-là</p>
                    <p className="text-gray-400 text-sm mt-2 max-w-sm">
                      Soit le boîtier n&apos;émettait pas encore, soit il n&apos;a pas eu de réseau.
                      Les journées sans donnée ne sont jamais comblées par une estimation.
                    </p>
                  </div>
                ) : (
                  <>
                    <div ref={mapEl} className="h-[420px] w-full"
                         role="img" aria-label={`Trajet du ${data.day}, ${data.positionCount} positions`} />

                    {/* Contrôles de rejeu */}
                    <div className="border-t border-gray-700 p-4">
                      <div className="flex items-center gap-3 flex-wrap">
                        <button
                          onClick={() => {
                            reprendreLaMain();
                            if (cursor >= fixes.length - 1) setCursor(0);
                            setPlaying((p) => !p);
                          }}
                          aria-label={playing ? "Mettre en pause le rejeu" : "Lancer le rejeu"}
                          className="inline-flex items-center justify-center gap-2 min-w-[44px] min-h-[44px] px-4
                                     rounded-lg bg-yellow-500 text-gray-900 font-semibold text-sm
                                     hover:bg-yellow-400 transition-colors duration-200 cursor-pointer
                                     focus:outline-none focus:ring-2 focus:ring-yellow-300"
                        >
                          {playing ? <IconPause /> : <IconPlay />}
                          {playing ? "Pause" : "Rejouer"}
                        </button>

                        <button
                          onClick={() => { reprendreLaMain(); setCursor(0); setPlaying(false); }}
                          aria-label="Revenir au début du trajet"
                          className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] px-3
                                     rounded-lg border border-gray-600 text-gray-300
                                     hover:text-white hover:border-gray-400 transition-colors duration-200
                                     cursor-pointer focus:outline-none focus:ring-2 focus:ring-yellow-500"
                        >
                          <IconRestart />
                        </button>

                        <div className="flex rounded-lg border border-gray-600 overflow-hidden" role="group"
                             aria-label="Vitesse de rejeu">
                          {SPEEDS.map((s, i) => (
                            <button
                              key={s.label}
                              onClick={() => setSpeedIdx(i)}
                              aria-pressed={speedIdx === i}
                              className={`min-h-[44px] px-3 text-sm font-mono transition-colors duration-200
                                          cursor-pointer focus:outline-none focus:ring-2 focus:ring-yellow-500
                                          ${speedIdx === i
                                            ? "bg-gray-600 text-white"
                                            : "text-gray-400 hover:text-white"}`}
                            >
                              {s.label}
                            </button>
                          ))}
                        </div>

                        <div className="ml-auto flex items-baseline gap-4 font-mono tabular-nums">
                          <span className="text-white text-lg">{here ? hhmmss(here.recorded_at) : "--:--:--"}</span>
                          <span className={`text-sm ${(here?.speed_kmh ?? 0) > 1 ? "text-emerald-400" : "text-gray-500"}`}>
                            {here?.speed_kmh != null ? `${Math.round(here.speed_kmh)} km/h` : "—"}
                          </span>
                        </div>
                      </div>

                      <label className="block mt-3">
                        <span className="sr-only">Position dans la journée</span>
                        <input
                          type="range" min={0} max={Math.max(0, fixes.length - 1)} value={cursor}
                          onChange={(e) => { reprendreLaMain(); setPlaying(false); setCursor(Number(e.target.value)); }}
                          className="w-full accent-yellow-500 cursor-pointer h-[44px]"
                        />
                      </label>

                      <p className="text-xs text-gray-500 font-mono tabular-nums">
                        point {cursor + 1} / {fixes.length}
                        {here && ` · ${here.latitude.toFixed(5)}, ${here.longitude.toFixed(5)}`}
                      </p>
                    </div>
                  </>
                )}
              </section>

              {/* ── Trajets du jour ─────────────────────────────────────── */}
              <section className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden flex flex-col">
                <h2 className="px-4 py-3 text-sm font-semibold text-white border-b border-gray-700">
                  Trajets détectés
                </h2>
                {(data.trips ?? []).length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">
                    Aucun trajet reconstruit pour cette journée.
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-700 overflow-y-auto max-h-[520px]">
                    {data.trips.map((t) => (
                      <li key={t.id}>
                        <button
                          onClick={() => focusTrip(t)}
                          className={`w-full text-left px-4 py-3 transition-colors duration-150 cursor-pointer
                                      focus:outline-none focus:ring-2 focus:ring-inset focus:ring-yellow-500
                                      ${tripId === t.id ? "bg-gray-700/60" : "hover:bg-gray-700/40"}`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-white font-mono tabular-nums text-sm">
                              {hhmm(t.started_at)} → {hhmm(t.ended_at)}
                            </span>
                            <span className="text-yellow-500 font-mono tabular-nums text-sm font-semibold">
                              {(t.distance_m / 1000).toFixed(1)} km
                            </span>
                          </div>

                          {/* D'où à où : sans cela, un trajet reste une durée et
                              un nombre. Tant qu'une adresse n'est pas résolue,
                              on montre les coordonnées plutôt qu'un lieu inventé. */}
                          <dl className="mt-1.5 space-y-0.5 text-xs">
                            <div className="flex gap-2">
                              <dt className="text-gray-500 font-mono tabular-nums shrink-0">{hhmm(t.started_at)}</dt>
                              <dd className="text-gray-300 truncate">
                                {t.start_address ?? `${t.start_latitude.toFixed(4)}, ${t.start_longitude.toFixed(4)}`}
                              </dd>
                            </div>
                            <div className="flex gap-2">
                              <dt className="text-gray-500 font-mono tabular-nums shrink-0">{hhmm(t.ended_at)}</dt>
                              <dd className="text-gray-300 truncate">
                                {t.end_address ?? `${t.end_latitude.toFixed(4)}, ${t.end_longitude.toFixed(4)}`}
                              </dd>
                            </div>
                          </dl>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400 tabular-nums">
                            <span>{fmtDuration(t.duration_s)}</span>
                            <span>{fmtDuration(t.idle_s)} à l&apos;arrêt</span>
                            {t.max_speed_kmh != null && <span>max {Math.round(t.max_speed_kmh)} km/h</span>}
                            <span className={t.confidence >= 0.9 ? "text-emerald-400"
                                            : t.confidence >= 0.6 ? "text-amber-400" : "text-red-400"}>
                              confiance {Math.round(t.confidence * 100)} %
                            </span>
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* ── Rapprochement ─────────────────────────────────────────── */}
            <section className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-700">
                <h2 className="text-sm font-semibold text-white">Km réels contre km déclarés</h2>
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
                          <tr key={r.day}
                              className={`transition-colors duration-150 cursor-pointer hover:bg-gray-700/40
                                          ${r.day === data.day ? "bg-gray-700/30" : ""}`}
                              onClick={() => chooseDate(r.day)}>
                            <td className="px-4 py-3 text-gray-200 font-mono tabular-nums">{r.day}</td>
                            <td className="px-4 py-3 text-right text-white font-mono tabular-nums">{r.km_gps ?? "—"}</td>
                            <td className="px-4 py-3 text-right text-white font-mono tabular-nums">{r.km_declares ?? "—"}</td>
                            <td className={`px-4 py-3 text-right font-mono tabular-nums ${
                              !usable ? "text-gray-500" : big ? TONE.warn : TONE.ok}`}>
                              {r.ecart_km === null ? "—"
                                : `${r.ecart_km > 0 ? "+" : ""}${r.ecart_km}${
                                    r.ecart_pct !== null ? ` (${r.ecart_pct > 0 ? "+" : ""}${r.ecart_pct} %)` : ""}`}
                            </td>
                            <td className={`px-4 py-3 text-right font-mono tabular-nums ${
                              (r.coverage ?? 0) >= 0.8 ? "text-gray-300" : TONE.warn}`}>
                              {r.coverage === null ? "—" : `${Math.round(r.coverage * 100)} %`}
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs">
                              {r.km_declares === null ? "aucune déclaration validée"
                                : (r.jours_couverts ?? 1) > 1
                                  ? `déclaration couvrant ${r.jours_couverts} jours — non comparable`
                                  : !usable ? "couverture GPS insuffisante"
                                  : big ? "écart à examiner"
                                  : "cohérent"}
                              {r.source === "import" && (
                                // Un historique repris d'une autre plateforme n'est pas une
                                // mesure M3A : le dire, sinon le chiffre serait sur-interprété.
                                <span className="block text-gray-500">reprise de l&apos;historique d&apos;origine</span>
                              )}
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
