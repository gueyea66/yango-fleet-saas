import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:3100";

const b = await chromium.launch();
const ctx = await b.newContext({ locale: "fr-FR" });
const p = await ctx.newPage();

const reqs = [];
const errs = [];
p.on("request", (r) => {
  if (/auth\/v1|supabase\.co/.test(r.url())) {
    reqs.push(r.method() + " " + r.url().replace(/https:\/\/([a-z0-9]{6})[a-z0-9]*/, "https://$1…").slice(0, 120));
  }
});
p.on("requestfailed", (r) =>
  errs.push("REQUETE ECHOUEE: " + r.url().slice(0, 90) + " -> " + (r.failure()?.errorText ?? "")));
p.on("pageerror", (e) => errs.push("EXCEPTION JS: " + String(e).slice(0, 250)));
p.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE: " + m.text().slice(0, 250)); });

await p.goto(`${BASE}/auth/login`, { waitUntil: "networkidle" });

const email = p.locator('input[type="email"]').first();
const pass = p.locator('input[type="password"]').first();
await email.fill("diagnostic@test.invalid");
await pass.fill("MotDePasseTest123");
console.log("avant clic — email saisi :", JSON.stringify(await email.inputValue()));

const submit = p.locator('button[type="submit"]').first();
console.log("bouton :", JSON.stringify((await submit.innerText()).trim()),
            "| actif :", await submit.isEnabled());

await submit.click();
await p.waitForTimeout(7000);

console.log("apres clic — email :", JSON.stringify(await email.inputValue()));
console.log("URL :", p.url());

const texte = await p.locator("body").innerText();
const msg = texte.split("\n").filter((l) => /invalid|erreur|incorrect|requis|session|credential|connexion/i.test(l));
console.log("messages a l ecran :", msg.length ? msg.join(" / ") : "AUCUN");
console.log("requetes vers Supabase :", reqs.length ? "\n  " + reqs.join("\n  ") : "AUCUNE");
if (errs.length) console.log("problemes :\n  " + errs.join("\n  "));
else console.log("aucune erreur JS ni requete en echec");

await b.close();
