/**
 * Balayage des tables `fleet` qui ont une policy « FOR ALL tenant » (migration 020)
 * mais AUCUNE garde d'écriture (migration 039) : que peut y écrire un chauffeur
 * avec la seule clé anon ? Chaque ligne créée est supprimée aussitôt.
 * Usage : node scripts/nmk-rls-gap-scan.mjs
 */
import { env, select, remove } from "./nmk-lib.mjs";

const T = "1250ac49-9a4c-46b2-84db-dddd8a44aedc";
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "driver-NMK01@internal.yango", password: "Nmk2026!" }),
});
const { access_token: tok, user } = await r.json();
const uid = user.id;
const veh = (await select("vehicles", `select=id&tenant_id=eq.${T}&limit=1`))[0];

const q = async (method, path, body) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json",
      "Accept-Profile": "fleet", "Content-Profile": "fleet", Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const txt = await res.text();
  let json = null; try { json = JSON.parse(txt); } catch { /* texte */ }
  return { status: res.status, json, body: txt.replace(/\s+/g, " ").slice(0, 120) };
};

const cibles = [
  ["vehicle_maintenance", { tenant_id: T, vehicle_id: veh.id, description: "SONDE RLS À SUPPRIMER", cost: 1 }],
  ["uploads", { tenant_id: T, driver_id: uid, file_name: "sonde-rls.txt", file_path: `${T}/sonde-rls.txt`, file_type: "report", file_size: 1 }],
  ["notifications", { tenant_id: T, title: "SONDE RLS", body: "à supprimer", type: "info" }],
  ["kyc_documents", { tenant_id: T, driver_id: uid, doc_type: "permis", file_path: `${T}/${uid}/sonde.pdf`, status: "pending" }],
  ["action_logs", { tenant_id: T, action: "SONDE RLS" }],
  ["import_batches", { tenant_id: T, status: "SONDE RLS" }],
  ["leads", { company: "SONDE RLS", email: "sonde@example.test" }],
  ["tenants", { slug: "sonde-rls", name: "SONDE RLS" }],
];

const trous = [];
for (const [table, row] of cibles) {
  const res = await q("POST", table, row);
  if (res.status < 400) {
    trous.push(table);
    const id = res.json?.[0]?.id;
    let net = "non supprimée ⚠";
    if (id) {
      const del = await q("DELETE", `${table}?id=eq.${id}`);
      if (del.status < 400) net = "supprimée ✓";
      else { try { await remove(table, `id=eq.${id}`); net = "supprimée via service_role ✓"; } catch (e) { net = `RESTE EN BASE (${e.message.slice(0, 60)})`; } }
    }
    console.log(`🚨 ${table.padEnd(20)} écriture ACCEPTÉE (HTTP ${res.status}) — sonde ${net}`);
  } else {
    console.log(`✅ ${table.padEnd(20)} refusée — HTTP ${res.status} ${res.body.slice(0, 80)}`);
  }
}

console.log(trous.length
  ? `\n🚨 Tables où un chauffeur peut écrire : ${trous.join(", ")}`
  : `\n✅ Aucune autre table écrivable par un chauffeur`);
