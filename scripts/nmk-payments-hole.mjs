/**
 * Étendue du trou sur fleet.payments : que peut faire un chauffeur avec la seule
 * clé anon ? Toute écriture qui passe est restaurée à l'identique juste après.
 * Usage : node scripts/nmk-payments-hole.mjs
 */
import { env, select, insert, update, remove } from "./nmk-lib.mjs";

const T = "1250ac49-9a4c-46b2-84db-dddd8a44aedc";
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "driver-NMK01@internal.yango", password: "Nmk2026!" }),
});
const { access_token: tok, user } = await r.json();
const uid = user.id;

const q = async (method, path, body) => {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON, Authorization: `Bearer ${tok}`, "Content-Type": "application/json",
      "Accept-Profile": "fleet", "Content-Profile": "fleet", Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: (await res.text()).replace(/\s+/g, " ").slice(0, 130) };
};

// Un acompte à moi (celui qui sera déduit de mon salaire) et un salaire d'un collègue
const monAcompte = (await select("payments", `select=*&tenant_id=eq.${T}&driver_id=eq.${uid}&type=eq.acompte&limit=1`))[0]
  || (await select("payments", `select=*&tenant_id=eq.${T}&driver_id=eq.${uid}&limit=1`))[0];
const autre = (await select("profiles", `select=id&tenant_id=eq.${T}&role=eq.driver&id=neq.${uid}&limit=1`))[0];
const salaireAutre = (await select("payments", `select=*&tenant_id=eq.${T}&driver_id=eq.${autre.id}&limit=1`))[0];

console.log(`Chauffeur NMK01 · acompte cible ${monAcompte.id} (${monAcompte.amount} F, ${monAcompte.type})\n`);

const essais = [
  ["gonfler son propre paiement", "PATCH", `payments?id=eq.${monAcompte.id}`, { amount: 999999 }],
  ["effacer la trace de son acompte (ne sera jamais déduit)", "PATCH", `payments?id=eq.${monAcompte.id}`, { is_deducted: false, deducted_at: null }],
  ["supprimer son acompte", "DELETE", `payments?id=eq.${monAcompte.id}`, null],
  ["modifier le salaire d'un collègue", "PATCH", `payments?id=eq.${salaireAutre.id}`, { amount: 1 }],
  ["supprimer le salaire d'un collègue", "DELETE", `payments?id=eq.${salaireAutre.id}`, null],
];

const passees = [];
for (const [label, method, path, body] of essais) {
  const res = await q(method, path, body);
  const passe = res.status < 400;
  console.log(`${passe ? "🚨 PASSE " : "✅ bloqué"} ${label}\n     → HTTP ${res.status} ${res.body.slice(0, 100)}`);
  if (passe) passees.push(label);
  // restauration immédiate
  for (const row of [monAcompte, salaireAutre]) {
    const exists = await select("payments", `select=id&id=eq.${row.id}`);
    if (!exists.length) { await insert("payments", row); console.log(`     ↺ ligne ${row.id.slice(0, 8)} recréée`); }
    else await update("payments", `id=eq.${row.id}`, {
      amount: row.amount, type: row.type, is_deducted: row.is_deducted,
      deducted_at: row.deducted_at, notes: row.notes,
    });
  }
}

const ok = (await select("payments", `select=id,amount,type,is_deducted&id=in.(${monAcompte.id},${salaireAutre.id})`));
console.log(`\n── état restauré ──`);
ok.forEach((x) => console.log(`  ${x.id.slice(0, 8)} ${x.type} ${x.amount} déduit=${x.is_deducted}`));
console.log(`\n${passees.length ? `🚨 ${passees.length} opération(s) possibles depuis un compte chauffeur :\n  - ${passees.join("\n  - ")}` : "✅ payments est protégé"}`);
