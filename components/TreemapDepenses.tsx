"use client";

// Treemap des dépenses par catégorie, partagé par le mode avancé et le mode
// simple. Les deux écrans affichaient le même graphique en double : la moindre
// correction n'était appliquée qu'à un seul, et les lectures divergeaient.

import React, { useState } from "react";
import { ResponsiveContainer, Treemap, Tooltip } from "recharts";

export const EXPENSE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#a855f7"];

/** Gris neutre du bloc « Reste » : il n'est pas une dépense, il ne prend pas la couleur d'une catégorie. */
const COULEUR_RESTE = "#334155";

export interface Bloc {
  name: string;
  size: number;
  percent: number;
  couleur: string;
  // Recharts attend un dictionnaire ouvert pour les données d'un Treemap ;
  // c'est aussi ce qui fait remonter `percent` et `couleur` jusqu'à la cellule.
  [cle: string]: unknown;
}

// Cellule style Power BI : nom, montant et part selon la place disponible.
export function TreemapCell(props: any) {
  const { x, y, width, height, index, name, value, percent, depth, couleur } = props;
  if (depth === 0 || width <= 0 || height <= 0) return null;
  const fill = couleur ?? EXPENSE_COLORS[index % EXPENSE_COLORS.length];

  const showName = width > 60 && height > 28;
  const showValue = width > 110 && height > 58;
  const showPercent = width > 110 && height > 78;
  // Un bloc étroit reste visuellement imposant — le treemap doit remplir le
  // cadre, et une catégorie à 0,6 % s'étire en colonne. Sans chiffre, elle
  // passe pour un poste majeur. La part s'affiche donc dès qu'il y a deux
  // lignes de place, même quand le montant, lui, ne tient pas.
  const partCompacte = showName && !showPercent && height > 44;
  const part = typeof percent === "number" ? percent.toFixed(1) : "—";

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={4}
        style={{ fill, stroke: "var(--sk-bg)", strokeWidth: 3 }} />
      {showName && (
        <text x={x + 10} y={y + 22} fill="#fff" fontSize={13} fontWeight={700}>{name}</text>
      )}
      {showValue && (
        <text x={x + 10} y={y + 42} fill="rgba(255,255,255,0.92)" fontSize={12} fontFamily="ui-monospace, monospace">
          {Math.round(value).toLocaleString("fr-FR")}
        </text>
      )}
      {showPercent && (
        <text x={x + 10} y={y + 62} fill="rgba(255,255,255,0.75)" fontSize={12} fontFamily="ui-monospace, monospace">
          {part}%
        </text>
      )}
      {partCompacte && (
        <text x={x + 10} y={y + 40} fill="rgba(255,255,255,0.8)" fontSize={11} fontFamily="ui-monospace, monospace">
          {part}%
        </text>
      )}
    </g>
  );
}

const VUES = [
  { id: "charges" as const, label: "Part des charges" },
  { id: "ca" as const, label: "Part du CA" },
];

export interface TreemapDepensesProps {
  breakdown: Array<{ type: string; amount: number; percent: number }>;
  /** Chiffre d'affaires de la période — celui du hero « Total Recettes ». */
  ca: number;
  /** Rendu à gauche du sélecteur ; absent, le sélecteur occupe seul la ligne. */
  titre?: React.ReactNode;
  hauteur?: number;
  /** Mise en forme du nom de catégorie (le mode simple masque le nom de plateforme). */
  label?: (type: string) => string;
  legende?: boolean;
  tooltipStyle?: React.CSSProperties;
}

/**
 * Dépenses par catégorie, sous deux lectures.
 *
 * « Part des charges » répond à : où part l'argent que je dépense ? C'est la
 * lecture d'origine, inchangée.
 *
 * « Part du CA » répond à l'autre question, souvent la plus décisive : combien
 * de mon chiffre d'affaires chaque poste mange-t-il, et que reste-t-il ? Dans
 * cette vue, le rectangle entier vaut le CA et un bloc neutre « Reste » ferme
 * la somme. Sans ce bloc, des catégories qui ne remplissent pas le cadre
 * laisseraient croire qu'elles valent 100 % — c'est-à-dire exactement le
 * malentendu que cette vue existe pour lever.
 */
