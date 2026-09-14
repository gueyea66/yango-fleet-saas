/**
 * Journal du tenant démo NMK : rejoue les événements des 10 derniers jours
 * (soumission par le chauffeur, validation/rejet par le gestionnaire) pour que
 * l'écran Journal montre quelque chose de cohérent avec les données déjà là.
 * Écrit en service_role (bypass du trigger 048) afin de garder les vraies dates.
 * Usage : node scripts/seed-nmk-journal.mjs [--reset]
 */
import { select, insert, remove } from "./nmk-lib.mjs";

const T = process.env.NMK_TENANT || "1250ac49-9a4c-46b2-84db-dddd8a44aedc";
const DEPUIS = "2026-09-04";
const RESET = process.argv.includes("--reset");

const [admin] = await select("profiles", `select=id&tenant_id=eq.${T}&role=eq.admin&order=created_at&limit=1`);
if (!admin) throw new Error("aucun gestionnaire sur ce tenant");

if (RESET) {
  const del = await remove("action_logs", `tenant_id=eq.${T}`);
  console.log(`▶ ${del.length} entrée(s) précédente(s) supprimée(s)`);
}
const dejaLa = await select("action_logs", `select=id&tenant_id=eq.${T}&limit=1`);
if (dejaLa.length) { console.log("⚠ le journal contient déjà des entrées — relancer avec --reset"); process.exit(0); }

const reports = await select("daily_reports",
  `select=id,driver_id,date,status,net_after_expenses,created_at&tenant_id=eq.${T}&date=gte.${DEPUIS}&order=date`);
const expenses = await select("expenses",
  `select=id,driver_id,category,amount,expense_date,status&tenant_id=eq.${T}&expense_date=gte.${DEPUIS}&order=expense_date&limit=1000`);

const h = (date, heure) => `${date}T${heure}:00+00:00`;
const rows = [];

for (const r of reports) {
  rows.push({
    tenant_id: T, actor_id: r.driver_id, actor_role: "driver",
    entity_type: "daily_report", entity_id: r.id, action: "submitted",
    metadata: { date: r.date, net: r.net_after_expenses, mode: "theorique" },
    created_at: h(r.date, "20:4" + (Math.floor(Math.random() * 9))),
  });
  if (r.status === "approved" || r.status === "rejected") {
    rows.push({
      tenant_id: T, actor_id: admin.id, actor_role: "admin",
      entity_type: "daily_report", entity_id: r.id, action: r.status,
      metadata: { date: r.date, net: r.net_after_expenses },
      created_at: h(r.date, "21:1" + (Math.floor(Math.random() * 9))),
    });
  }
}

for (const e of expenses) {
  rows.push({
    tenant_id: T, actor_id: e.driver_id, actor_role: "driver",
    entity_type: "expense", entity_id: e.id, action: "submitted",
    metadata: { category: e.category, amount: e.amount },
    created_at: h(e.expense_date, "19:2" + (Math.floor(Math.random() * 9))),
  });
  if (e.status === "approved") {
    rows.push({
      tenant_id: T, actor_id: admin.id, actor_role: "admin",
      entity_type: "expense", entity_id: e.id, action: "approved",
      metadata: { category: e.category, amount: e.amount },
      created_at: h(e.expense_date, "21:2" + (Math.floor(Math.random() * 9))),
    });
  }
}

rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
for (const c of chunk(rows, 400)) await insert("action_logs", c);

const parAction = {};
rows.forEach((r) => { const k = `${r.entity_type}/${r.action}`; parAction[k] = (parAction[k] || 0) + 1; });
console.log(`✅ ${rows.length} entrées de journal écrites (depuis le ${DEPUIS})`);
Object.entries(parAction).sort().forEach(([k, v]) => console.log(`   ${k.padEnd(26)} ${v}`));
