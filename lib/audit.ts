import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

export interface AuditEntry {
  tenantId: string;
  userId?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  changes?: { before?: unknown; after?: unknown };
  ip?: string;
  userAgent?: string;
}

/**
 * Enregistre une action dans la table audit_logs.
 * Non-bloquant : les erreurs de logging ne font jamais planter l'opération principale.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await adminClient.from("audit_logs").insert({
      tenant_id:     entry.tenantId,
      user_id:       entry.userId ?? null,
      action:        entry.action,
      resource_type: entry.resourceType ?? null,
      resource_id:   entry.resourceId ?? null,
      changes:       entry.changes ?? null,
      ip_address:    entry.ip ?? null,
      user_agent:    entry.userAgent ?? null,
    });
  } catch (err) {
    console.error("[audit] Échec d'écriture audit_logs:", err);
  }
}
