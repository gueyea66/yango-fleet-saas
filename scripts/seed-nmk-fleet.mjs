/**
 * SEED DÉMO « NMK Transports » — flotte Yango de 15 véhicules, YTD 2026.
 *
 * Objectif : montrer à NMK la projection de SON business dans M3A Fleet, avec
 * des chiffres calibrés sur les moyennes RÉELLES de la flotte M3A en prod
 * (132 rapports, 29/05 → 13/09) :
 *   brut/jour 48 130 F (médiane 50 500) · 20 courses/jour · 182-299 km/jour
 *   carburant ~16 900 F/jour ≈ 70 F/km · mix de charges identique au réel
 *
 * Le générateur est DÉTERMINISTE (PRNG à graine fixe) : deux exécutions
 * produisent les mêmes chiffres.
 *
 * Usage :
 *   node scripts/seed-nmk-fleet.mjs           # crée / complète
 *   node scripts/seed-nmk-fleet.mjs --reset   # purge le tenant nmk puis recrée
 */
import fs from "node:fs";
import path from "node:path";
import { env, select, insert, update, remove, createAuthUser } from "./nmk-lib.mjs";

/* ═══════════════ Paramètres ═══════════════ */
const SLUG = "nmk";
const NAME = "NMK Transports";
const ADMIN = { email: "admin@nmktransports.sn", password: "Nmk!2026", name: "Direction NMK" };
const EXPLOIT = { email: "exploitation@nmktransports.sn", password: "Nmk!2026", name: "Exploitation NMK" };
const DRIVER_PWD = "Nmk2026!";
const START = "2026-01-02";
const END = "2026-09-13";               // J-1 : la journée en cours n'est pas encore déclarée
const COMM_YANGO = 15;                   // %
const COMM_PARTNER = 0.75;               // %
const LOGO = process.env.NMK_LOGO || path.join(process.cwd(), "public", "nmk-logo.png");
const RESET = process.argv.includes("--reset");

const DRIVERS = [
  { id: "NMK01", name: "Ibrahima Sow",     hire: "2026-01-02", tel: "+221770111201", perf: 1.06 },
  { id: "NMK02", name: "Ousmane Ba",       hire: "2026-01-02", tel: "+221770111202", perf: 1.02 },
  { id: "NMK03", name: "Mamadou Diallo",   hire: "2026-01-02", tel: "+221770111203", perf: 0.97 },
  { id: "NMK04", name: "Cheikh Ndiaye",    hire: "2026-01-02", tel: "+221770111204", perf: 1.11 },
  { id: "NMK05", name: "Abdoulaye Fall",   hire: "2026-01-02", tel: "+221770111205", perf: 0.93 },
  { id: "NMK06", name: "Moussa Sarr",      hire: "2026-01-02", tel: "+221770111206", perf: 1.00 },
  { id: "NMK07", name: "Alioune Gueye",    hire: "2026-01-02", tel: "+221770111207", perf: 1.04 },
  { id: "NMK08", name: "Samba Cissé",      hire: "2026-01-02", tel: "+221770111208", perf: 0.90 },
  { id: "NMK09", name: "Modou Kane",       hire: "2026-01-02", tel: "+221770111209", perf: 0.99 },
  { id: "NMK10", name: "Babacar Thiam",    hire: "2026-03-02", tel: "+221770111210", perf: 1.03 },
  { id: "NMK11", name: "Saliou Mbaye",     hire: "2026-03-02", tel: "+221770111211", perf: 0.95 },
  { id: "NMK12", name: "Lamine Diouf",     hire: "2026-05-04", tel: "+221770111212", perf: 1.07 },
  { id: "NMK13", name: "Pape Sy",          hire: "2026-05-04", tel: "+221770111213", perf: 0.98 },
  { id: "NMK14", name: "Malick Ndour",     hire: "2026-07-01", tel: "+221770111214", perf: 1.01 },
  { id: "NMK15", name: "Omar Camara",      hire: "2026-08-03", tel: "+221770111215", perf: 0.92 },
];

