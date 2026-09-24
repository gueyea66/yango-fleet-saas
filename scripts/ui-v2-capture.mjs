#!/usr/bin/env node
/**
 * Captures de la refonte UI v2 (drapeau OFF / ON) + comparaison pixel.
 *
 *   node scripts/ui-v2-capture.mjs shoot  <dossier> [--v2] [--pages=a,b] [--base http://localhost:3100]
 *   node scripts/ui-v2-capture.mjs diff   <dossierA> <dossierB>
 *   node scripts/ui-v2-capture.mjs login  <admin|driver>      (connexion À LA MAIN, session enregistrée)
 *
 * Sessions : `login` ouvre un navigateur visible ; on se connecte soi-même,
 * puis la session est gardée dans .ui-v2-auth/<role>.json (ignoré par git).
 * Sans session, /admin et /driver sont capturés tels qu'un visiteur les voit.
 * Aucune écriture : le script ne fait que naviguer et capturer.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const BASE = opt("--base", process.env.UI_V2_BASE || "http://localhost:3100");
const AUTH_DIR = ".ui-v2-auth";

const PAGES = [
  { name: "home", path: "/", role: null, viewport: { width: 1280, height: 820 } },
  { name: "login", path: "/auth/login", role: null, viewport: { width: 1280, height: 820 } },
  { name: "login-mobile", path: "/auth/login", role: null, viewport: { width: 412, height: 892 } },
  { name: "register", path: "/register", role: null, viewport: { width: 1280, height: 820 } },
  { name: "locked", path: "/locked", role: null, viewport: { width: 1280, height: 820 } },
  { name: "admin", path: "/admin", role: "admin", viewport: { width: 1280, height: 820 } },
  { name: "admin-pilotage", path: "/admin/pilotage", role: "admin", viewport: { width: 1280, height: 820 } },
  { name: "driver", path: "/driver", role: "driver", viewport: { width: 412, height: 892 } },
  { name: "ui-v2", path: "/ui-v2", role: null, viewport: { width: 1280, height: 900 }, v2Only: true },
  { name: "ui-v2-mobile", path: "/ui-v2", role: null, viewport: { width: 412, height: 892 }, v2Only: true },
];

async function shoot(outDir, v2) {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const only = (args.find((a) => a.startsWith("--pages=")) || "").slice(8);
  const pages = PAGES.filter((p) => (v2 || !p.v2Only) && (!only || only.split(",").includes(p.name)));
  for (const p of pages) {
    const state = p.role ? path.join(AUTH_DIR, `${p.role}.json`) : null;
    const hasState = !!state && fs.existsSync(state);
    const ctx = await browser.newContext({
      viewport: p.viewport,
      deviceScaleFactor: 1,
      storageState: hasState ? state : undefined,
      reducedMotion: "reduce",
    });
    await ctx.addInitScript((on) => {
      try {
        if (on) localStorage.setItem("m3a-ui", "v2");
        else localStorage.removeItem("m3a-ui");
      } catch { /* stockage indisponible */ }
    }, v2);
    const page = await ctx.newPage();
    try {
      await page.goto(BASE + p.path, { waitUntil: "networkidle", timeout: 90000 });
    } catch {
      await page.goto(BASE + p.path, { waitUntil: "load", timeout: 90000 }).catch(() => {});
    }
    await page.waitForTimeout(2500);
    // Figer animations et transitions (captures reproductibles).
    await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" }).catch(() => {});
    const file = path.join(outDir, `${p.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const tag = hasState ? "session" : p.role ? "sans session" : "public";
    console.log(`  ✓ ${p.name} (${tag}) → ${file}  [${page.url().replace(BASE, "")}]`);
    await ctx.close();
  }
  await browser.close();
}

async function diff(a, b) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  let bad = 0;
  const files = fs.readdirSync(a).filter((f) => f.endsWith(".png"));
  for (const f of files) {
    const fb = path.join(b, f);
    if (!fs.existsSync(fb)) { console.log(`  ? ${f} absent de ${b}`); continue; }
    const pair = [fs.readFileSync(path.join(a, f)).toString("base64"), fs.readFileSync(fb).toString("base64")];
    const res = await page.evaluate(async ([x, y]) => {
      const load = (s) => new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = "data:image/png;base64," + s; });
      const [ia, ib] = await Promise.all([load(x), load(y)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: [ia.width, ia.height, ib.width, ib.height] };
      const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height;
      const g = c.getContext("2d");
      g.drawImage(ia, 0, 0); const pa = g.getImageData(0, 0, c.width, c.height).data;
      g.clearRect(0, 0, c.width, c.height); g.drawImage(ib, 0, 0); const pb = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < pa.length; i += 4) {
        if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 24) n++;
      }
      return { n, total: pa.length / 4 };
    }, pair);
    if (res.size) { bad++; console.log(`  ✗ ${f} : taille différente ${res.size[0]}×${res.size[1]} → ${res.size[2]}×${res.size[3]}`); continue; }
    const pct = (res.n / res.total) * 100;
    const ok = pct < 0.05;
    if (!ok) bad++;
    console.log(`  ${ok ? "✓" : "✗"} ${f} : ${res.n} px différents (${pct.toFixed(3)} %)`);
  }
  await browser.close();
  if (bad) { console.log(`${bad} écart(s) visible(s).`); process.exit(1); }
  console.log("Aucun écart visible.");
}

async function login(role) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ viewport: role === "driver" ? { width: 412, height: 892 } : { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/auth/login`);
  console.log(`Connecte-toi (${role}) dans la fenêtre ouverte. Attente de /${role}…`);
  await page.waitForURL(new RegExp(`/${role}`), { timeout: 10 * 60 * 1000 });
  await page.waitForTimeout(3000);
  await ctx.storageState({ path: path.join(AUTH_DIR, `${role}.json`) });
  console.log(`Session enregistrée → ${AUTH_DIR}/${role}.json`);
  await browser.close();
}

if (cmd === "shoot" && args[1]) await shoot(args[1], flag("--v2"));
else if (cmd === "diff" && args[1] && args[2]) await diff(args[1], args[2]);
else if (cmd === "login" && (args[1] === "admin" || args[1] === "driver")) await login(args[1]);
else {
  console.log("Usage : shoot <dossier> [--v2] [--pages=a,b] | diff <A> <B> | login <admin|driver>");
  process.exit(2);
}
