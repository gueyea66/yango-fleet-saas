"use client";

import { useState } from "react";

/**
 * Lecteur vidéo à activation manuelle : la vidéo (16 Mo) n'est chargée
 * qu'au clic — évite de pénaliser les visiteurs mobiles/3G qui n'auraient
 * pas demandé la lecture (cible commerciale : Afrique de l'Ouest).
 */
export default function DemoVideo({ poster, src }: { poster: string; src: string }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <video
        className="w-full h-full rounded-2xl"
        src={src}
        poster={poster}
        controls
        autoPlay
        playsInline
      />
    );
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      className="group relative w-full h-full rounded-2xl overflow-hidden cursor-pointer"
      aria-label="Lancer la vidéo de démonstration M3A Fleet"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={poster}
        alt="Aperçu du dashboard M3A Fleet"
        className="w-full h-full object-cover"
        loading="lazy"
      />
      <div
        className="absolute inset-0 flex items-center justify-center transition-colors group-hover:bg-black/50"
        style={{ background: "rgba(8,10,15,0.55)" }}
      >
        <span
          className="flex items-center justify-center w-20 h-20 rounded-full shadow-lg transition-transform group-hover:scale-110"
          style={{ background: "#f5a623" }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M8 5v14l11-7-11-7z" fill="#080a0f" />
          </svg>
        </span>
      </div>
      <div
        className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-sm"
        style={{ color: "var(--sk-t1)" }}
      >
        <span className="font-medium">Voir la démonstration — 4 min</span>
        <span style={{ color: "var(--sk-t2)" }}>Écrans réels, données fictives</span>
      </div>
    </button>
  );
}
