import { createClient } from "@supabase/supabase-js";

/**
 * Client service_role dédié à la couche IA (schéma fleet).
 * Serveur uniquement — bypasse la RLS : il n'est utilisé que par les batchs
 * et les routes /api/ai/* qui filtrent TOUJOURS explicitement par tenant_id.
 */
function makeClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: "fleet" } }
  );
}

let cached: ReturnType<typeof makeClient> | null = null;

export function aiAdmin(): ReturnType<typeof makeClient> {
  if (!cached) cached = makeClient();
  return cached;
}
