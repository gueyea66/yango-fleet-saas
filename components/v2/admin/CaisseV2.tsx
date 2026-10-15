"use client";

import type { CSSProperties } from "react";
import type { ACaisse } from "@/lib/calc";
import { formatAmount } from "@/lib/v2/format";

/**
 * Carte « À verser en caisse » : le chiffre à rapprocher du comptage de la
 * caisse, mis en avant, avec son calcul sous les yeux pour retrouver un écart.
 * Affichée sur le tableau de bord et en tête de Finance (demande d'Abdou,
 * 15/10/2026) : un seul composant, pour que les deux écrans disent la même chose.
 */
export function CaisseCardV2({ caisse, plat, style }: { caisse: ACaisse; plat: string; style?: CSSProperties }) {
  return (
    <div style={{ borderRadius: 14, background: "var(--sk-bg)", padding: "18px 20px", border: "2px solid var(--tenant-color)", ...style }} aria-label="Argent à verser en caisse">
      <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>À verser en caisse</div>
      <div className="v2-num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em", marginTop: 10, color: caisse.montant < 0 ? "var(--v2-negative-ink)" : undefined }}>{formatAmount(caisse.montant)}</div>
      <div style={{ fontSize: 12, color: "var(--v2-muted)", marginTop: 6, lineHeight: 1.5 }}>
        espèces {plat} <span className="v2-num">{formatAmount(caisse.especes)}</span>
        {caisse.horsPlateforme > 0 && <> + hors {plat} <span className="v2-num">{formatAmount(caisse.horsPlateforme)}</span></>}
        {caisse.avances > 0 && <> + avances <span className="v2-num">{formatAmount(caisse.avances)}</span></>}
        {" "}− dépenses <span className="v2-num">{formatAmount(caisse.charges)}</span>
        <div>hors carte, commissions, achats de solde et amortissement</div>
      </div>
    </div>
  );
}
