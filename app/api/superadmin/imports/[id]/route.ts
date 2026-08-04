import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { checkSuperadminKey, getClientIp, resolveSuperadminKey } from "@/lib/auth/server";

const serviceClient = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifySuperadmin(req: NextRequest): Promise<boolean> {
  const key = req.headers.get("x-superadmin-key") ?? "";
  const ip = getClientIp(req);
  const storedKey = await resolveSuperadminKey(async () => {
    const { data } = await serviceClient
      .schema("fleet")
      .from("superadmin_settings")
      .select("value")
      .eq("key", "superadmin_key")
      .single();
    return data?.value ?? null;
  });
  return checkSuperadminKey(key, storedKey, ip);
}

/* ── GET — détail d'un import (avec parsed_rows pour review) ── */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifySuperadmin(req))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;

  const { data, error } = await serviceClient
    .schema("fleet")
    .from("import_batches")
    .select("*, tenants:tenant_id ( slug, name )")
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Import introuvable" }, { status: 404 });
  return NextResponse.json({ batch: data });
}

/* ── POST — injection (superadmin) ── */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await verifySuperadmin(req))) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const action: string = body.action ?? "inject"; // "inject" | "reject"
  const rejectReason: string = body.reason ?? "";

  const { data: batch, error: fetchErr } = await serviceClient
    .schema("fleet")
    .from("import_batches")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !batch) {
    return NextResponse.json({ error: "Import introuvable" }, { status: 404 });
  }
  if (batch.status !== "admin_confirmed") {
    return NextResponse.json({
      error: `Action impossible sur un import au statut "${batch.status}"`,
    }, { status: 409 });
  }

  /* ── REJECT ── */
  if (action === "reject") {
    await serviceClient.schema("fleet").from("import_batches").update({
      status: "rejected",
      rejected_at: new Date().toISOString(),
      reject_reason: rejectReason,
    }).eq("id", id);

    return NextResponse.json({ ok: true, action: "rejected" });
  }

  /* ── INJECT ── */
  const rows: Record<string, unknown>[] = batch.parsed_rows ?? [];
  const validRows = rows.filter((r) => !r.has_error);

  if (validRows.length === 0) {
    return NextResponse.json({ error: "Aucune ligne valide à injecter" }, { status: 400 });
  }

  // Construire les daily_reports à insérer (ignorer les doublons).
  // Mapping vers le schéma RÉEL de fleet.daily_reports :
  //  - driver_id = UUID du profil (driver_profile_id), PAS le code chauffeur
  //  - template enrichi « éléments réels » (mêmes règles que la déclaration V3) :
  //    brut = espèces + carte quand fournis ; si des commissions réelles sont
  //    présentes, net = éléments tels quels (zéro calcul de taux)
  //  - km_parcourus/notes → comment (pas de colonne « km du jour ») ;
  //    compteur_km → end_odometer
  //  - marqueur historique = source 'legacy' (convention existante)
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const toInsert = validRows
    .filter((r) => !r.is_duplicate && r.driver_profile_id)
    .map((r) => {
      const especes = num(r.especes);
      const carte = num(r.carte);
      const bonus = num(r.bonus);
      const commY = num(r.commission_yango);
      const commP = num(r.commission_partenaire);
      const servSupp = num(r.services_supplementaires);
      const horsYango = num(r.hors_yango);
      const modeReel = commY !== null || commP !== null;

      const brutYango = especes !== null ? especes + (carte ?? 0) : (r.ca_brut as number);
      const netReel = modeReel
        ? brutYango + (bonus ?? 0) - (commY ?? 0) - (commP ?? 0) - (servSupp ?? 0) + (horsYango ?? 0)
        : (r.ca_brut as number);

      return {
        tenant_id: batch.tenant_id,
        driver_id: r.driver_profile_id as string,
        date: r.date as string,
        gross_earnings: brutYango + (bonus ?? 0) + (horsYango ?? 0),
        yango_gross: brutYango,
        yango_cash: especes,
        yango_card: carte,
        yango_bonus: bonus ?? 0,
        off_yango_revenue: horsYango ?? 0,
        solde_yango: num(r.solde),
        commission_yango_reelle: commY,
        commission_partenaire_reelle: commP,
        commission_amount: modeReel ? (commY ?? 0) + (commP ?? 0) : 0,
        service_supplementaire: servSupp ?? 0,
        end_odometer: num(r.compteur_km) ?? 0,
        net_after_expenses: netReel,
        yango_trip_count: num(r.nombre_courses),
        comment:
          [
            (r.notes as string) || null,
            r.km_parcourus != null ? `KM parcourus: ${r.km_parcourus}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        expense_count: num(r.frais_carburant) && (r.frais_carburant as number) > 0 ? 1 : 0,
        status: "approved",
        source: "legacy",
      };
    });

  let injectedCount = 0;
  const errors: string[] = [];

  // Insérer par batch de 50 pour éviter les timeouts
  for (let i = 0; i < toInsert.length; i += 50) {
    const chunk = toInsert.slice(i, i + 50);
    const { error: insertErr, data: inserted } = await serviceClient
      .schema("fleet")
      .from("daily_reports")
      .insert(chunk)
      .select("id");

    if (insertErr) {
      errors.push(`Batch ${i / 50 + 1}: ${insertErr.message}`);
    } else {
      injectedCount += inserted?.length ?? 0;
    }
  }

  // Frais carburant du template → vraies dépenses (catégorie Carburant),
  // approuvées, taguées legacy — visibles dans le module dépenses et les KPIs.
  const fuelExpenses = validRows
    .filter((r) => !r.is_duplicate && r.driver_profile_id && r.frais_carburant != null && (r.frais_carburant as number) > 0)
    .map((r) => ({
      tenant_id: batch.tenant_id,
      driver_id: r.driver_profile_id as string,
      category: "Carburant",
      amount: r.frais_carburant as number,
      description: "Import historique (template CSV)",
      expense_date: r.date as string,
      status: "approved",
      source: "legacy",
    }));

  for (let i = 0; i < fuelExpenses.length; i += 50) {
    const chunk = fuelExpenses.slice(i, i + 50);
    const { error: expErr } = await serviceClient
      .schema("fleet")
      .from("expenses")
      .insert(chunk);
    if (expErr) errors.push(`Dépenses batch ${i / 50 + 1}: ${expErr.message}`);
  }

  // Mettre à jour le statut du batch
  await serviceClient.schema("fleet").from("import_batches").update({
    status: errors.length === 0 ? "injected" : "injected",
    injected_at: new Date().toISOString(),
    injected_count: injectedCount,
  }).eq("id", id);

  return NextResponse.json({
    ok: true,
    action: "injected",
    injectedCount,
    skippedDuplicates: validRows.filter((r) => r.is_duplicate).length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
