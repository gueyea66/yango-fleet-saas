"use client";
// Choix du type d'absence (repos, panne, congé, malade) et sa pastille-lettre,
// partagés par le planning, l'app chauffeur et l'écran Déclarations.
import { ABSENCES, infoAbsence, type CategorieAbsence } from "@/lib/absence";

export function PastilleAbsence({ categorie, taille = 16, titre }: { categorie: CategorieAbsence; taille?: number; titre?: string }) {
  const a = infoAbsence(categorie);
  return (
    <span title={titre ?? a.label} aria-label={titre ?? a.label}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none",
        width: taille, height: taille, borderRadius: Math.round(taille / 4),
        background: a.couleur, color: "#fff", fontSize: Math.round(taille * 0.62), fontWeight: 800, lineHeight: 1,
      }}>
      {a.lettre}
    </span>
  );
}

export function ChoixAbsence({ value, onChange, disabled }: { value: CategorieAbsence; onChange: (c: CategorieAbsence) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Type d'absence" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
      {ABSENCES.map((a) => {
        const actif = a.key === value;
        return (
          <button key={a.key} type="button" role="radio" aria-checked={actif} disabled={disabled} onClick={() => onChange(a.key)}
            className="v2-focus"
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "10px 4px", borderRadius: 12,
              cursor: disabled ? "default" : "pointer", fontSize: 13, fontWeight: 600,
              background: actif ? a.couleur + "1f" : "var(--sk-deep)",
              border: `1.5px solid ${actif ? a.couleur : "var(--sk-surface)"}`,
              color: actif ? "var(--sk-t1)" : "var(--sk-t2)",
            }}>
            <PastilleAbsence categorie={a.key} taille={22} />
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