const VEHICLES = [
  { plate: "DK-4821-AB", make: "Toyota",  model: "Corolla",  year: 2019, km0: 128400, fuel: "essence" },
  { plate: "DK-5107-AC", make: "Hyundai", model: "Accent",   year: 2020, km0: 96200,  fuel: "essence" },
  { plate: "DK-2934-AD", make: "Kia",     model: "Rio",      year: 2019, km0: 141800, fuel: "essence" },
  { plate: "DK-7365-AB", make: "Toyota",  model: "Yaris",    year: 2021, km0: 64300,  fuel: "essence" },
  { plate: "DK-1288-AE", make: "Suzuki",  model: "Dzire",    year: 2021, km0: 58900,  fuel: "essence" },
  { plate: "DK-6042-AC", make: "Hyundai", model: "i10",      year: 2020, km0: 87600,  fuel: "essence" },
  { plate: "DK-3517-AF", make: "Toyota",  model: "Corolla",  year: 2018, km0: 176500, fuel: "essence" },
  { plate: "DK-9163-AB", make: "Kia",     model: "Picanto",  year: 2020, km0: 103200, fuel: "essence" },
  { plate: "DK-4470-AD", make: "Hyundai", model: "Accent",   year: 2019, km0: 134700, fuel: "essence" },
  { plate: "DK-8226-AE", make: "Toyota",  model: "Yaris",    year: 2022, km0: 41500,  fuel: "essence" },
  { plate: "DK-5589-AC", make: "Suzuki",  model: "Swift",    year: 2021, km0: 52800,  fuel: "essence" },
  { plate: "DK-7712-AF", make: "Kia",     model: "Rio",      year: 2022, km0: 33900,  fuel: "essence" },
  { plate: "DK-2055-AB", make: "Hyundai", model: "i10",      year: 2021, km0: 47200,  fuel: "essence" },
  { plate: "DK-6690-AD", make: "Toyota",  model: "Corolla",  year: 2022, km0: 28600,  fuel: "essence" },
  { plate: "DK-3841-AE", make: "Suzuki",  model: "Dzire",    year: 2023, km0: 14800,  fuel: "essence" },
];

const TIERS = [
  { label: "Base", min_net: 0, total_salary: 200000 },
  { label: "Palier 1", min_net: 1000000, total_salary: 230000 },
  { label: "Palier 2", min_net: 1150000, total_salary: 260000 },
  { label: "Palier 3 (Max)", min_net: 1300000, total_salary: 300000 },
];

