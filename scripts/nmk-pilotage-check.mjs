/**
 * Contrôle du module Pilotage (projections / P&L) sur le tenant démo NMK.
 * Usage : NMK_BASE=http://nmk.localtest.me:3010 node scripts/nmk-pilotage-check.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.NMK_BASE || "https://nmk.demfane.com";
const OUT = "scripts/_nmk-captures";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
page.setDefaultTimeout(90000);
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });
page.on("response", (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url().replace(BASE, "")}`); });

await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
await page.getByPlaceholder("admin@m3a.sn").fill("admin@nmktransports.sn");
await page.getByPlaceholder("••••••••••").fill("Nmk!2026");
await page.getByRole("button", { name: /Se connecter/ }).click();
await page.waitForURL("**/admin", { timeout: 90000 });
await page.waitForTimeout(6000);

await page.goto(`${BASE}/admin/pilotage`, { waitUntil: "networkidle" });
await page.waitForTimeout(14000);
await page.screenshot({ path: `${OUT}/10-pilotage-complet.png`, fullPage: true });
fs.writeFileSync(`${OUT}/pilotage-texte.txt`, await page.locator("body").innerText());
console.log("✔ Pilotage capturé");

await browser.close();
console.log(errs.length ? `⚠ ${[...new Set(errs)].slice(0, 8).join("\n  ")}` : "✅ aucune erreur réseau/console");
