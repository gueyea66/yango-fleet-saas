import { chromium } from "playwright";

/**
 * Interroge /api/admin/telematics avec une vraie session, et dit exactement
 * ce que l'écran reçoit. Sert à distinguer « l'API ne renvoie rien » de
 * « l'écran n'affiche pas ce qu'il reçoit ».
 *
 *   node scripts/diag-telematics.mjs <url> <email> <mdp> <date>
 */

const [BASE, USER, PASS, DATE] = process.argv.slice(2);

const b = await chromium.launch();
const p = await (await b.newContext({ locale: "fr-FR" })).newPage();

await p.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
await p.locator('input[type="email"]').first().fill(USER);
await p.locator('input[type="password"]').first().fill(PASS);
await p.locator('button[type="submit"]').first().click();
await p.waitForURL((u) => !u.pathname.includes("/auth/login"), { timeout: 45000 });
console.log("connecte, redirige vers", new URL(p.url()).pathname);

const res = await p.evaluate(async (date) => {
  const r = await fetch(`/api/admin/telematics?date=${date}`);
  const j = await r.json();
  return {
    status: r.status,
    installed: j.installed,
    jour: j.day,
    boitiers: (j.devices ?? []).map((d) => ({ id: d.external_id, plaque: d.plate, vu: d.last_seen_at })),
    positions: j.positionCount,
    trajets: (j.trips ?? []).length,
    evenements: (j.events ?? []).length,
    joursAgreges: (j.daily ?? []).map((d) => d.day),
    rapprochement: (j.reconciliation ?? []).length,
    erreur: j.error,
  };
}, DATE);

console.log(JSON.stringify(res, null, 2));

await p.goto(`${BASE}/admin/suivi?date=${DATE}`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(9000);
const titre = await p.locator("h2").first().innerText().catch(() => "");
const kpi = await p.locator("article").allInnerTexts().catch(() => []);
console.log("titre carte :", titre.replace(/\n/g, " "));
console.log("indicateurs :", kpi.map((k) => k.replace(/\n/g, " ")).join(" | "));

await b.close();
