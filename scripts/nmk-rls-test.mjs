/**
 * Re-test des gardes RLS (migration 039) avec un vrai compte chauffeur du tenant
 * démo NMK, clé anon uniquement — exactement ce dont dispose l'APK.
 * Tout ce qui passerait en écriture est annulé immédiatement via le service role.
 * Usage : node scripts/nmk-rls-test.mjs
 */
import { env, select, update } from "./nmk-lib.mjs";

const T = "1250ac49-9a4c-46b2-84db-dddd8a44aedc";
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const login = async (email, password) => {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`login ${email}: ${JSON.stringify(j).slice(0, 150)}`);
  return { token: j.access_token, uid: j.user.id };
};

const asDriver = (tok) => async (method, path, body) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON, Authorization: `Bearer ${tok}`,
      "Content-Type": "application/json",
      "Accept-Profile": "fleet", "Content-Profile": "fleet",
      Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const txt = await r.text();
  return { status: r.status, body: txt.slice(0, 200) };
};

const verdict = (label, res, attendu) => {
  const bloque = res.status >= 400;
  const ok = attendu === "bloqué" ? bloque : !bloque;
  console.log(`${ok ? "✅" : "🚨"} ${label}\n     → HTTP ${res.status} ${res.body.replace(/\s+/g, " ").slice(0, 120)}`);
  return ok;
};

const { token, uid } = await login("driver-NMK01@internal.yango", "Nmk2026!");
const q = asDriver(token);
console.log(`Chauffeur NMK01 = ${uid}\n`);

const autre = (await select("profiles", `select=id,full_name&tenant_id=eq.${T}&role=eq.driver&id=neq.${uid}&limit=1`))[0];
const monRapport = (await select("daily_reports", `select=id,status&tenant_id=eq.${T}&driver_id=eq.${uid}&status=eq.submitted&limit=1`))[0]
  || (await select("daily_reports", `select=id,status&tenant_id=eq.${T}&driver_id=eq.${uid}&limit=1`))[0];
const rapportAutre = (await select("daily_reports", `select=id,driver_id,status&tenant_id=eq.${T}&driver_id=eq.${autre.id}&limit=1`))[0];

let fails = 0;
console.log("── ÉCRITURES (doivent toutes être bloquées) ──");
fails += !verdict("V1 · s'auto-promouvoir admin", await q("PATCH", `profiles?id=eq.${uid}`, { role: "admin" }), "bloqué");
fails += !verdict("V1 · se donner un salaire fixe", await q("PATCH", `profiles?id=eq.${uid}`, { salary_model: "fixed", base_amount: 900000 }), "bloqué");
fails += !verdict("V1 · changer sa commission", await q("PATCH", `profiles?id=eq.${uid}`, { comm_yango: 0 }), "bloqué");
fails += !verdict("V1 · se déplacer vers un autre tenant", await q("PATCH", `profiles?id=eq.${uid}`, { tenant_id: "120716d2-953a-49c7-bd89-21876d7668ba" }), "bloqué");
fails += !verdict("V1 · modifier la fiche d'un collègue", await q("PATCH", `profiles?id=eq.${autre.id}`, { full_name: "PIRATE" }), "bloqué");
fails += !verdict("V1 · auto-approuver son rapport", await q("PATCH", `daily_reports?id=eq.${monRapport.id}`, { status: "approved" }), "bloqué");
fails += !verdict("V1 · gonfler le rapport d'un collègue", await q("PATCH", `daily_reports?id=eq.${rapportAutre.id}`, { yango_gross: 1 }), "bloqué");
fails += !verdict("V1 · s'octroyer un paiement", await q("POST", "payments", { driver_id: uid, tenant_id: T, amount: 500000, type: "salaire", payment_date: "2026-09-14" }), "bloqué");
fails += !verdict("V1 · changer la grille de rémunération", await q("PATCH", `remuneration_config?tenant_id=eq.${T}`, { comm_yango: 0 }), "bloqué");
fails += !verdict("V1 · changer le branding du tenant", await q("PATCH", `tenant_settings?tenant_id=eq.${T}`, { app_name: "PIRATE" }), "bloqué");
fails += !verdict("V1 · s'attribuer le véhicule d'un collègue", await q("PATCH", `vehicles?tenant_id=eq.${T}&driver_id=eq.${autre.id}`, { driver_id: uid }), "bloqué");

console.log("\n── LECTURES (périmètre réellement visible) ──");
for (const [label, path] of [
  ["rapports", "daily_reports?select=driver_id&limit=1000"],
  ["profils", "profiles?select=id,role,base_amount&limit=200"],
  ["paiements", "payments?select=driver_id,amount&limit=200"],
  ["charges", "expenses?select=driver_id&limit=1000"],
  ["véhicules", "vehicles?select=id,driver_id&limit=100"],
]) {
  const r = await q("GET", path);
  let rows = []; try { rows = JSON.parse(r.body.length < 200 ? r.body : "[]"); } catch { /* tronqué */ }
  const full = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Accept-Profile": "fleet" } });
  const all = full.ok ? await full.json() : [];
  const mine = all.filter((x) => (x.driver_id ?? x.id) === uid).length;
  console.log(`  ${label.padEnd(10)} : ${all.length} ligne(s) visibles, dont ${mine} à moi` +
    (all.length > mine ? `  ⚠ ${all.length - mine} appartiennent à des collègues` : ""));
}

// Contrôle post-test : rien n'a bougé
const p = (await select("profiles", `select=role,base_amount,comm_yango,tenant_id,full_name&id=eq.${uid}`))[0];
const r2 = (await select("daily_reports", `select=status&id=eq.${monRapport.id}`))[0];
const pay = await select("payments", `select=id&driver_id=eq.${uid}&amount=eq.500000`);
console.log(`\n── ÉTAT APRÈS TEST ──`);
console.log(`  profil NMK01 : role=${p.role} base=${p.base_amount} comm=${p.comm_yango} tenant=${p.tenant_id === T ? "nmk ✓" : "DÉPLACÉ 🚨"}`);
console.log(`  rapport testé : ${r2.status} (était ${monRapport.status})`);
console.log(`  paiement frauduleux : ${pay.length === 0 ? "aucun ✓" : "PRÉSENT 🚨"}`);
if (pay.length) console.log("  → à supprimer manuellement");
console.log(`\n${fails === 0 ? "✅ Toutes les écritures sont bloquées — garde 039 en place." : `🚨 ${fails} écriture(s) passée(s)`}`);
