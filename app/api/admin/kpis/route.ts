import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { CAT_AVANCE } from "@/lib/expenseCategories";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { kmParMoisDepuisCompteur } from "@/lib/calc";

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } }
);


export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();

    const { searchParams } = new URL(req.url);
    const driverId = searchParams.get("driverId") || null;
    // Multi-sélection (retour Abdou 02/09) : driverIds=id1,id2 — compat driverId.
    const driverIds = (searchParams.get("driverIds") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (driverId && driverIds.length === 0) driverIds.push(driverId);
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const tQ = (q: any) => q.eq("tenant_id", tenantId);
    const dQ = (q: any) => driverIds.length ? q.in("driver_id", driverIds) : q;
    const srcQ = (q: any) => q;

    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const periodStart = dateFrom || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const periodEnd = dateTo || today;

    // Période précédente de même durée ÉCOULÉE, juste avant (évolution vs N-1).
    // La fin effective est bornée à aujourd'hui : comparer un mois en cours
    // (01→24) à un mois complet (01→31) produisait un faux « −48% vs préc. ».
    const msDay = 86400000;
    const effEnd = periodEnd > today ? today : periodEnd;
    const lenDays = Math.max(1, Math.round((Date.parse(effEnd) - Date.parse(periodStart)) / msDay) + 1);
    const prevEnd = new Date(Date.parse(periodStart) - msDay).toISOString().split("T")[0];
    const prevStart = new Date(Date.parse(periodStart) - lenDays * msDay).toISOString().split("T")[0];

    const [
      allReps,
      allExps,
      allPayments,
      todayRep,
      weekRep,
      driverProfiles,
      prevReps,
      prevOdoReps,
      vehicles,
      odoParVehicule,
    ] = await Promise.all([
      fetchAllRows(() => srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).gte("date", periodStart).lte("date", periodEnd).order("date")),
      fetchAllRows(() => srcQ(dQ(tQ(admin.from("expenses").select("*")))).order("expense_date")),
      fetchAllRows(() => dQ(tQ(admin.from("payments").select("*"))).order("payment_date")),
      srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).eq("date", today).then((r: any) => r.data || []),
      srcQ(dQ(tQ(admin.from("daily_reports").select("*")))).gte("date", weekAgo).lte("date", today).then((r: any) => r.data || []),
      admin.from("profiles").select("*").eq("tenant_id", tenantId).eq("role", "driver").then((r: any) => r.data || []),
      fetchAllRows(() => srcQ(dQ(tQ(admin.from("daily_reports").select("date,status,yango_gross,yango_bonus,off_yango_revenue,net_after_expenses,driver_id,comment")))).gte("date", prevStart).lte("date", prevEnd).order("date")),
      // Amorce d'odomètre : seule la DERNIÈRE déclaration par chauffeur avant la
      // période est utilisée — 1000 lignes triées du plus récent au plus ancien
      // en couvrent largement l'ensemble (le plafond PostgREST est de 1000).
      srcQ(dQ(tQ(admin.from("daily_reports").select("driver_id,date,end_odometer,status")))).lt("date", periodStart).not("end_odometer", "is", null).order("date", { ascending: false }).limit(1000).then((r: any) => r.data || []),
      // Amortissement : le parc et ses paramètres de capital. Réservé au
      // contexte admin — un chauffeur n'a pas à connaître ce que coûte la
      // flotte (même règle de cloisonnement que la migration 069).
      admin.from("vehicles")
        .select("id,plate,mileage,fleet_segment,prix_acquisition,valeur_residuelle,date_acquisition,amort_plafond_km,amort_duree_max_mois,amort_methode,amort_porte_par")
        .eq("tenant_id", tenantId).then((r: any) => r.data || []),
      // Relevés de compteur par véhicule, sur TOUT l'historique et non sur la
      // seule période : le rythme d'usure se mesure sur la durée. Mesuré sur un
      // mois isolé, un véhicule immobilisé deux semaines afficherait une durée
      // d'amortissement doublée.
      fetchAllRows(() => tQ(admin.from("daily_reports").select("vehicle_id,date,end_odometer"))
        .not("vehicle_id", "is", null).not("end_odometer", "is", null).gt("end_odometer", 0)
        .in("status", ["approved", "submitted"]).order("date")),
    ]);

    // ── Évolution vs période précédente (Net final & Total recettes) ──
    const technicalIds = new Set((driverProfiles || []).filter((d: any) => d.account_type === "technical").map((d: any) => d.id));
    const salaryDate = (p: any) => (p.salary_month ? String(p.salary_month).slice(0, 10) : (p.payment_date || p.created_at?.slice(0, 10))) || "";
    const inPrev = (d: string) => d >= prevStart && d <= prevEnd;
    const prevAppr = (prevReps || []).filter((r: any) => r.status === "approved");
    const prevTotalBrut = prevAppr.reduce((s: number, r: any) => s + (r.net_after_expenses || 0), 0);
    const prevRecettes = prevAppr.reduce((s: number, r: any) => s + (r.yango_gross || 0) + (r.yango_bonus || 0) + (r.off_yango_revenue || 0), 0);
    // Avances propriétaire exclues : neutres pour le résultat (cf. lib/expenseCategories CAT_AVANCE)
    const prevExpenses = (allExps || []).filter((e: any) => e.category !== CAT_AVANCE && inPrev(e.expense_date || e.created_at?.slice(0, 10) || "") && (!e.status || e.status === "approved")).reduce((s: number, e: any) => s + (e.amount || 0), 0);
    const prevSalaries = (allPayments || []).filter((p: any) => inPrev(salaryDate(p)) && !technicalIds.has(p.driver_id)).reduce((s: number, p: any) => s + (p.amount || 0), 0);
    const prevNetFinal = prevTotalBrut - prevExpenses - prevSalaries;

    // Jours ouvrés de la période précédente : jours calendaires − jours de
    // repos « flotte entière » (≥1 [REPOS] déclaré et personne n'a travaillé).
    // Même convention que la couche IA — permet la comparaison /jour ouvré.
    const prevLen = Math.round((Date.parse(prevEnd) - Date.parse(prevStart)) / msDay) + 1;
    const prevActive = (prevReps || []).filter((r: any) => r.status === "approved" || r.status === "submitted");
    const isReposRep = (r: any) => String(r.comment ?? "").startsWith("[REPOS]");
    const prevWorked = new Set(prevActive.filter((r: any) => !isReposRep(r)).map((r: any) => r.date));
    const prevReposFleet = [...new Set(prevActive.filter(isReposRep).map((r: any) => r.date))]
      .filter((d) => !prevWorked.has(d as string)).length;
    const prevJoursOuvres = Math.max(0, prevLen - prevReposFleet);

    // ── Parc amortissable ──
    // Le rythme d'usure est mesuré ici, côté serveur, pour que le client reçoive
    // un parc directement exploitable par `amortissementParc()` et non un
    // historique de compteurs à recalculer à chaque rendu.
    const relevesParVehicule = new Map<string, Array<{ date: string; end_odometer: number | null }>>();
    for (const r of (odoParVehicule || []) as any[]) {
      if (!r.vehicle_id) continue;
      (relevesParVehicule.get(r.vehicle_id) ?? relevesParVehicule.set(r.vehicle_id, []).get(r.vehicle_id)!)
        .push({ date: r.date, end_odometer: r.end_odometer });
    }
    const parcAmortissable = ((vehicles || []) as any[]).map((v) => ({
      id: v.id,
      plate: String(v.plate ?? "").trim(),
      kmParMois: kmParMoisDepuisCompteur(relevesParVehicule.get(v.id) || []),
      vehicule: {
        prixAcquisition: v.prix_acquisition,
        valeurResiduelle: v.valeur_residuelle,
        dateAcquisition: v.date_acquisition,
        compteurActuel: v.mileage,
        plafondKm: v.amort_plafond_km,
        dureeMaxMois: v.amort_duree_max_mois,
        porteePar: v.amort_porte_par,
        segment: v.fleet_segment,
      },
    }));

    return Response.json({
      parcAmortissable,
      allReps: allReps || [],
      allExps: allExps || [],
      allPayments: allPayments || [],
      todayRep: todayRep || [],
      weekRep: weekRep || [],
      driverProfiles: driverProfiles || [],
      prevOdoReps: prevOdoReps || [],
      prev: { netFinal: prevNetFinal, totalBrut: prevTotalBrut, recettes: prevRecettes, start: prevStart, end: prevEnd, joursOuvres: prevJoursOuvres },
    });
  } catch (err: any) {
    const status = err.status ?? 500;
    return Response.json({ error: err.message }, { status });
  }
}
