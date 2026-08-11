// Libellé plateforme par tenant (migration 038) — remplace le mot « Yango »
// dans les libellés de l'UI. Variable module partagée par les composants d'une
// même page : le setter est appelé juste avant un setState React, dont le
// re-render fait relire la valeur. Défaut 'Yango' = affichage historique.
// Affichage uniquement : colonnes DB, dataKeys et catégories stockées inchangés.

let current = "Yango";

export function setPlatformLabel(v: string | null | undefined) {
  current = (v || "Yango").trim() || "Yango";
}

export function platLabel(): string {
  return current;
}

// Réécrit un libellé de donnée (ex. catégorie de dépense « Solde Yango »)
// pour l'AFFICHAGE seulement — la valeur stockée reste intacte.
export function displayLabel(text: string): string {
  return current === "Yango" ? text : text.replace(/Yango/g, current);
}
