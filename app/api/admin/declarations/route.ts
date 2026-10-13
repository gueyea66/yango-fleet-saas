/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { suiviDeclarations, cleCourses, type CoursesYango } from "@/lib/analytics/declarations";
import { segmentResolver, isSegmentFilter } from "@/lib/analytics/segment";

/**
 * Suivi des déclarations : qui a déclaré recette, repos et carburant, jour par jour.
 *
 *   GET /api/admin/declarations?jours=14            (7 | 14 | 31)
 *   GET /api/admin/declarations?du=…&au=…           (AAAA-MM-JJ, 92 jours au plus ; un seul jour : du = au)
 *   &actifs=0  pour inclure les chauffeurs partis depuis (masqués par défaut)
 *   &segment=interne | partenaire  pour ne suivre que la flotte interne ou externe
 *
 * Lecture seule. Les corrections passent par les routes existantes : repos
 * (/api/admin/repos), relance (/api/admin/remind-drivers), saisie opérateur.
 * Le tenant vient TOUJOURS du compte connecté.
 */

export const dynamic = "force-dynamic";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { db: { schema: "fleet" } },
);

export async function GET(req: NextRequest) {
  try {
    const { tenantId } = await requireAdminAuth();
    const sp = new URL(req.url).searchParams;
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const ISO = /^\d{4}-\d{2}-\d{2}$/;
    const demande = Number(sp.get("jours") ?? 14);
    const jours = [7, 14, 31].includes(demande) ? demande : 14;
    let du = new Date(Date.now() - (jours - 1) * 86_400_000).toISOString().slice(0, 10);
    let au = aujourdhui;
    // Dates libres : elles priment sur le préréglage. Validées avant d'entrer dans un filtre.
    const duDemande = sp.get("du"), auDemande = sp.get("au");
    if (duDemande || auDemande) {
      if (!ISO.test(duDemande ?? "") || !ISO.test(auDemande ?? "") || duDemande! > auDemande!) {
        return Response.json({ error: "Période invalide : la date de début doit précéder la date de fin." }, { status: 400 });
      }
      if ((Date.parse(auDemande!) - Date.parse(duDemande!)) / 86_400_000 > 91) {
        return Response.json({ error: "Période trop longue : 92 jours au plus." }, { status: 400 });
      }
      du = duDemande!; au = auDemande! > aujourdhui ? aujourdhui : auDemande!;
      if (du > au) return Response.json({ error: "Cette période est dans le futur." }, { status: 400 });
    }
    const actifsSeulement = sp.get("actifs") !== "0";
    const segParam = sp.get("segment");
    const segment = isSegmentFilter(segParam) ? segParam : "all";

    const [{ data: profils, error }, { data: vehicules }, rapports, depenses, commandes] = await Promise.all([
      admin.from("profiles").select("*").eq("tenant_id", tenantId).eq("role", "driver"),
      admin.from("vehicles").select("id, driver_id, plate, fleet_segment").eq("tenant_id", tenantId),
      fetchAllRows<any>(() => admin.from("daily_reports")
        .select("id, driver_id, date, status, comment, source, yango_gross, off_yango_revenue, gross_earnings, yango_trip_count, off_yango_trip_count")
        .eq("tenant_id", tenantId).gte("date", du).lte("date", au).order("date").order("id")),
      // dépenses : date de dépense, ou date de saisie pour les anciennes lignes sans expense_date
      fetchAllRows<any>(() => admin.from("expenses")
        .select("id, driver_id, category, amount, status, expense_date, created_at")
        .eq("tenant_id", tenantId)
        .or(`and(expense_date.gte.${du},expense_date.lte.${au}),and(expense_date.is.null,created_at.gte.${du},created_at.lte.${au}T23:59:59)`)
        .order("id")),
      // Témoin Yango : absent chez les clients qui n'importent pas leurs exports — table vide, rien à signaler.
      fetchAllRows<any>(() => admin.from("yango_orders")
        .select("order_id, yango_driver_id, jour")
        .eq("tenant_id", tenantId).eq("status", "Terminé").gte("jour", du).lte("jour", au).order("order_id"))
        .catch(() => [] as any[]),
    ]);
    if (error) throw new Error(error.message);

    const plaque = new Map((vehicules ?? []).filter((v: any) => v.driver_id).map((v: any) => [v.driver_id, v.plate]));
    const courses: CoursesYango = new Map();
    for (const o of commandes) {
      if (!o.yango_driver_id || !o.jour) continue;
      const k = cleCourses(o.yango_driver_id, o.jour);
      courses.set(k, (courses.get(k) ?? 0) + 1);
    }

    // Interne / externe : même règle que Performance (segment choisi pour le chauffeur, sinon celui de son véhicule).
    const seg = segmentResolver((vehicules ?? []) as any[], (profils ?? []) as any[]);
    const chauffeurs = (profils ?? []).filter((p: any) => p.account_type !== "technical");
    const mixte = new Set(chauffeurs.map((p: any) => seg.ofDriver(p.id))).size > 1;

    return Response.json({
      fenetre: duDemande ? 0 : jours, actifsSeulement, segment, mixte,
      ...suiviDeclarations({
        chauffeurs: chauffeurs.filter((p: any) => segment === "all" || seg.ofDriver(p.id) === segment)
          .map((p: any) => ({ ...p, plate: plaque.get(p.id) ?? null })),
        rapports, depenses, courses, du, au, aujourdhui, actifsSeulement,
      }),
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return Response.json({ error: e.message ?? "erreur" }, { status: e.status ?? 500 });
  }
}