export default function TreemapDepenses({
  breakdown,
  ca,
  titre,
  hauteur = 280,
  label = (t) => t,
  legende = true,
  tooltipStyle,
}: TreemapDepensesProps) {
  const [vue, setVue] = useState<"charges" | "ca">("charges");

  const totalCharges = breakdown.reduce((s, c) => s + c.amount, 0);
  const caConnu = ca > 0;
  // Un CA inconnu ne peut pas servir de référence : plutôt que d'afficher des
  // pourcentages d'un zéro, on retombe sur la lecture par charges.
  const v = caConnu ? vue : "charges";
  const reste = ca - totalCharges;
  const partCharges = caConnu ? (totalCharges / ca) * 100 : null;

  const blocs: Bloc[] = [
    ...breakdown.map((cat, i) => ({
      name: label(cat.type),
      size: cat.amount,
      percent: v === "ca" ? (cat.amount / ca) * 100 : cat.percent,
      couleur: EXPENSE_COLORS[i % EXPENSE_COLORS.length],
    })),
    // Le reste n'existe que s'il est positif : inventer un bloc pour un déficit
    // le rendrait invisible alors que c'est l'information à voir.
    ...(v === "ca" && reste > 0
      ? [{ name: "Reste", size: reste, percent: (reste / ca) * 100, couleur: COULEUR_RESTE }]
      : []),
  ];

  const reference = v === "ca" ? "du CA" : "des charges";
  const style = tooltipStyle ?? {
    backgroundColor: "var(--sk-bg)", border: "1px solid var(--sk-surface)",
    borderRadius: 8, fontSize: 12,
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          {titre}
          <p className="text-xs" style={{ color: "var(--sk-t3)" }}>
            {v === "ca"
              ? "Le rectangle entier vaut le CA de la période — chaque bloc, ce qu'il en consomme"
              : "Taille des blocs proportionnelle au montant sur la période"}
          </p>
        </div>

        {/* Deux lectures du même montant : le sélecteur dit laquelle est active,
            et reste désactivé tant qu'il n'y a pas de CA à comparer. */}
        <div role="group" aria-label="Référence du pourcentage"
          className="inline-flex rounded-lg p-0.5 shrink-0" style={{ background: "var(--sk-surface)" }}>
          {VUES.map((o) => {
            const actif = v === o.id;
            const inerte = o.id === "ca" && !caConnu;
            return (
              <button key={o.id} type="button" onClick={() => setVue(o.id)}
                aria-pressed={actif} disabled={inerte}
                title={inerte ? "Aucune recette enregistrée sur la période" : undefined}
                className="px-3 h-9 rounded-md text-xs font-semibold transition-colors duration-150
                           cursor-pointer disabled:cursor-not-allowed disabled:opacity-40
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                style={actif
                  ? { background: "var(--sk-bg)", color: "#fff" }
                  : { color: "var(--sk-t3)", background: "transparent" }}>
                {o.label}
              </button>
            );
          })}
        </div>
      </div>

      <div role="img" aria-label={
        `${v === "ca"
          ? `Répartition du chiffre d'affaires de ${Math.round(ca).toLocaleString("fr-FR")}`
          : `Répartition des charges de ${Math.round(totalCharges).toLocaleString("fr-FR")}`} : ` +
        blocs.map((b) => `${b.name} ${b.percent.toFixed(1)} %`).join(", ")
      }>
        <ResponsiveContainer width="100%" height={hauteur}>
          <Treemap data={blocs} dataKey="size" aspectRatio={16 / 9}
            isAnimationActive={false} content={<TreemapCell />}>
            <Tooltip contentStyle={style}
              formatter={(val: any, _n: any, entry: any) => [
                Number(val).toLocaleString("fr-FR") + " (" +
                  (typeof entry?.payload?.percent === "number" ? entry.payload.percent.toFixed(1) : "—") +
                  " % " + reference + ")",
                entry?.payload?.name,
              ]} />
          </Treemap>
        </ResponsiveContainer>
      </div>

      {legende && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
          {blocs.map((b) => (
            <div key={b.name} className="flex items-center gap-1.5 text-xs">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: b.couleur }} />
              <span style={{ color: "var(--sk-t2)" }}>{b.name}</span>
            </div>
          ))}
        </div>
      )}

      {v === "ca" && partCharges !== null && (
        <p className="text-xs mt-3 tabular-nums"
          style={{ color: reste > 0 ? "var(--sk-t3)" : "#f59e0b" }}>
          {reste > 0
            ? `Les charges consomment ${partCharges.toFixed(1)} % du CA — il reste ${Math.round(reste).toLocaleString("fr-FR")}.`
            : `Les charges dépassent le CA de ${Math.round(-reste).toLocaleString("fr-FR")} sur la période.`}
        </p>
      )}
    </>
  );
}
