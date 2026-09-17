#!/usr/bin/env node
/**
 * Capture une page admin avec une vraie session.
 *
 *   node scripts/capture-page.mjs <url> <email> <mdp> <chemin> <fichier.png>
 *
 * Les identifiants passent en argument, jamais dans le dépôt.
 */

import { chromium } from "playwright";

const [BASE, USER, PASS, PATH, OUT] = process.argv.slice(2);
const b = await chromium.launch();
const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 }, locale: "fr-FR" })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
await page.locator('input[type="email"]').first().fill(USER);
await page.locator('input[type="password"]').first().fill(PASS);
await page.locator('button[type="submit"]').first().click();
await page.waitForURL((u) => !u.pathname.includes("/auth/login"), { timeout: 60000 });

await page.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(8000);
await page.screenshot({ path: OUT, fullPage: true });
console.log("capture :", OUT);
console.log(errors.length ? "erreurs JS : " + errors.join(" | ") : "aucune erreur JS");
await b.close();
