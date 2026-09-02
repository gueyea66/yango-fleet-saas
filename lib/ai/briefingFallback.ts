/**
 * Fallback déterministe du briefing : si la narration LLM échoue (indisponible
 * ou rejetée par le garde anti-hallucination), les points sont générés ici,
 * en pur code, à partir des mêmes faits calculés. Badge « Calculé » côté UI
 * (narrative_source = "deterministic") — le briefing n'est jamais vide.
 *
 * Mêmes règles éditoriales que le prompt LLM (retour Abdou 02/09) :
 * en début de mois on juge la TRAJECTOIRE (jamais « hors de portée » avec
 * 2 jours de données), et un mouvement de dépense est cité AVEC ce qui le
 * compose (commentaires saisis), pas en delta sec.
 */

export interface PalierFact {
  prenom: string;
  palier_fcfa: number | null;
  manque_total_fcfa: number;
  rythme_actuel_fcfa_par_jour: number;
  besoin_fcfa_par_jour_pour_palier: number;
  effort_supplementaire_fcfa_par_jour: number;
  /** Jours OUVRÉS restants (règle 6/7 — repos exclus), cohérent avec le besoin/j. */
  jours_ouvres_restants: number;
  atteignable: boolean;
  rythme_requis_sur_le_mois_fcfa_par_jour?: number;
  ecart_vs_trajectoire_fcfa_par_jour?: number;
  sur_trajectoire?: boolean;
}

export interface MouvementFact {
  poste: string;
  delta_fcfa: number;
  sens: "hausse" | "baisse";
  /** Lignes qui composent le poste cette semaine (montant + commentaire saisi). */
  lignes?: Array<{ montant_fcfa: number; libelle: string }>;
}

const fmt = (v: number) => new Intl.NumberFormat("fr-FR").format(Math.round(v));

function mouvementPoint(m: MouvementFact): string {
  const base = `Dépenses « ${m.poste} » en ${m.sens} de ${fmt(Math.abs(m.delta_fcfa))} FCFA vs semaine précédente`;
  const detail = (m.lignes ?? [])
    .filter((l) => l.libelle && l.libelle !== "(sans commentaire)")
    .slice(0, 2)
    .map((l) => `${l.libelle} (${fmt(l.montant_fcfa)} FCFA)`)
    .join(", ");
  if (detail) return `${base} — dont ${detail}.`;
  const first = (m.lignes ?? [])[0];
  if (first) return `${base} — principale ligne : ${fmt(first.montant_fcfa)} FCFA sans commentaire, à documenter.`;
  return `${base}.`;
}

export function buildDeterministicBriefing(facts: {
  paliers: PalierFact[];
  mouvements: MouvementFact[];
  netProjete: number;
  joursRestantsMois: number;
}): { points: string[]; action: string | null } {
  const points: string[] = [];
  // > 20 jours restants = début de mois : l'écart total au palier est trivial,
  // seul le rythme comparé à la trajectoire du mois est un signal.
  const debutDeMois = facts.joursRestantsMois > 20;

  for (const p of facts.paliers.slice(0, 2)) {
    if (!p.palier_fcfa) continue;
    if (debutDeMois && p.rythme_requis_sur_le_mois_fcfa_par_jour != null) {
      if (p.sur_trajectoire) {
        points.push(
          `${p.prenom} est SUR la trajectoire du palier ${fmt(p.palier_fcfa)} FCFA : ` +
          `${fmt(p.rythme_actuel_fcfa_par_jour)} FCFA/j pour ${fmt(p.rythme_requis_sur_le_mois_fcfa_par_jour)} requis.`
        );
      } else {
        points.push(
          `${p.prenom} démarre le mois SOUS la trajectoire du palier ${fmt(p.palier_fcfa)} FCFA : ` +
          `${fmt(p.rythme_actuel_fcfa_par_jour)} FCFA/j contre ${fmt(p.rythme_requis_sur_le_mois_fcfa_par_jour)} requis — ` +
          `écart de ${fmt(Math.abs(p.ecart_vs_trajectoire_fcfa_par_jour ?? 0))} FCFA/j à corriger dès maintenant.`
        );
      }
    } else if (p.atteignable) {
      points.push(
        `${p.prenom} est à ${fmt(p.rythme_actuel_fcfa_par_jour)} FCFA/j ; il lui faut ` +
        `${fmt(p.besoin_fcfa_par_jour_pour_palier)} FCFA/j sur ${p.jours_ouvres_restants} j travaillés pour le palier ` +
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
  if (m) points.push(mouvementPoint(m));

  if (points.length < 3 && facts.joursRestantsMois >= 0) {
    points.push(`Fin de mois projetée à ${fmt(facts.netProjete)} FCFA (${facts.joursRestantsMois} j restants, avant salaires).`);
  }

  let action: string | null = null;
  const sousTrajectoire = debutDeMois
    ? facts.paliers.find((p) => p.sur_trajectoire === false && (p.ecart_vs_trajectoire_fcfa_par_jour ?? 0) < 0)
    : undefined;
  const cible = facts.paliers.find((p) => p.atteignable && p.effort_supplementaire_fcfa_par_jour > 0);
  if (sousTrajectoire) {
    action = `Fixer le cap du jour avec ${sousTrajectoire.prenom} : ` +
      `+${fmt(Math.abs(sousTrajectoire.ecart_vs_trajectoire_fcfa_par_jour ?? 0))} FCFA/j pour recoller à la trajectoire du palier.`;
  } else if (cible) {
    action = `Suivre ${cible.prenom} aujourd'hui : +${fmt(cible.effort_supplementaire_fcfa_par_jour)} FCFA/j ` +
      `pendant ${cible.jours_ouvres_restants} j travaillés pour décrocher le palier.`;
  } else if (m && m.sens === "hausse") {
    action = `Vérifier les justificatifs du poste « ${m.poste} » (+${fmt(Math.abs(m.delta_fcfa))} FCFA en 7 j).`;
  }

  return { points: points.slice(0, 3), action };
}
