"use client";

import { useEffect, useRef, useState } from "react";
import { Star } from "lucide-react";

/**
 * Bouton « Vue par défaut » : enregistrer la sélection en cours pour la
 * retrouver à chaque ouverture, y revenir, ou l'oublier.
 */
export function VueDefautMenu({ existe, onEnregistrer, onAppliquer, onOublier }: {
  existe: boolean;
  onEnregistrer: () => void;
  onAppliquer: () => void;
  onOublier: () => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const boite = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !boite.current?.contains(e.target as Node)) setOuvert(false);
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", fermer);
    return () => { document.removeEventListener("mousedown", fermer); document.removeEventListener("keydown", fermer); };
  }, [ouvert]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2400);
    return () => clearTimeout(t);
  }, [note]);

  const action = (f: () => void, texte: string) => () => { f(); setNote(texte); setOuvert(false); };
  const item = { display: "block", width: "100%", textAlign: "left" as const, padding: "9px 12px", border: "none", borderRadius: 8, background: "transparent", color: "var(--sk-t1)", fontSize: 13, cursor: "pointer" };

  return (
    <div ref={boite} style={{ position: "relative" }}>
      <button type="button" className="v2-btn v2-btn-outline v2-focus" aria-haspopup="menu" aria-expanded={ouvert}
        onClick={() => setOuvert((o) => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 12px", borderRadius: 9, border: "1px solid var(--sk-border)", background: "transparent", color: "var(--sk-t1)", fontSize: 13, cursor: "pointer" }}>
        <Star size={14} aria-hidden fill={existe ? "var(--tenant-color)" : "none"} style={{ color: existe ? "var(--tenant-color)" : "var(--sk-t2)" }} />
        {note ?? "Vue par défaut"}
      </button>
      {ouvert && (
        <div role="menu" className="rdt-entree" style={{ position: "absolute", right: 0, top: 40, zIndex: 30, width: 270, padding: 6, borderRadius: 12, border: "1px solid var(--sk-border)", background: "var(--sk-bg)", boxShadow: "var(--v2-toast-shadow)" }}>
          <button type="button" role="menuitem" className="v2-row" style={{ ...item, fontWeight: 600 }}
            onClick={action(onEnregistrer, "Vue enregistrée")}>
            Enregistrer la sélection actuelle
            <span style={{ display: "block", fontWeight: 400, fontSize: 12, color: "var(--v2-muted)", marginTop: 2 }}>
              Période, chauffeurs, type de véhicule et réglages de Performance, rouverts à chaque visite.
            </span>
          </button>
          {existe && (
            <>
              <button type="button" role="menuitem" className="v2-row" style={item} onClick={action(onAppliquer, "Vue rétablie")}>Revenir à ma vue par défaut</button>
              <button type="button" role="menuitem" className="v2-row" style={{ ...item, color: "var(--sk-t2)" }} onClick={action(onOublier, "Vue oubliée")}>Ne plus utiliser de vue par défaut</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
