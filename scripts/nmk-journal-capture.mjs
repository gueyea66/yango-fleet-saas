/**
 * Capture de l'écran Journal du tenant démo NMK (prod).
 * Usage : node scripts/nmk-journal-capture.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.NMK_BASE || "https://nmk.m3afleet.com";
const OUT = "scripts/_nmk-captures";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
page.setDefaultTimeout(90000);

await page.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });
await page.getByPlaceholder("admin@m3a.sn").fill("admin@nmktransports.sn");
await page.getByPlaceholder("••••••••••").fill("Nmk!2026");
await page.getByRole("button", { name: /Se connecter/ }).click();
await page.waitForURL("**/admin", { timeout: 90000 });
await page.waitForTimeout(7000);

// « Journal » est dans le groupe CONFIG, replié par défaut
const groupe = page.getByText("CONFIG", { exact: false }).filter({ visible: true }).first();
if (await groupe.count()) { await groupe.click().catch(() => {}); await page.waitForTimeout(1500); }
const onglet = page.getByRole("button", { name: /Journal/i }).filter({ visible: true }).first();
if (await onglet.count()) { await onglet.click(); await page.waitForTimeout(8000); }
else console.log("⚠ onglet Journal introuvable");
await page.screenshot({ path: `${OUT}/20-journal.png`, fullPage: true });
const txt = await page.locator("body").innerText();
fs.writeFileSync(`${OUT}/journal-texte.txt`, txt);
console.log(txt.split("\n").filter((l) => l.trim()).slice(0, 60).join("\n"));
await browser.close();
