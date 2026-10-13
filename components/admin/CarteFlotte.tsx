"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, LayerGroup } from "leaflet";

/**
 * Vue flotte : où sont, maintenant, les véhicules cochés.
 *
 * Volontairement sans trajet ni kilomètres : ces chiffres appartiennent à la
 * journée d'UN véhicule, et se lisent dans son détail. Ici on répond à une
 * seule question — qui est où — et un clic mène au détail.
 */

export type PointFlotte = {
  id: string;
  nom: string;
  position: { recorded_at: string; latitude: number; longitude: number; speed_kmh: number | null } | null;
};

/** Fraîcheur du signal : roule, vu récemment, silencieux. */
function etat(p: PointFlotte["position"]): { texte: string; couleur: string; classe: string } {
  if (!p) return { texte: "aucune position", couleur: "#6b7280", classe: "text-gray-400" };
  const min = Math.round((Date.now() - Date.parse(p.recorded_at)) / 60000);
  const age = min < 2 ? "à l'instant" : min < 60 ? `il y a ${min} min`
    : min < 2880 ? `il y a ${Math.round(min / 60)} h` : `il y a ${Math.round(min / 1440)} j`;
  if (min > 15) return { texte: `silencieux · ${age}`, couleur: "#f59e0b", classe: "text-amber-300" };
  const vitesse = Math.round(p.speed_kmh ?? 0);
  return vitesse > 3
    ? { texte: `${vitesse} km/h · ${age}`, couleur: "#10b981", classe: "text-emerald-400" }
    : { texte: `à l'arrêt · ${age}`, couleur: "#60a5fa", classe: "text-blue-300" };
}

export default function CarteFlotte({ points, chargement, onChoisir }: {
  points: PointFlotte[];
  chargement: boolean;
  onChoisir: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const couche = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  /** Sélection déjà cadrée : un rafraîchissement ne doit pas défaire le zoom choisi. */
  const cadre = useRef<string | null>(null);
  const [prete, setPrete] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      const mod = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (annule || !el.current || map.current) return;
      const L = mod.default;
      leaflet.current = L;
      map.current = L.map(el.current).setView([14.6937, -17.4441], 11);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: "© OpenStreetMap",
      }).addTo(map.current);
      couche.current = L.layerGroup().addTo(map.current);
      setPrete(true);
    })();
    return () => { annule = true; map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const L = leaflet.current;
    if (!prete || !L || !map.current || !couche.current) return;
    couche.current.clearLayers();
    const places = points.filter((p) => p.position);
    for (const p of places) {
      const e = etat(p.position);
      L.circleMarker([p.position!.latitude, p.position!.longitude], {
        radius: 9, color: "#ffffff", weight: 3, fillColor: e.couleur, fillOpacity: 1,
      })
        .bindTooltip(p.nom, { permanent: true, direction: "top", offset: [0, -10] })
        .on("click", () => onChoisir(p.id))
        .addTo(couche.current);
    }
    const cle = places.map((p) => p.id).sort().join(",");
    if (places.length && cadre.current !== cle) {
      cadre.current = cle;
      map.current.fitBounds(
        L.latLngBounds(places.map((p) => [p.position!.latitude, p.position!.longitude] as [number, number])),
        { padding: [48, 48], maxZoom: 15 },
      );
    }
  }, [points, prete, onChoisir]);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
      <section className="xl:col-span-2 bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
        <h2 className="px-4 py-3 text-sm font-semibold text-white border-b border-gray-700">
          Position actuelle de {points.length} véhicules
        </h2>
        <div className="relative">
          <div ref={el} className="h-[480px] w-full" role="img"
               aria-label={`Carte de ${points.length} véhicules`} />
          {chargement && (
            <div className="absolute inset-0 z-[1000] animate-pulse bg-gray-800/80" aria-label="Chargement des positions" />
          )}
        </div>
      </section>

      <section className="bg-gray-800 border border-gray-700 rounded-lg self-start">
        <h2 className="px-4 py-3 text-sm font-semibold text-white border-b border-gray-700">Véhicules</h2>
        <ul className="divide-y divide-gray-700">
          {points.map((p) => {
            const e = etat(p.position);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => onChoisir(p.id)}
                  className="w-full text-left px-4 py-3 min-h-[44px] hover:bg-gray-700/40 transition-colors duration-150
                             cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-yellow-500">
                  <span className="block text-white">{p.nom}</span>
                  <span className={`block text-xs mt-0.5 ${chargement ? "text-gray-500" : e.classe}`}>
                    {chargement ? "lecture…" : e.texte}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="px-4 py-3 text-xs text-gray-500 border-t border-gray-700">
          Un clic ouvre la journée du véhicule : trajets, kilomètres, rejeu.
        </p>
      </section>
    </div>
  );
}