/* ═══════════════ Utilitaires ═══════════════ */
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
let _s = 20260914;
const rnd = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return mulberry32(_s)(); };
const between = (a, b) => a + rnd() * (b - a);
const chance = (p) => rnd() < p;
const r100 = (n) => Math.round(n / 100) * 100;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const iso = (d) => d.toISOString().slice(0, 10);
const days = (from, to) => {
  const out = []; const d = new Date(from + "T12:00:00Z"); const end = new Date(to + "T12:00:00Z");
  while (d <= end) { out.push(iso(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
};
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const tierOf = (net) => [...TIERS].reverse().find((t) => net >= t.min_net) || TIERS[0];
const log = (m) => console.log(`▶ ${m}`);

/* Facteurs de saisonnalité / jour de semaine, calés sur un marché VTC Dakar */
const DOW = [0.82, 0.95, 0.97, 0.99, 1.02, 1.08, 1.12];       // dim → sam
const MONTH = { 1: 0.95, 2: 0.97, 3: 0.99, 4: 1.00, 5: 1.01, 6: 1.02, 7: 1.04, 8: 1.05, 9: 1.06 };

/* ═══════════════ 1. Tenant ═══════════════ */
async function purge(tenantId) {
  log("Purge des données du tenant nmk");
  for (const t of ["expenses", "daily_reports", "uploads", "vehicles"]) {
    await remove(t, `tenant_id=eq.${tenantId}`).catch((e) => console.log(`  (${t}: ${e.message.slice(0, 80)})`));
  }
  const profs = await select("profiles", `select=id,email,role&tenant_id=eq.${tenantId}`);
  for (const p of profs.filter((x) => x.role === "driver")) {
    await remove("payments", `driver_id=eq.${p.id}`).catch(() => {});
  }
  await remove("profiles", `tenant_id=eq.${tenantId}&role=eq.driver`).catch(() => {});
}

async function ensureTenant() {
  const found = await select("tenants", `select=*&slug=eq.${SLUG}`);
  if (found.length) {
    const t = found[0];
    if (RESET) await purge(t.id);
    await update("tenants", `id=eq.${t.id}`, {
      name: NAME, plan: "pro", active: true,
      plan_expires_at: "2026-12-31T23:59:59Z",
    });
    log(`Tenant existant réutilisé (${t.id})`);
    return t.id;
  }
  const [t] = await insert("tenants", {
    slug: SLUG, name: NAME, plan: "pro", active: true,
    trial_ends_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    plan_expires_at: "2026-12-31T23:59:59Z",
  });
  log(`Tenant créé (${t.id})`);
  return t.id;
}

async function uploadLogo(tenantId) {
  if (!fs.existsSync(LOGO)) { log("Logo absent — branding sans logo"); return null; }
  const objectPath = `${tenantId}/logo.png`;
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/branding/${objectPath}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "image/png",
      "x-upsert": "true",
    },
    body: fs.readFileSync(LOGO),
  });
  if (!res.ok) { console.log(`  (logo non envoyé : ${res.status} ${(await res.text()).slice(0, 160)})`); return null; }
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/branding/${objectPath}`;
  log(`Logo NMK en ligne`);
  return url;
}

async function ensureSettings(tenantId, logoUrl) {
  const patch = {
    tenant_id: tenantId, app_name: NAME, primary_color: "#125773", currency: "XOF",
    timezone: "Africa/Dakar", operator_name: NAME, skin: "slate", ui_mode: "full",
    platform_label: "Yango", ...(logoUrl ? { logo_url: logoUrl } : {}),
  };
  const ex = await select("tenant_settings", `select=id&tenant_id=eq.${tenantId}`);
  if (ex.length) await update("tenant_settings", `tenant_id=eq.${tenantId}`, patch);
  else await insert("tenant_settings", patch);

  const remu = {
    tenant_id: tenantId, model: "tiered", base_amount: 0, commission_rate: 0,
    bonus_threshold: 0, bonus_amount: 0, comm_yango: COMM_YANGO, comm_partner: COMM_PARTNER,
    salary_tiers: TIERS, target_net: 1300000, daily_rent: 0,
  };
  const exr = await select("remuneration_config", `select=id&tenant_id=eq.${tenantId}`);
  if (exr.length) await update("remuneration_config", `tenant_id=eq.${tenantId}`, remu);
  else await insert("remuneration_config", remu);
  log("Branding + grille de rémunération en place");
}

async function ensureAi(tenantId) {
  const src = await select("ai_config", "select=*&limit=1");
  const row = { tenant_id: tenantId, rollout_stage: "dogfood", thresholds: src[0]?.thresholds ?? null };
  const ex = await select("ai_config", `select=tenant_id&tenant_id=eq.${tenantId}`);
  if (ex.length) await update("ai_config", `tenant_id=eq.${tenantId}`, row);
  else await insert("ai_config", row);
  log("Couche IA activée (dogfood)");
}

/* ═══════════════ 2. Comptes ═══════════════ */
async function ensureStaff(tenantId) {
  for (const [who, role] of [[ADMIN, "admin"], [EXPLOIT, "admin"]]) {
    const id = await createAuthUser({ email: who.email, password: who.password, meta: { full_name: who.name, role } });
    await insert("profiles", {
      id, tenant_id: tenantId, email: who.email, full_name: who.name, role,
      phone_number: "+221338200000", onboarding_status: "approved", active: true, account_type: "driver",
    }, { upsert: true, onConflict: "id" });
  }
  log(`Comptes direction : ${ADMIN.email} + ${EXPLOIT.email}`);
}

async function ensureDrivers(tenantId) {
  const out = [];
  for (const d of DRIVERS) {
    const email = `driver-${d.id}@internal.yango`;
    const id = await createAuthUser({ email, password: DRIVER_PWD, meta: { full_name: d.name, role: "driver" } });
    await insert("profiles", {
      id, tenant_id: tenantId, email, driver_id: d.id, full_name: d.name, role: "driver",
      phone_number: d.tel, account_type: "driver", payment_frequency: "monthly",
      onboarding_status: "approved", active: true, hire_date: d.hire,
      driver_level: d.perf >= 1.04 ? "expert" : d.perf >= 0.96 ? "confirme" : "debutant",
      years_experience: Math.round(between(2, 12)),
      salary_model: "tiered",
    }, { upsert: true, onConflict: "id" });
    out.push({ ...d, uid: id });
  }
  log(`15 chauffeurs créés (NMK01 → NMK15, PIN ${DRIVER_PWD})`);
  return out;
}

async function ensureVehicles(tenantId, drivers) {
  const rows = VEHICLES.map((v, i) => ({
    tenant_id: tenantId, driver_id: drivers[i].uid, plate: v.plate, make: v.make, model: v.model,
    year: v.year, status: "active", fuel_type: v.fuel, transmission: i % 4 === 0 ? "automatique" : "manuelle",
    mileage: v.km0, partner_rate: COMM_PARTNER / 100, yango_rate: null,
    insurance_company: pick(["SUNU Assurances", "AXA Sénégal", "Amsa Assurances", "NSIA"]),
    insurance_number: `POL-${2026}-${1000 + i * 37}`,
    insurance_expiry: ["2026-10-05", "2026-11-20", "2027-02-14", "2027-04-30"][i % 4],
    visite_expiry: ["2026-09-28", "2026-10-12", "2026-12-06", "2027-01-22"][i % 4],
  }));
  const ex = await select("vehicles", `select=id,plate&tenant_id=eq.${tenantId}`);
  const byPlate = new Map(ex.map((v) => [v.plate, v.id]));
  const created = [];
  for (const r of rows) {
    if (byPlate.has(r.plate)) { await update("vehicles", `id=eq.${byPlate.get(r.plate)}`, r); created.push({ id: byPlate.get(r.plate), plate: r.plate }); }
    else { const [v] = await insert("vehicles", r); created.push({ id: v.id, plate: v.plate }); }
  }
  log(`15 véhicules affectés (1 chauffeur = 1 voiture)`);
  return created;
}

/* ═══════════════ 3. Activité YTD ═══════════════ */
function buildActivity(tenantId, drivers, vehicles) {
  const allDays = days(START, END);
  const reports = [];
  const expenses = [];
  const perDriverMonth = new Map();   // `${uid}|${YYYY-MM}` → net cumulé

  drivers.forEach((d, i) => {
    const veh = vehicles[i];
    let odo = VEHICLES[i].km0;
    const restDay = i % 7;                        // un jour de repos fixe par chauffeur
    let dayIndex = 0;

    for (const date of allDays) {
      if (date < d.hire) continue;
      const dt = new Date(date + "T12:00:00Z");
      const dow = dt.getUTCDay();
      if (dow === restDay) continue;               // repos
      if (chance(0.035)) continue;                 // absence / immobilisation
      dayIndex++;

      const ramp = dayIndex <= 18 ? 0.86 + dayIndex * 0.008 : 1;   // montée en régime
      const f = DOW[dow] * MONTH[dt.getUTCMonth() + 1] * d.perf * ramp * between(0.87, 1.13);
      const brut = Math.min(84000, Math.max(24000, r100(48500 * f)));
      const bonus = chance(0.7) ? r100(between(500, 3000)) : 0;
      const hors = chance(0.22) ? r100(between(3000, 16000)) : 0;
      const servSupp = chance(0.12) ? (chance(0.5) ? 500 : 1000) : 0;
      const trips = Math.max(7, Math.min(38, Math.round(brut / 2420 + between(-2, 2))));
      const km = Math.round((brut / 203) * between(0.9, 1.1));
      odo += km;

      const base = brut + bonus;
      const comm = Math.round(base * (COMM_YANGO + COMM_PARTNER) / 100);
      const net = base - comm - servSupp + hors;

      // Les 3 derniers jours restent « à valider » (le boss voit la file d'attente)
      const late = date >= "2026-09-11";
      const status = late ? (chance(0.55) ? "submitted" : "approved") : "approved";

      reports.push({
        tenant_id: tenantId, driver_id: d.uid, vehicle_id: veh.id, date,
        end_odometer: odo, gross_earnings: base + hors, yango_gross: brut, yango_bonus: bonus,
        off_yango_revenue: hors, yango_trip_count: trips, off_yango_trip_count: hors ? Math.round(between(1, 3)) : 0,
        commission_rate: COMM_YANGO / 100, partner_rate: COMM_PARTNER / 100,
        commission_amount: comm, service_supplementaire: servSupp,
        net_after_expenses: net, expense_count: 0, status, source: "saas",
        rejection_reason: null,
        comment: chance(0.12) ? pick([
          "Journée normale, trafic fluide", "Pluie dans l'après-midi, moins de courses",
          "Beaucoup de courses aéroport", "Embouteillages VDN toute la matinée",
          "Fin de service tôt (petite panne de climatisation)", "Bonne journée, forte demande le soir",
        ]) : "",
      });

      const mk = `${d.uid}|${date.slice(0, 7)}`;
      perDriverMonth.set(mk, (perDriverMonth.get(mk) || 0) + net);

      /* ── charges du jour, mix calé sur le réel M3A ── */
      const add = (category, amount, description = null) =>
        expenses.push({
          tenant_id: tenantId, driver_id: d.uid, category, amount: r100(amount),
          description, expense_date: date, status: "approved", source: "saas",
        });

      if (chance(0.96)) add("Carburant", km * between(66, 75), `Plein station — ${km} km`);
      if (chance(0.17)) add("Péage", between(2000, 4500), "Autoroute à péage");
      if (chance(0.14)) add("Contrôle routier", between(1000, 3000), null);
      if (chance(0.13)) add("Lavage", between(1500, 3000), null);
      if (chance(0.05)) add("Entretien", between(12000, 55000), pick([
        "Vidange + filtres", "Plaquettes de frein", "Pneus avant", "Amortisseurs",
        "Batterie", "Climatisation — recharge gaz", "Révision 10 000 km",
      ]));
      if (chance(0.03)) add("Amende", between(3000, 10000), "Contravention");
      if (chance(0.14)) add("Solde Yango", between(15000, 40000), "Provision solde application");
      if (chance(0.13)) add("Autre", between(2000, 12000), pick([
        "Recharge téléphone / data", "Parking centre-ville", "Petit accessoire véhicule",
        "Frais de dossier mairie", "Nettoyage intérieur complet",
      ]));
    }
  });

  /* Un rapport rejeté, pour montrer le circuit de validation */
  const cand = reports.find((r) => r.date === "2026-08-19");
  if (cand) {
    reports.push({ ...cand, status: "rejected", rejection_reason: "Montant Yango incohérent avec la capture d'écran — à corriger" });
  }

  /* Salaires versés jusqu'au mois clos (août) — septembre reste à projeter */
  const payments = [];
  for (const d of drivers) {
    for (let m = 1; m <= 8; m++) {
      const key = `${d.uid}|2026-${String(m).padStart(2, "0")}`;
      const net = perDriverMonth.get(key);
      if (!net) continue;
      const t = tierOf(net);
      const payDate = `2026-${String(m + 1).padStart(2, "0")}-03`;
      if (chance(0.22)) {
        const ac = r100(between(25000, 50000));
        payments.push({
          driver_id: d.uid, tenant_id: tenantId, amount: ac, type: "acompte",
          payment_date: `2026-${String(m).padStart(2, "0")}-16`,
          salary_month: `2026-${String(m).padStart(2, "0")}-01`,
          is_deducted: true, deducted_at: payDate, notes: "Avance mi-mois",
        });
        payments.push({
          driver_id: d.uid, tenant_id: tenantId, amount: t.total_salary - ac, type: "salaire",
          payment_date: payDate, salary_month: `2026-${String(m).padStart(2, "0")}-01`,
          is_deducted: false, deducted_at: null, notes: `${t.label} — solde après acompte`,
        });
      } else {
        payments.push({
          driver_id: d.uid, tenant_id: tenantId, amount: t.total_salary, type: "salaire",
          payment_date: payDate, salary_month: `2026-${String(m).padStart(2, "0")}-01`,
          is_deducted: false, deducted_at: null, notes: t.label,
        });
      }
    }
  }

  return { reports, expenses, payments, perDriverMonth };
}

/* ═══════════════ Main ═══════════════ */
(async () => {
  console.log(`\n╔═══ SEED NMK Transports — M3A Fleet ═══╗\n`);
  const tenantId = await ensureTenant();
  const logoUrl = await uploadLogo(tenantId);
  await ensureSettings(tenantId, logoUrl);
  await ensureAi(tenantId).catch((e) => console.log(`  (IA: ${e.message.slice(0, 100)})`));
  await ensureStaff(tenantId);
  const drivers = await ensureDrivers(tenantId);
  const vehicles = await ensureVehicles(tenantId, drivers);

  const existing = await select("daily_reports", `select=id&tenant_id=eq.${tenantId}&limit=1`);
  if (existing.length && !RESET) {
    console.log("\n⚠ Des rapports existent déjà pour ce tenant — relancer avec --reset pour régénérer.");
  } else {
    const { reports, expenses, payments } = buildActivity(tenantId, drivers, vehicles);
    log(`Insertion de ${reports.length} rapports journaliers…`);
    for (const c of chunk(reports, 400)) await insert("daily_reports", c);
    log(`Insertion de ${expenses.length} charges…`);
    for (const c of chunk(expenses, 400)) await insert("expenses", c);
    log(`Insertion de ${payments.length} paiements de salaire…`);
    for (const c of chunk(payments, 400)) await insert("payments", c);
  }

  // Compteur kilométrique des véhicules aligné sur le dernier rapport
  for (const v of vehicles) {
    const last = await select("daily_reports", `select=end_odometer&vehicle_id=eq.${v.id}&order=date.desc&limit=1`);
    if (last[0]) await update("vehicles", `id=eq.${v.id}`, { mileage: last[0].end_odometer });
  }

  console.log(`\n✅ SEED TERMINÉ`);
  console.log(`──────────────────────────────────────────────`);
  console.log(`URL         : https://${SLUG}.m3afleet.com/auth/login`);
  console.log(`DIRECTION   : ${ADMIN.email}  /  ${ADMIN.password}`);
  console.log(`EXPLOITATION: ${EXPLOIT.email}  /  ${EXPLOIT.password}`);
  console.log(`CHAUFFEURS  : NMK01 … NMK15  /  ${DRIVER_PWD}`);
  console.log(`──────────────────────────────────────────────`);
})().catch((e) => { console.error("\n❌ ÉCHEC:", e.message); process.exit(1); });
