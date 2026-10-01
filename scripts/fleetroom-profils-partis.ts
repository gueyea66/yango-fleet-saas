/**
 * NMK : profils INACTIFS des chauffeurs partis en 2026, sans compte de connexion,
 * pour rattacher leur historique Fleetroom (Mazda AB035EQ, Nissan AB922ER).
 * Passe par la clé serveur (fleet.is_trusted_server), comme l'app. Idempotent.
 * Puis recalcul complet des déclarations Fleetroom du tenant.
 *
 *   npx ts-node --transpile-only -O '{"module":"commonjs","moduleResolution":"node"}' scripts/fleetroom-profils-partis.ts
 */
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { getVirtualEmailForDriver } from "../lib/auth/utils"; // même convention que l'app, sans compte auth

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

// Bah et Mballo roulaient déjà au 01/01 : date d'entrée inconnue.
const PARTIS = [
  { full_name: "Bah Abdourahmane",    driver_id: "D12", hire_date: null,         contract_end_date: "2026-04-14", yango_driver_id: "572cf56cab8e4c5587d2ae67150f733f" },
  { full_name: "Diao Mamadou Lamine", driver_id: "D13", hire_date: "2026-02-02", contract_end_date: "2026-03-13", yango_driver_id: "af694963fa554e06a437b3d662e76663" },
  { full_name: "Diamanka Abdoulaye",  driver_id: "D14", hire_date: "2026-02-14", contract_end_date: "2026-03-13", yango_driver_id: "d842afb39eef4255976c4415d2b0d77e" },
  { full_name: "Balde Braima",        driver_id: "D15", hire_date: "2026-03-02", contract_end_date: "2026-03-13", yango_driver_id: "31435cbfdfa04114af74eaa635149bc6" },
  { full_name: "Mballo Ismaila",      driver_id: "D16", hire_date: null,         contract_end_date: "2026-07-10", yango_driver_id: "3dc27bdd2b4f498eb6095e9638ee5d34" },
];

(async () => {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    realtime: { transport: class {} as any },
  });
  const db = sb.schema("fleet");
  const { data: t } = await db.from("tenants").select("id").eq("slug", "nmk").single();
  if (!t) throw new Error("tenant nmk introuvable");

  const { data: known } = await db.from("profiles").select("yango_driver_id").eq("tenant_id", t.id);
  const have = new Set((known ?? []).map((p) => p.yango_driver_id));
  const toCreate = PARTIS.filter((p) => !have.has(p.yango_driver_id)).map((p) => ({
    ...p, id: randomUUID(), tenant_id: t.id, email: getVirtualEmailForDriver(p.driver_id), role: "driver", account_type: "driver", active: false, solde_initial: 0,
  }));
  if (toCreate.length) {
    const { error } = await db.from("profiles").insert(toCreate);
    if (error) throw new Error(`création profils : ${error.message}`);
  }
  console.log(`profils créés : ${toCreate.map((p) => p.full_name).join(", ") || "aucun (déjà présents)"}`);

  const { data, error } = await db.rpc("fleetroom_rebuild", { p_tenant: t.id, p_from: "2000-01-01", p_to: "2099-12-31" });
  if (error) throw new Error(`recalcul : ${error.message}`);
  console.log(JSON.stringify(data, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
