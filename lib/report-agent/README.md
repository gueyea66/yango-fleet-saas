# report-agent — noyau de rapports multi-agent RÉUTILISABLE

Moteur de génération de rapports d'activité « niveau consultant » : données
déterministes → panel d'agents LLM (analyste / risques / stratège / rédacteur)
→ HTML brandé imprimable.

## Contrat de portabilité (NE PAS CASSER)

1. **Zéro import hors de ce dossier.** Aucun import métier (Supabase, calc.ts,
   notifications…), aucun import de framework. Node/TS standard uniquement.
2. **Tout entre par injection** :
   - les données : un `ReportDataset` construit par un *adaptateur* externe
     (voir `lib/reportAdapters/fleet.ts` pour l'exemple M3A Fleet) ;
   - le LLM : une fonction `NarrateFn` (ici on injecte `lib/ai/llmGateway.narrate`) ;
   - la marque : un `BrandTheme` (couleurs, logo, nom, footer).
3. **Le LLM ne calcule JAMAIS.** Tous les chiffres viennent du dataset
   (champ `facts` + sections). Garde-fou `guard.ts` : toute narration citant un
   nombre absent du dataset est rejetée → repli déterministe
   (`deterministicInsights`), le rapport sort toujours.

## Réutiliser pour une autre solution (AutoRéconcile, OPTIM, …)

1. Copier ce dossier tel quel dans le nouveau projet.
2. Écrire un adaptateur : `(vos données) → ReportDataset` — c'est le seul
   travail spécifique métier.
3. Injecter votre client LLM (n'importe lequel : la signature est
   `(payloadJson, opts) => Promise<string | null>`).
4. Fournir votre `BrandTheme`. C'est tout.

## Fichiers

- `types.ts` — contrats (dataset, thème, narration, rôles d'agents)
- `agents.ts` — orchestration du panel (rôles en parallèle → rédacteur)
- `guard.ts` — garde anti-hallucination (autonome, copie assumée du gateway)
- `render.ts` — rendu HTML brandé (imprimable, bouton PDF)

## Coûts / latence

Panel par défaut = 3 rôles en parallèle + 1 rédacteur ≈ 2 latences LLM
(~30-90 s par rapport selon le modèle). Prévoir `maxDuration` en conséquence
côté route. Kill-switch global : env `REPORT_AGENT=off` (à câbler côté
appelant) → rapport déterministe seul.
