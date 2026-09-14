/**
 * Introspection lecture seule du schéma fleet — prépare le seed NMK.
 * Usage : node scripts/nmk-introspect.mjs
 */
import { select } from "./nmk-lib.mjs";

const tables = ["tenants", "tenant_settings", "profiles", "vehicles", "daily_reports",
  "expenses", "remuneration_config", "payments", "vehicle_maintenance", "ai_settings", "ai_config"];

for (const t of tables) {
  try {
    const rows = await select(t, "select=*&limit=1");
    console.log(`\n## ${t}`);
    console.log(rows?.[0]
      ? Object.entries(rows[0]).map(([k, v]) => `  ${k}: ${JSON.stringify(v)?.slice(0, 70)}`).join("\n")
      : "  (vide)");
  } catch (e) { console.log(`\n## ${t}: ERREUR ${e.message}`); }
}

const tn = await select("tenants", "select=id,slug,name,active,plan,account_type,currency,trial_ends_at,plan_expires_at&order=created_at");
console.log("\n## TENANTS\n", JSON.stringify(tn, null, 1));
