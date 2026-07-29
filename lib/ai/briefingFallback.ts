/**
 * Fallback déterministe du briefing : si la narration LLM échoue (indisponible
 * ou rejetée par le garde anti-hallucination), les points sont générés ici,
 * en pur code, à partir des mêmes faits calculés. Badge « Calculé » côté UI
 * (narrative_source = "deterministic") — le briefing n'est jamais vide.
 */

export interface PalierFact {
  prenom: string;
  palier_fcfa: number | null;
  manque_total_fcfa: number;
  rythme_actuel_fcfa_par_jour: number;
  besoin_fcfa_par_jour_pour_palier: number;
  effort_supplementaire_fcfa_par_jour: number;
  jours_restants: number;
  atteignable: boolean;
}

export interface MouvementFact {
  poste: string;
  delta_fcfa: number;
  sens: "hausse" | "baisse";
}

const fmt = (v: number) => new Intl.NumberFormat("fr-FR").format(Math.round(v));

export function buildDeterministicBriefing(facts: {
  paliers: PalierFact[];
  mouvements: MouvementFact[];
  netProjete: number;
  joursRestantsMois: number;
}): { points: string[]; action: string | null } {
  const points: string[] = [];

  for (const p of facts.paliers.slice(0, 2)) {
    if (!p.palier_fcfa) continue;
    if (p.atteignable) {
      points.push(
        `${p.prenom} est à ${fmt(p.rythme_actuel_fcfa_par_jour)} FCFA/j ; il lui faut ` +
        `${fmt(p.besoin_fcfa_par_jour_pour_palier)} FCFA/j sur ${p.jours_restants} j pour le palier ` +
        `de ${fmt(p.palier_fcfa)} FCFA (soit +${fmt(p.effort_supplementaire_fcfa_par_jour)} FCFA/j).`
      );
    } else {
      points.push(
        `Le palier de ${fmt(p.palier_fcfa)} FCFA est hors de portée ce mois pour ${p.prenom} ` +
        `(il faudrait ${fmt(p.besoin_fcfa_par_jour_pour_palier)} FCFA/j contre ` +
        `${fmt(p.rythme_actuel_fcfa_par_jour)} FCFA/j actuellement) — préparer le mois prochain.`
      );
    }
  }

  const m = facts.mouvements[0];
  if (m) {
    points.push(`Dépenses « ${m.poste} » en ${m.sens} de ${fmt(Math.abs(m.delta_fcfa))} FCFA vs semaine précédente.`);
  }

  if (points.length < 3 && facts.joursRestantsMois >= 0) {
    points.push(`Fin de mois projetée à ${fmt(facts.netProjete)} FCFA (${facts.joursRestantsMois} j restants, avant salaires).`);
  }

  let action: string | null = null;
  const cible = facts.paliers.find((p) => p.atteignable && p.effort_supplementaire_fcfa_par_jour > 0);
  if (cible) {
    action = `Suivre ${cible.prenom} aujourd'hui : +${fmt(cible.effort_supplementaire_fcfa_par_jour)} FCFA/j ` +
      `pendant ${cible.jours_restants} j pour décrocher le palier.`;
  } else if (m && m.sens === "hausse") {
    action = `Vérifier les justificatifs du poste « ${m.poste} » (+${fmt(Math.abs(m.delta_fcfa))} FCFA en 7 j).`;
  }

  return { points: points.slice(0, 3), action };
}
