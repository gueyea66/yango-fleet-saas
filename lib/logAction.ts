import { createClient } from "@/lib/supabase/client";

/**
 * Écriture du journal métier (fleet.action_logs) depuis les écrans.
 *
 * Pourquoi un helper : les six appels historiques étaient des
 * `void supabase.from("action_logs").insert({...})`. supabase-js ne LÈVE pas
 * sur erreur, il renvoie `{ error }` — donc quand la table s'est retrouvée sans
 * GRANT, les six écritures ont échoué en 42501 sans un mot dans la console, et
 * le Journal est resté vide depuis la mise en service sans que personne le voie.
 * Ici l'échec est au moins visible.
 *
 * L'auteur (actor_id, actor_role) et le tenant sont imposés par le trigger
 * `fleet.guard_action_logs` (migration 048) : un journal que le client peut
 * signer à la place de quelqu'un d'autre ne vaut rien, on ne les envoie plus.
 */
export interface ActionLogEntry {
  tenantId: string;
  entityType: "daily_report" | "expense";
  entityId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}

export function logAction(entry: ActionLogEntry): void {
  if (!entry.entityId) {
    console.warn("[journal] entrée ignorée — entity_id manquant", entry.action, entry.entityType);
    return;
  }
  const supabase = createClient() as any;
  void supabase
    .from("action_logs")
    .insert({
      tenant_id: entry.tenantId,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      metadata: entry.metadata ?? null,
    })
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) console.warn(`[journal] écriture refusée (${entry.entityType}/${entry.action}) :`, error.message);
    });
}
