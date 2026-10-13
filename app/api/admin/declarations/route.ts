/* eslint-disable @typescript-eslint/no-explicit-any -- lignes Supabase non typées (convention du projet) */
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { requireAdminAuth } from "@/lib/auth/server";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { suiviDeclarations, cleCourses, type CoursesYango } from "@/lib/analytics/declarations";

/**
 * Suivi des déclarations : qui a déclaré recette, repos et carburant, jour par jour.
 *
 *   GET /api/admin/declarations?jours=14     (7 | 14 | 31)
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
    const demande = Number(new URL(req.url).searchParams.get("jours") ?? 14);
    const jours = [7, 14, 31].includes(demande) ? demande : 14;
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const du = new Date(Date.now() - (jours - 1) * 86_400_000).toISOString().slice(0, 10);

    const [{ data: profils, error }, { data: vehicules }, rapports, depenses, commandes] = await Promise.all([
      admin.from("profiles").select("*").eq("tenant_id", tenantId).eq("role", "driver"),
      admin.from("vehicles").select("driver_id, plate").eq("tenant_id", tenantId),
      fetchAllRows<any>(() => admin.from("daily_reports")
        .select("id, driver_id, date, status, comment, source, yango_gross, off_yango_revenue, gross_earnings, yango_trip_count, off_yango_trip_count")
        .eq("tenant_id", tenantId).gte("date", du).lte("date", aujourdhui).order("date").order("id")),
      // dépenses : date de dépense, ou date de saisie pour les anciennes lignes sans expense_date
      fetchAllRows<any>(() => admin.from("expenses")
        .select("id, driver_id, category, amount, status, expense_date, created_at")
        .eq("tenant_id", tenantId)
        .or(`and(expense_date.gte.${du},expense_date.lte.${aujourdhui}),and(expense_date.is.null,created_at.gte.${du})`)
        .order("id")),
      // Témoin Yango : absent chez les clients qui n'importent pas leurs exports — table vide, rien à signaler.
      fetchAllRows<any>(() => admin.from("yango_orders")
        .select("order_id, yango_driver_id, jour")
        .eq("tenant_id", tenantId).eq("status", "Terminé").gte("jour", du).lte("jour", aujourdhui).order("order_id"))
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

    return Response.json({
      fenetre: jours,
      ...suiviDeclarations({
        chauffeurs: (profils ?? []).map((p: any) => ({ ...p, plate: plaque.get(p.id) ?? null })),
        rapports, depenses, courses, du, au: aujourdhui, aujourdhui,
      }),
    });
  } catch (err) {
    const e = err as { status?: number; message?: string };
    return Response.json({ error: e.message ?? "erreur" }, { status: e.status ?? 500 });
  }
}
