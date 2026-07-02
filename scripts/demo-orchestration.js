/**
 * MASTER ORCHESTRATION — Démo live M3A Fleet
 * ------------------------------------------------------------------
 * Rejoue le parcours client complet sur le tenant de démo :
 *   1. Login admin → dashboard
 *   2. Création d'un chauffeur (API, session admin)
 *   3. Login chauffeur (viewport mobile) → rapport de fin de journée
 *      → dépense carburant → historique
 *   4. Admin : validation du rapport et de la dépense (modals)
 *   5. Tour des pages : historique, paiements, véhicules, KYC,
 *      rémunération, pilotage — screenshots dans docs/demo/
 *
 * Prérequis : `npm run dev` lancé (le script détecte 3000/3002),
 *             playwright installé (`npm i -D playwright` ou global).
 * Usage     : node scripts/demo-orchestration.js [--fresh]
 *             --fresh : recrée un chauffeur avec un ID aléatoire
 * ------------------------------------------------------------------
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const OUT = path.join(__dirname, "..", "docs", "demo");
const ADMIN = { email: "demo@fallou-driver.sn", password: "DemoFallou2026!" };
const FRESH = process.argv.includes("--fresh");
const DRIVER = {
  id: FRESH ? `FD${String(Math.floor(Math.random() * 900) + 100)}` : "FD001",
  name: "Moussa Diop",
  password: "moussa2026",
};

fs.mkdirSync(OUT, { recursive: true });
let step = 0;
const shot = async (page, name) => {
  step++;
  await page.screenshot({ path: path.join(OUT, `${String(step).padStart(2, "0")}-${name}.png`) });
  console.log(`📸 ${String(step).padStart(2, "0")}-${name}`);
};
const log = (m) => console.log(`▶ ${m}`);
const tap = (page, label) => page.getByText(label, { exact: true }).filter({ visible: true }).first().click();

async function detectBase() {
  for (const port of [3000, 3002, 3001]) {
    try {
      const r = await fetch(`http://localhost:${port}/api/public/tenant-branding?slug=m3a`);
      if (r.ok) return `http://localhost:${port}`;
    } catch {}
  }
  throw new Error("Serveur dev introuvable — lancez `npm run dev`");
}

(async () => {
  const BASE = await detectBase();
  console.log(`🌐 ${BASE} · chauffeur ${DRIVER.id}\n`);
  const browser = await chromium.launch();

  /* ═════════ PHASE 1 — ADMIN : login + création chauffeur ═════════ */
  const admin = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  admin.setDefaultTimeout(60000);

  log("Login admin");
  await admin.goto(`${BASE}/auth/login`);
  await admin.waitForLoadState("networkidle");
  await shot(admin, "login-brande");
  await admin.getByPlaceholder("admin@m3a.sn").fill(ADMIN.email);
  await admin.getByPlaceholder("••••••••••").fill(ADMIN.password);
  await admin.getByRole("button", { name: /Se connecter/ }).click();
  await admin.waitForURL("**/admin", { timeout: 90000 });
  await admin.waitForTimeout(5000);
  await shot(admin, "admin-dashboard");

  log(`Création chauffeur ${DRIVER.id} (API, session admin)`);
  const cr = await admin.request.post(`${BASE}/api/admin/drivers`, {
    data: { action: "create", driverId: DRIVER.id, fullName: DRIVER.name, password: DRIVER.password },
  });
  console.log(`  → ${cr.status()}`);

  log("Onglet Conducteurs");
  await admin.getByRole("button", { name: "Conducteurs" }).first().click();
  await admin.waitForTimeout(2500);
  await shot(admin, "admin-conducteurs");

  /* ═════════ PHASE 2 — CHAUFFEUR (mobile) : rapport + dépense ═════════ */
  const drv = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  drv.setDefaultTimeout(60000);

  log("Login chauffeur (mobile)");
  await drv.goto(`${BASE}/auth/login`);
  await drv.waitForLoadState("networkidle");
  await drv.getByRole("button", { name: "Conducteur" }).click();
  await drv.getByPlaceholder("DRV001").fill(DRIVER.id);
  await drv.getByPlaceholder("••••••••••").fill(DRIVER.password);
  await shot(drv, "driver-login");
  await drv.getByRole("button", { name: /Se connecter/ }).click();
  await drv.waitForURL("**/driver", { timeout: 90000 });
  await drv.waitForTimeout(3000);
  await shot(drv, "driver-accueil");

  log("Rapport de fin de journée");
  await tap(drv, "Rapport");
  await drv.waitForTimeout(1500);
  const nums = drv.locator("input[type=number]");
  // ordre du formulaire : km fin, brut yango, bonus, hors-yango, solde wallet, courses yango, courses hors
  const values = ["48900", "45000", "2500", "6000", "15000", "14", "2"];
  const n = Math.min(await nums.count(), values.length);
  for (let i = 0; i < n; i++) await nums.nth(i).fill(values[i]);
  await drv.locator("textarea").first().fill("Bonne journée, trafic fluide").catch(() => {});
  await shot(drv, "driver-rapport-rempli");
  await drv.getByRole("button", { name: /Soumettre le rapport/ }).click();
  await drv.waitForTimeout(3500);
  await shot(drv, "driver-rapport-soumis");

  log("Dépense carburant");
  await tap(drv, "Dépense");
  await drv.waitForTimeout(1500);
  await drv.getByText(/Carburant/i).first().click().catch(() => {});
  const enums = drv.locator("input[type=number]");
  const evalues = ["8000", "48900", "12"]; // montant, km, litres
  const en = Math.min(await enums.count(), evalues.length);
  for (let i = 0; i < en; i++) await enums.nth(i).fill(evalues[i]);
  await shot(drv, "driver-depense-remplie");
  await drv.getByRole("button", { name: /Soumettre/ }).first().click();
  await drv.waitForTimeout(3000);
  await shot(drv, "driver-depense-soumise");

  log("Historique driver");
  await tap(drv, "Historique");
  await drv.waitForTimeout(2000);
  await shot(drv, "driver-historique");

  /* ═════════ PHASE 3 — ADMIN : validations ═════════ */
  log("Soumissions en attente");
  await admin.getByRole("button", { name: "Soumissions" }).first().click();
  await admin.waitForTimeout(6000);
  await shot(admin, "admin-soumissions");

  log("Validation du rapport");
  await admin.getByText(/En attente|courses ·/).filter({ visible: true }).first().click();
  await admin.waitForTimeout(1800);
  await shot(admin, "admin-rapport-detail");
  await admin.getByRole("button", { name: /Approuver/ }).filter({ visible: true }).first().click();
  await admin.waitForTimeout(2500);
  await shot(admin, "admin-rapport-valide");
  // fermer le modal s'il est resté ouvert
  await admin.locator("button", { hasText: "✕" }).filter({ visible: true }).first().click().catch(() => {});
  await admin.keyboard.press("Escape").catch(() => {});
  await admin.waitForTimeout(800);

  log("Validation de la dépense");
  await admin.getByRole("button", { name: /Dépenses/ }).filter({ visible: true }).first().click();
  await admin.waitForTimeout(2000);
  await admin.getByText("Carburant", { exact: true }).filter({ visible: true }).first().click();
  await admin.waitForTimeout(1500);
  await shot(admin, "admin-depense-detail");
  await admin.getByRole("button", { name: /Approuver/ }).filter({ visible: true }).first().click();
  await admin.waitForTimeout(2500);
  await admin.keyboard.press("Escape").catch(() => {});
  await admin.waitForTimeout(800);

  /* ═════════ PHASE 4 — TOUR DES PAGES ═════════ */
  log("Tour des pages admin");
  for (const [tab, name] of [
    ["Historique", "admin-historique"],
    ["Paiements", "admin-paiements"],
    ["Véhicules", "admin-vehicules"],
    ["KYC", "admin-kyc"],
    ["Rémunération", "admin-remuneration"],
    ["Dashboard", "admin-dashboard-final"],
  ]) {
    await admin.getByRole("button", { name: tab }).first().click().catch(() => log(`  ⚠ onglet ${tab}`));
    await admin.waitForTimeout(3000);
    await shot(admin, name);
  }

  log("Pilotage");
  await admin.goto(`${BASE}/admin/pilotage`);
  await admin.waitForTimeout(6000);
  await shot(admin, "admin-pilotage");

  await browser.close();
  console.log(`\n✅ ORCHESTRATION TERMINÉE — ${step} captures dans docs/demo/`);
})().catch((e) => { console.error("❌ ÉCHEC:", e.message); process.exit(1); });
