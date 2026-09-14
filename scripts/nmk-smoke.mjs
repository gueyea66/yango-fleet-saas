/**
 * Contrôle visuel du tenant démo NMK : login direction, dashboard, pilotage,
 * chauffeurs. Captures dans scripts/_nmk-captures/.
 * Usage : node scripts/nmk-smoke.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.NMK_BASE || "https://nmk.demfane.com";
const OUT = "scripts/_nmk-captures";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });

console.log(`▶ ${BASE}/auth/login`);
await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${OUT}/00-login.png` });

await page.getByPlaceholder("admin@m3a.sn").fill("admin@nmktransports.sn");
await page.getByPlaceholder("••••••••••").fill("Nmk!2026");
await page.getByRole("button", { name: /Se connecter/ }).click();
await page.waitForURL("**/admin", { timeout: 90000 });
await page.waitForTimeout(9000);
await page.screenshot({ path: `${OUT}/01-dashboard.png`, fullPage: true });
console.log("✔ dashboard chargé");

// Onglets clés
for (const [label, file] of [["Pilotage", "02-pilotage"], ["Chauffeurs", "03-chauffeurs"],
  ["Véhicules", "04-vehicules"], ["Rémunération", "05-remuneration"], ["Soumissions", "06-soumissions"]]) {
  const btn = page.getByRole("button", { name: new RegExp(label, "i") }).filter({ visible: true }).first();
  if (await btn.count() === 0) { console.log(`  (onglet ${label} introuvable)`); continue; }
  await btn.click();
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: true });
  console.log(`✔ ${label}`);
}

// Chiffres visibles sur le dashboard (contrôle de cohérence à l'œil)
const txt = (await page.locator("body").innerText()).replace(/\n{2,}/g, "\n");
fs.writeFileSync(`${OUT}/texte-page.txt`, txt);

await browser.close();
console.log(errors.length ? `\n⚠ ${errors.length} erreurs console :\n  ${[...new Set(errors)].slice(0, 8).join("\n  ")}` : "\n✅ aucune erreur console");
console.log(`Captures : ${OUT}`);
