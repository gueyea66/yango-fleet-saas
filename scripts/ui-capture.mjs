#!/usr/bin/env node
/**
 * Vérifie l'écran de suivi dans un vrai navigateur et en capture l'état.
 *
 *   node scripts/ui-capture.mjs --user <email> --pass <mdp> --date 2026-09-09
 *
 * Les identifiants ne sont jamais écrits dans le dépôt : ils passent en
 * argument. Les captures atterrissent dans docs/TELEMATICS/captures/.
 */

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const BASE = arg("url", "http://localhost:3100");
const USER = arg("user");
const PASS = arg("pass");
const DATE = arg("date", "2026-09-09");
const OUT = resolve(root, "docs/TELEMATICS/captures");
mkdirSync(OUT, { recursive: true });

if (!USER || !PASS) {
  console.error("Usage : --user <email> --pass <mot de passe> [--date 2026-09-09]");
  process.exit(1);
}

const browser = await chromium.launch();
const problems = [];

async function session(name, viewport) {
  const ctx = await browser.newContext({ viewport, locale: "fr-FR" });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|tile\.openstreetmap/i.test(m.text())) {
      problems.push(`[${name}] console : ${m.text().slice(0, 160)}`);
    }
  });
  page.on("pageerror", (e) => problems.push(`[${name}] exception : ${String(e).slice(0, 160)}`));

  // ── Connexion ──────────────────────────────────────────────────────────
  await page.goto(`${BASE}/auth/login`, { waitUntil: "domcontentloaded" });

  // Le formulaire se réhydrate après l'affichage : on remplit puis on vérifie
  // vraiment la valeur, sinon un champ silencieusement vide fait échouer la
  // connexion sans message.
  const email = page.locator('input[type="email"], input[name="email"]').first();
  const password = page.locator('input[type="password"]').first();
  await email.waitFor({ state: "visible", timeout: 20000 });
  for (let essai = 0; essai < 3; essai++) {
    await email.fill(USER);
    await password.fill(PASS);
    await page.waitForTimeout(300);
    if ((await email.inputValue()) === USER) break;
  }
  if ((await email.inputValue()) !== USER) {
    throw new Error("le champ e-mail refuse d'être rempli");
  }
  await page.click('button[type="submit"]');
  try {
    await page.waitForURL((u) => !u.pathname.includes("/auth/login"), { timeout: 30000 });
  } catch {
    // Diagnostic : afficher ce que la page reproche, au lieu d'un simple délai dépassé.
    const message = await page.locator("body").innerText().catch(() => "");
    const alerte = message.split("\n").find((l) => /incorrect|invalide|erreur|introuvable|aucun/i.test(l));
    await page.screenshot({ path: resolve(OUT, `echec-login-${name}.png`) });
    throw new Error(`connexion refusée — ${alerte ?? "raison non affichée"} (capture : echec-login-${name}.png)`);
  }

  // ── Écran de suivi ─────────────────────────────────────────────────────
  await page.goto(`${BASE}/admin/suivi?date=${DATE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Trajets détectés", { timeout: 30000 });
  await page.waitForTimeout(4000); // tuiles de la carte

  const kmGps = await page.locator("text=Km GPS du jour").locator("..").innerText().catch(() => "");
  const lignes = await page.locator("table tbody tr").count().catch(() => 0);
  const trajets = await page.locator("ul li button").count().catch(() => 0);
  console.log(`[${name}] indicateurs : ${kmGps.replace(/\n/g, " ")}`);
  console.log(`[${name}] ${trajets} trajet(s) listé(s), ${lignes} ligne(s) de rapprochement`);

  await page.screenshot({ path: resolve(OUT, `suivi-${name}.png`), fullPage: true });

  // ── Rejeu : on vérifie que le curseur avance réellement ────────────────
  if (trajets > 0) {
    const avant = await page.locator("text=/point \\d+ \\//").innerText().catch(() => "");
    await page.getByRole("button", { name: /Lancer le rejeu/i }).click();
    await page.waitForTimeout(2500);
    const apres = await page.locator("text=/point \\d+ \\//").innerText().catch(() => "");
    if (avant && apres && avant === apres) problems.push(`[${name}] le rejeu n'avance pas (${avant})`);
    else console.log(`[${name}] rejeu : ${avant.trim()} → ${apres.trim()}`);
    await page.screenshot({ path: resolve(OUT, `suivi-${name}-rejeu.png`), fullPage: false });
  }

  await ctx.close();
}

await session("desktop", { width: 1440, height: 900 });
await session("mobile", { width: 390, height: 844 });
await browser.close();

if (problems.length) {
  console.log("\nProblèmes relevés :");
  for (const p of problems) console.log("  -", p);
  process.exitCode = 1;
} else {
  console.log("\nAucun problème relevé. Captures dans docs/TELEMATICS/captures/");
}
