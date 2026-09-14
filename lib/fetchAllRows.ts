/**
 * Lecture COMPLÈTE d'une requête Supabase.
 *
 * PostgREST plafonne chaque réponse à 1000 lignes (max-rows). Au-delà, la
 * réponse est tronquée SANS erreur : les agrégats étaient donc calculés sur une
 * base partielle — charges sous-évaluées, donc marge et résultat surévalués.
 * Invisible tant qu'un tenant reste petit ; faux dès qu'il grossit (une flotte
 * de 15 véhicules dépasse 1000 charges en ~2 mois, 1000 rapports sur l'année).
 *
 * Usage — passer un CONSTRUCTEUR de requête (rejouée à chaque page) :
 *   const rows = await fetchAllRows(() =>
 *     admin.from("expenses").select("*").eq("tenant_id", t).order("expense_date"));
 *
 * Toujours ordonner la requête : sans `order`, la pagination par `range` n'a
 * pas d'ordre stable et peut dupliquer ou omettre des lignes.
 */
const PAGE = 1000;
const MAX_PAGES = 30; // garde-fou : 30 000 lignes par jeu de données

export async function fetchAllRows<T = any>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await build().range(p * PAGE, p * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
