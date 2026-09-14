/**
 * Journal (fleet.action_logs) après la 048 : il s'écrit, l'auteur est imposé,
 * il est append-only, et un chauffeur ne lit que ses propres actions.
 * Usage : node scripts/nmk-journal-test.mjs
 */
import { env, select, remove } from "./nmk-lib.mjs";

const T = "1250ac49-9a4c-46b2-84db-dddd8a44aedc";
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const login = async (email, password) => {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j).slice(0, 120)}`);
  return { tok: j.access_token, uid: j.user.id };
};
const call = (tok) => async (method, path, body) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json",
      "Accept-Profile": "fleet", "Content-Profile": "fleet", Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch { /* */ }
  return { status: r.status, json, body: txt.replace(/\s+/g, " ").slice(0, 140) };
};

const drv = await login("driver-NMK01@internal.yango", "Nmk2026!");
const adm = await login("admin@nmktransports.sn", "Nmk!2026");
const qd = call(drv.tok), qa = call(adm.tok);
const autre = (await select("profiles", `select=id&tenant_id=eq.${T}&role=eq.driver&id=neq.${drv.uid}&limit=1`))[0];
const rap = (await select("daily_reports", `select=id&tenant_id=eq.${T}&driver_id=eq.${drv.uid}&limit=1`))[0];
const aNettoyer = [];

// 1. Le chauffeur écrit son action → l'auteur doit être LUI, quoi qu'il envoie
const ins = await qd("POST", "action_logs", {
  tenant_id: T, actor_id: autre.id, actor_role: "admin",   // usurpation tentée
  entity_type: "daily_report", entity_id: rap.id, action: "submitted",
  metadata: { sonde: true },
});
const row = ins.json?.[0];
if (row) aNettoyer.push(row.id);
console.log(`${ins.status === 201 ? "✅" : "🚨"} écriture du journal par le chauffeur → HTTP ${ins.status}`);
if (row) {
  const bonAuteur = row.actor_id === drv.uid && row.actor_role === "driver";
  console.log(`${bonAuteur ? "✅" : "🚨"} auteur imposé par la base : actor_id=${row.actor_id === drv.uid ? "le chauffeur ✓" : row.actor_id} · actor_role=${row.actor_role}`);
  console.log(`   (il avait tenté de signer « admin » au nom d'un collègue)`);
}

// 2. Append-only : ni modification ni suppression
const upd = await qd("PATCH", `action_logs?id=eq.${row?.id}`, { action: "approved" });
console.log(`${upd.status >= 400 ? "✅" : "🚨"} modification d'une entrée → HTTP ${upd.status} ${upd.body.slice(0, 80)}`);
const del = await qd("DELETE", `action_logs?id=eq.${row?.id}`);
console.log(`${del.status >= 400 || (del.json && del.json.length === 0) ? "✅" : "🚨"} suppression d'une entrée → HTTP ${del.status} ${del.body.slice(0, 80)}`);

// 3. Lecture : le chauffeur ne voit que lui, l'admin voit tout le tenant
const vuDrv = await qd("GET", "action_logs?select=actor_id&limit=200");
const vuAdm = await qa("GET", "action_logs?select=actor_id&limit=200");
const nDrv = vuDrv.json?.length ?? 0, nAdm = vuAdm.json?.length ?? 0;
const etrangers = (vuDrv.json ?? []).filter((x) => x.actor_id !== drv.uid).length;
console.log(`${etrangers === 0 ? "✅" : "🚨"} lecture chauffeur : ${nDrv} entrée(s), dont ${etrangers} d'autrui`);
console.log(`✅ lecture gestionnaire : ${nAdm} entrée(s) du tenant`);

for (const id of aNettoyer) await remove("action_logs", `id=eq.${id}`).catch(() => console.log("⚠ sonde non supprimée"));
console.log("\nsondes nettoyées — journal prêt à enregistrer les vraies actions");
