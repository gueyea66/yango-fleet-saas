/**
 * uploads / kyc_documents après la 048 : le chauffeur doit pouvoir déposer SES
 * pièces (fonctionnalité à préserver) et rien d'autre (abus à bloquer).
 * Usage : node scripts/nmk-uploads-kyc-test.mjs
 */
import { env, select, remove } from "./nmk-lib.mjs";

const T = "1250ac49-9a4c-46b2-84db-dddd8a44aedc";
const AUTRE_TENANT = "120716d2-953a-49c7-bd89-21876d7668ba";
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const res0 = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "driver-NMK01@internal.yango", password: "Nmk2026!" }),
});
const { access_token: tok, user } = await res0.json();
const uid = user.id;
const autre = (await select("profiles", `select=id,full_name&tenant_id=eq.${T}&role=eq.driver&id=neq.${uid}&limit=1`))[0];

const q = async (method, path, body) => {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json",
      "Accept-Profile": "fleet", "Content-Profile": "fleet", Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const txt = await r.text();
  let json = null; try { json = JSON.parse(txt); } catch { /* non-JSON */ }
  return { status: r.status, json, body: txt.replace(/\s+/g, " ").slice(0, 130) };
};

const cas = [
  ["ABUS  pièce jointe au nom d'un collègue", "uploads",
    { tenant_id: T, driver_id: autre.id, file_name: "sonde.txt", file_path: `${T}/sonde.txt`, file_type: "report", file_size: 1 }, "bloqué"],
  ["ABUS  pièce jointe dans un autre tenant", "uploads",
    { tenant_id: AUTRE_TENANT, driver_id: uid, file_name: "sonde.txt", file_path: "x/sonde.txt", file_type: "report", file_size: 1 }, "bloqué"],
  ["ABUS  KYC d'un collègue", "kyc_documents",
    { tenant_id: T, driver_id: autre.id, doc_type: "permis", file_path: `${T}/sonde.pdf`, status: "pending" }, "bloqué"],
  ["ABUS  valider soi-même son KYC", "kyc_documents",
    { tenant_id: T, driver_id: uid, doc_type: "permis", file_path: `${T}/${uid}/sonde.pdf`, status: "approved" }, "bloqué"],
  ["LÉGITIME  déposer sa propre pièce jointe", "uploads",
    { tenant_id: T, driver_id: uid, file_name: "justif.jpg", file_path: `${T}/${uid}/justif.jpg`, file_type: "report", file_size: 10 }, "accepté"],
  ["LÉGITIME  déposer son propre KYC en attente", "kyc_documents",
    { tenant_id: T, driver_id: uid, doc_type: "carte_grise", file_path: `${T}/${uid}/cg.pdf`, status: "pending" }, "accepté"],
];

let ko = 0;
for (const [label, table, row, attendu] of cas) {
  const r = await q("POST", table, row);
  const passe = r.status < 400;
  const ok = attendu === "accepté" ? passe : !passe;
  if (!ok) ko++;
  console.log(`${ok ? "✅" : "🚨"} ${label}\n     → HTTP ${r.status} ${r.body.slice(0, 105)}`);
  const id = r.json?.[0]?.id;
  if (id) await remove(table, `id=eq.${id}`).catch(() => console.log("     ⚠ sonde non supprimée"));
}
console.log(`\n${ko === 0 ? "✅ uploads et kyc_documents : abus bloqués, dépôt légitime préservé" : `🚨 ${ko} cas non conforme(s)`}`);
