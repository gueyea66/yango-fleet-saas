import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { getPlanLimits } from "@/lib/plans";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);

// ── Rapport d'activité mensuel imprimable (HTML brandé, ouvert dans un onglet).
// Chiffres : STRICTEMENT les mêmes formules que /api/admin/export?resource=recap
// (net final = net après charges − dépenses − salaires). Les « points à retenir »
// sont des règles DÉTERMINISTES — aucun LLM, aucun montant recalculé côté client.

const num = (v: unknown) => (v == null ? 0 : Math.round(Number(v)));
const fmt = (v: number) => Math.round(v).toLocaleString("fr-FR").replace(/ /g, " ");
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface DriverAgg {
  name: string;
  technical: boolean;
  jours: number;
  premier: string | null;
  brut: number; bonus: number; hors: number; comm: number; svc: number;
  net: number; dep: number; sal: number; courses: number;
}

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();

    const { data: tenant } = await admin.from("tenants").select("name, plan").eq("id", tenantId).single();
    const limits = getPlanLimits(tenant?.plan || "standard");
    if (!limits.canExportCSV) {
      return NextResponse.json(
        { error: "Le rapport mensuel est réservé au plan Pro." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const now = new Date();
    const defFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const dateFrom = searchParams.get("dateFrom") || defFrom;
    const dateTo = searchParams.get("dateTo") || now.toISOString().slice(0, 10);

    const [{ data: profiles }, repsQ, expsQ, paysQ] = await Promise.all([
      admin.from("profiles").select("id, driver_id, full_name, account_type")
        .eq("tenant_id", tenantId),
      admin.from("daily_reports")
        .select("date,driver_id,yango_gross,yango_bonus,off_yango_revenue,commission_amount,service_supplementaire,net_after_expenses,yango_trip_count,status")
        .eq("tenant_id", tenantId).or("source.eq.saas,source.is.null")
        .gte("date", dateFrom).lte("date", dateTo).limit(20000),
      admin.from("expenses").select("driver_id,category,amount,expense_date")
        .eq("tenant_id", tenantId).gte("expense_date", dateFrom).lte("expense_date", dateTo).limit(20000),
      admin.from("payments").select("driver_id,amount,payment_date,salary_month")
        .eq("tenant_id", tenantId).limit(20000),
    ]);
    const reports = repsQ.data || [];
    const expenses = expsQ.data || [];
    const salaryDate = (p: { salary_month?: string | null; payment_date?: string | null }) =>
      (p.salary_month ? String(p.salary_month).slice(0, 10) : p.payment_date) || "";
    const payments = (paysQ.data || []).filter((p) => {
      const d = salaryDate(p);
      return d >= dateFrom && d <= dateTo;
    });

    const nameOf = new Map((profiles || []).map((p) => [p.id, p.full_name || p.driver_id || "?"]));
    const isTechnical = new Set((profiles || []).filter((p) => p.account_type === "technical").map((p) => p.id));

    const approved = reports.filter((r) => r.status === "approved");
    const pending = reports.length - approved.length;

    const acc = new Map<string, DriverAgg>();
    const get = (id: string): DriverAgg => {
      if (!acc.has(id)) {
        acc.set(id, {
          name: nameOf.get(id) || String(id).slice(0, 8), technical: isTechnical.has(id),
          jours: 0, premier: null, brut: 0, bonus: 0, hors: 0, comm: 0, svc: 0,
          net: 0, dep: 0, sal: 0, courses: 0,
        });
      }
      return acc.get(id)!;
    };
    for (const r of approved) {
      const a = get(r.driver_id);
      a.jours += 1;
      a.premier = a.premier && a.premier <= r.date ? a.premier : r.date;
      a.brut += r.yango_gross || 0; a.bonus += r.yango_bonus || 0;
      a.hors += r.off_yango_revenue || 0; a.comm += r.commission_amount || 0;
      a.svc += r.service_supplementaire || 0; a.net += r.net_after_expenses || 0;
      a.courses += r.yango_trip_count || 0;
    }
    const depCat = new Map<string, number>();
    for (const e of expenses) {
      if (e.driver_id) get(e.driver_id).dep += e.amount || 0;
      depCat.set(e.category || "Autre", (depCat.get(e.category || "Autre") || 0) + (e.amount || 0));
    }
    for (const p of payments) if (p.driver_id) get(p.driver_id).sal += p.amount || 0;

    const drivers = Array.from(acc.values()).sort((a, b) => (b.brut + b.bonus + b.hors) - (a.brut + a.bonus + a.hors));
    const tot = drivers.reduce((t, a) => ({
      jours: t.jours + a.jours, brut: t.brut + a.brut, bonus: t.bonus + a.bonus,
      hors: t.hors + a.hors, comm: t.comm + a.comm + a.svc, net: t.net + a.net,
      dep: t.dep + a.dep, sal: t.sal + a.sal, courses: t.courses + a.courses,
    }), { jours: 0, brut: 0, bonus: 0, hors: 0, comm: 0, net: 0, dep: 0, sal: 0, courses: 0 });
    const recette = tot.brut + tot.bonus + tot.hors;
    const netFinal = tot.net - tot.dep - tot.sal;

    // ── règles déterministes « à retenir » ──
    const periodDays = Math.round((new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000) + 1;
    const insights: { cls: string; text: string }[] = [];
    for (const a of drivers) {
      if (a.technical || a.jours === 0) continue;
      const share = pct(a.brut + a.bonus + a.hors, recette);
      if (periodDays >= 28 && a.jours >= periodDays) {
        insights.push({ cls: "warn", text: `<b>${esc(a.name)} n'a pris aucun jour de repos (${a.jours}/${periodDays} jours)</b> et porte ${share} % de la recette — risque fatigue à surveiller.` });
      } else if (a.premier && a.premier > dateFrom) {
        insights.push({ cls: "", text: `<b>${esc(a.name)} a démarré le ${a.premier.slice(8, 10)}/${a.premier.slice(5, 7)}</b> (${a.jours} j) — ses ratios peuvent inclure une période promo Yango : non comparables ce mois-ci.` });
      } else if (periodDays >= 28 && a.jours < 14) {
        insights.push({ cls: "warn", text: `<b>${esc(a.name)} : ${a.jours} jours rapportés seulement</b> sur la période — arrêt réel ou trous de saisie ? À éclaircir, la recette est sous-évaluée sinon.` });
      }
    }
    const carb = depCat.get("Carburant") || 0;
    if (recette > 0 && carb > 0) {
      insights.push({
        cls: pct(carb, recette) > 24 ? "alert" : "",
        text: `<b>Carburant : ${fmt(carb)} F, soit ${pct(carb, recette)} % de la recette</b> (${pct(carb, tot.dep)} % des dépenses) — levier de marge n°1.`,
      });
    }
    if (recette > 0) {
      insights.push({ cls: "", text: `<b>Ponction Yango réelle (commissions déclarées) : ${fmt(tot.comm)} F = ${pct(tot.comm, recette)} % du brut.</b>` });
      if (tot.hors > 0) insights.push({ cls: "ok", text: `<b>Le hors-Yango rapporte ${fmt(tot.hors)} F (${pct(tot.hors, recette)} % de la recette)</b> — sans commission, direct en marge.` });
    }
    if (pending > 0) {
      insights.push({ cls: "warn", text: `<b>${pending} rapport(s) en attente de validation</b> — les chiffres sont incomplets tant qu'ils ne sont pas tranchés.` });
    }

    const maxDep = Math.max(...Array.from(depCat.values()), 1);
    const depRows = Array.from(depCat.entries()).sort((a, b) => b[1] - a[1]).map(([cat, amt]) =>
      `<div class="bar-row"><div class="cat">${esc(cat)}</div><div class="track"><div class="fill" style="width:${Math.max(1, Math.round((amt / maxDep) * 100))}%"></div></div><div class="amt">${fmt(amt)} F · ${pct(amt, tot.dep)} %</div></div>`
    ).join("\n");

    const driverRows = drivers.map((a) => {
      const rec = a.brut + a.bonus + a.hors;
      const panier = a.courses > 0 ? Math.round(a.brut / a.courses) : null;
      const caJ = a.jours > 0 ? Math.round(rec / a.jours) : null;
      const netF = a.net - a.dep - a.sal;
      const tag = a.technical ? '<span class="tag navy">compte technique</span>'
        : a.premier && a.premier > dateFrom ? '<span class="tag navy">nouveau</span>'
        : periodDays >= 28 && a.jours >= periodDays ? '<span class="tag amber">0 repos</span>'
        : periodDays >= 28 && a.jours > 0 && a.jours < 14 ? '<span class="tag amber">partiel</span>' : "";
      const d = (v: number | null) => (v == null ? "—" : fmt(v));
      return `<tr><td><b>${esc(a.name)}</b> ${tag}</td><td class="r">${a.jours || "—"}</td><td class="r">${a.technical ? "—" : fmt(rec)}</td><td class="r">${a.technical ? "—" : fmt(a.comm + a.svc)}</td><td class="r">${fmt(a.dep)}</td><td class="r">${a.sal ? fmt(a.sal) : "—"}</td><td class="r"><b>${fmt(netF)}</b></td><td class="r">${d(panier)}</td><td class="r">${d(caJ)}</td></tr>`;
    }).join("\n");

    const period = `${dateFrom.slice(8, 10)}/${dateFrom.slice(5, 7)}/${dateFrom.slice(0, 4)} → ${dateTo.slice(8, 10)}/${dateTo.slice(5, 7)}/${dateTo.slice(0, 4)}`;
    const html = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(tenant?.name || "M3A Fleet")} — Rapport d'activité ${esc(period)}</title>
<style>
:root{--navy:#0E2640;--navy-soft:#1B3A5C;--gold:#C5A572;--gold-light:#E8DCC1;--ink:#1F2937;--ink3:#6B7280;--border:#D1D5DB;--bg:#FAF8F4}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,'Segoe UI',Helvetica,sans-serif;color:var(--ink);background:var(--bg);font-size:11pt;line-height:1.55}
.page{max-width:800px;margin:0 auto;padding:28px 34px 40px}
h2{font-family:'Cormorant Garamond',Garamond,Georgia,serif;color:var(--navy);font-size:19pt;margin:26px 0 10px;border-bottom:2px solid var(--gold);padding-bottom:4px}
.print-banner{background:var(--gold-light);border:1px solid var(--gold);border-radius:8px;padding:10px 14px;font-size:9.5pt;margin-bottom:18px}
@media print{.print-banner{display:none}.page{padding:0}body{background:#fff}}
.doc-header{display:flex;align-items:baseline;gap:14px;border-bottom:3px solid var(--navy);padding-bottom:12px}
.doc-header .brand{font-family:'Cormorant Garamond',Garamond,Georgia,serif;font-size:24pt;font-weight:700;color:var(--navy)}
.doc-header .meta{margin-left:auto;text-align:right;font-size:9pt;color:var(--ink3)}
.tldr{background:linear-gradient(135deg,var(--navy),var(--navy-soft));color:#fff;border-left:5px solid var(--gold);border-radius:8px;padding:16px 20px;margin:18px 0;font-size:10.5pt}
.tldr b{color:var(--gold-light)}
.heroes{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}
.hero{background:#fff;border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.hero.gold{border-color:var(--gold);background:var(--gold-light)}
.hero .lbl{font-size:8pt;text-transform:uppercase;letter-spacing:.07em;color:var(--ink3);font-weight:700}
.hero .val{font-size:15pt;font-weight:800;color:var(--navy);margin-top:2px}
.hero .sub{font-size:8.5pt;color:var(--ink3)}
table{border-collapse:collapse;width:100%;font-size:9.5pt;background:#fff}
th{background:var(--navy);color:#fff;padding:7px 8px;text-align:left;font-weight:600;font-size:8.5pt;text-transform:uppercase}
th.r,td.r{text-align:right}
td{padding:7px 8px;border-bottom:1px solid var(--border)}
tr.total td{font-weight:800;background:var(--gold-light);border-top:2px solid var(--gold)}
.tag{display:inline-block;font-size:7.5pt;font-weight:700;padding:1px 7px;border-radius:99px}
.tag.amber{background:#FFFBEB;color:#B45309}.tag.navy{background:#E8EEF6;color:var(--navy)}
.bar-row{display:flex;align-items:center;gap:10px;margin:4px 0;font-size:9.5pt}
.bar-row .cat{width:130px}.bar-row .track{flex:1;background:#EDE9E0;border-radius:99px;height:14px;overflow:hidden}
.bar-row .fill{background:linear-gradient(90deg,var(--navy),var(--navy-soft));height:100%}
.bar-row .amt{width:130px;text-align:right;font-weight:600;color:var(--navy)}
.insight{background:#fff;border:1px solid var(--border);border-left:4px solid var(--gold);border-radius:8px;padding:11px 15px;margin:8px 0;font-size:10pt}
.insight.alert{border-left-color:#B91C1C;background:#FEF2F2}
.insight.warn{border-left-color:#B45309;background:#FFFBEB}
.insight.ok{border-left-color:#15803D;background:#F0FDF4}
footer{margin-top:26px;padding-top:12px;border-top:1px solid var(--border);font-size:8.5pt;color:var(--ink3);display:flex;justify-content:space-between}
.note{font-size:8.5pt;color:var(--ink3);font-style:italic;margin-top:6px}
</style></head><body><div class="page">
<div class="print-banner">🖨️ PDF : Ctrl+P → « Enregistrer en PDF » (activer les graphiques d'arrière-plan).</div>
<div class="doc-header">
  <div class="brand">${esc(tenant?.name || "M3A FLEET")}</div>
  <div style="font-size:9pt;color:var(--ink3)">Rapport d'activité flotte</div>
  <div class="meta"><b style="color:#A88859;font-size:11pt">${esc(period)}</b><br>Généré le ${now.toLocaleDateString("fr-FR")} · M3A Fleet SaaS</div>
</div>
<div class="tldr"><b>L'essentiel.</b> La période dégage <b>${fmt(netFinal)} F de net final</b> sur <b>${fmt(recette)} F de recette brute</b>${recette > 0 ? ` (marge nette ${pct(netFinal, recette)} %)` : ""}. ${fmt(tot.courses)} courses Yango sur ${tot.jours} jours-chauffeur rapportés. Dépenses : ${fmt(tot.dep)} F · Salaires versés : ${fmt(tot.sal)} F.</div>
<div class="heroes">
  <div class="hero gold"><div class="lbl">Recette brute</div><div class="val">${fmt(recette)} F</div><div class="sub">Yango ${fmt(tot.brut)} + bonus ${fmt(tot.bonus)} + hors ${fmt(tot.hors)}</div></div>
  <div class="hero gold"><div class="lbl">Net final</div><div class="val">${fmt(netFinal)} F</div><div class="sub">${recette > 0 ? pct(netFinal, recette) + " % de la recette" : "—"}</div></div>
  <div class="hero"><div class="lbl">Dépenses</div><div class="val">${fmt(tot.dep)} F</div><div class="sub">${recette > 0 ? pct(tot.dep, recette) + " % de la recette" : "—"}</div></div>
  <div class="hero"><div class="lbl">Activité</div><div class="val">${fmt(tot.courses)} courses</div><div class="sub">${tot.jours} jours rapportés</div></div>
</div>
<h2>Résultats par chauffeur</h2>
<table><thead><tr><th>Chauffeur</th><th class="r">Jours</th><th class="r">Recette brute</th><th class="r">Commissions</th><th class="r">Dépenses</th><th class="r">Salaire</th><th class="r">Net final</th><th class="r">Panier moy.</th><th class="r">CA / jour</th></tr></thead>
<tbody>
${driverRows}
<tr class="total"><td>TOTAL</td><td class="r">${tot.jours}</td><td class="r">${fmt(recette)}</td><td class="r">${fmt(tot.comm)}</td><td class="r">${fmt(tot.dep)}</td><td class="r">${fmt(tot.sal)}</td><td class="r">${fmt(netFinal)}</td><td class="r"></td><td class="r"></td></tr>
</tbody></table>
<div class="note">Montants en FCFA. Net final = net après commissions − dépenses − salaires versés (formule du récap comptable). Un chauffeur « nouveau » peut inclure une période promo Yango : ratios non comparables.</div>
${depCat.size > 0 ? `<h2>Dépenses par catégorie</h2>\n${depRows}` : ""}
${insights.length > 0 ? `<h2>Ce qu'il faut retenir</h2>\n${insights.map((i, n) => `<div class="insight ${i.cls}"><b>${n + 1}.</b> ${i.text}</div>`).join("\n")}` : ""}
<footer><div>${esc(tenant?.name || "M3A GROUP")} — Rapport d'activité flotte</div><div>Chiffres calculés par le moteur — règles déterministes, aucun montant recalculé.</div></footer>
</div></body></html>`;

    return new NextResponse(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const e = err as { message?: string; status?: number };
    return NextResponse.json({ error: e.message || "Erreur serveur" }, { status: e.status ?? 500 });
  }
}
