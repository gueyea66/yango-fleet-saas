/**
 * Contrôle des agrégats du tenant démo NMK — lecture paginée (PostgREST plafonne
 * à 1000 lignes par requête). Sort le P&L mensuel et le total YTD.
 * Usage : node scripts/nmk-verify.mjs
 */
import { select } from "./nmk-lib.mjs";

const T = process.env.NMK_TENANT || "1250ac49-9a4c-46b2-84db-dddd8a44aedc";
const AVANCE = "Décaissement propriétaire";

async function all(table, cols, filter) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const page = await select(table, `select=${cols}&${filter}&order=id&limit=1000&offset=${off}`);
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

const f = (n) => Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ");

const reports = await all("daily_reports",
  "id,date,driver_id,yango_gross,yango_bonus,off_yango_revenue,commission_amount,service_supplementaire,net_after_expenses,status,yango_trip_count,end_odometer",
  `tenant_id=eq.${T}`);
const expenses = await all("expenses", "id,category,amount,expense_date", `tenant_id=eq.${T}`);
const drivers = await select("profiles", `select=id,driver_id,full_name,hire_date&tenant_id=eq.${T}&role=eq.driver`);
const dIds = new Set(drivers.map((d) => d.id));
const payments = (await all("payments", "id,driver_id,amount,type,salary_month", "amount=gte.0"))
  .filter((p) => dIds.has(p.driver_id));

const act = reports.filter((r) => r.status !== "rejected");
const sum = (a, g) => a.reduce((s, x) => s + (g(x) || 0), 0);
const ca = sum(act, (x) => x.yango_gross + x.yango_bonus + x.off_yango_revenue);
const comm = sum(act, (x) => x.commission_amount + x.service_supplementaire);
const net = sum(act, (x) => x.net_after_expenses);
const byCat = {};
expenses.forEach((x) => { byCat[x.category] = (byCat[x.category] || 0) + x.amount; });
const charges = Object.entries(byCat).filter(([k]) => k !== AVANCE).reduce((s, [, v]) => s + v, 0);
const sal = sum(payments, (x) => x.amount);

console.log(`Chauffeurs ${drivers.length} · rapports ${reports.length} (en attente ${reports.filter((r) => r.status === "submitted").length}, rejetés ${reports.filter((r) => r.status === "rejected").length}) · charges ${expenses.length} · paiements ${payments.length}`);
console.log(`Période ${act.map((r) => r.date).sort()[0]} → ${act.map((r) => r.date).sort().at(-1)}`);
console.log(`\nCA brut YTD            ${f(ca)}`);
console.log(`Commissions Yango      ${f(comm)}  (${(comm / ca * 100).toFixed(1)} %)`);
console.log(`Net de commissions     ${f(net)}`);
console.log(`Charges d'exploitation ${f(charges)}`);
console.log(`  ${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f(v)}`).join(" · ")}`);
console.log(`Salaires versés        ${f(sal)}`);
console.log(`RÉSULTAT YTD           ${f(net - charges - sal)}`);

const bm = {}, em = {}, pm = {};
act.forEach((r) => { const k = r.date.slice(0, 7); (bm[k] = bm[k] || { n: 0, ca: 0, net: 0, trips: 0 }); bm[k].n++; bm[k].ca += r.yango_gross + r.yango_bonus + r.off_yango_revenue; bm[k].net += r.net_after_expenses; bm[k].trips += r.yango_trip_count || 0; });
expenses.forEach((x) => { const k = x.expense_date.slice(0, 7); em[k] = (em[k] || 0) + (x.category === AVANCE ? 0 : x.amount); });
payments.forEach((x) => { const k = (x.salary_month || "").slice(0, 7); pm[k] = (pm[k] || 0) + x.amount; });

console.log(`\nMOIS      j-chauf   CA brut    net comm.     charges    salaires    résultat`);
for (const k of Object.keys(bm).sort()) {
  const b = bm[k]; const res = b.net - (em[k] || 0) - (pm[k] || 0);
  console.log(`${k} ${String(b.n).padStart(8)} ${f(b.ca).padStart(11)} ${f(b.net).padStart(11)} ${f(em[k] || 0).padStart(11)} ${f(pm[k] || 0).padStart(11)} ${f(res).padStart(11)}`);
}

console.log(`\nPar chauffeur (moyennes/jour travaillé) :`);
for (const d of drivers.sort((a, b) => a.driver_id.localeCompare(b.driver_id))) {
  const rs = act.filter((r) => r.driver_id === d.id);
  if (!rs.length) { console.log(`  ${d.driver_id} ${d.full_name} — aucun rapport`); continue; }
  console.log(`  ${d.driver_id} ${d.full_name.padEnd(18)} ${String(rs.length).padStart(3)} j · brut/j ${f(sum(rs, (x) => x.yango_gross) / rs.length).padStart(7)} · courses/j ${(sum(rs, (x) => x.yango_trip_count) / rs.length).toFixed(0).padStart(2)} · net total ${f(sum(rs, (x) => x.net_after_expenses)).padStart(10)}`);
}
