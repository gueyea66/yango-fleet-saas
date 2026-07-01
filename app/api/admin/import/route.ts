import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireAdminAuth } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";

const serviceClient = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/* ── CSV parser minimal (gère les champs quotés) ── */
function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  return lines
    .filter((l) => l.trim().length > 0)
    .map((line) => {
      const fields: string[] = [];
      let cur = "";
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
          else { inQuote = !inQuote; }
        } else if (ch === "," && !inQuote) {
          fields.push(cur.trim());
          cur = "";
        } else {
          cur += ch;
        }
      }
      fields.push(cur.trim());
      return fields;
    });
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function parseNumber(s: string): number | null {
  if (!s || s.trim() === "") return null;
  const n = Number(s.replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

/* ── GET — liste des imports du tenant ── */
export async function GET() {
  try {
    const { tenantId } = await requireAdminAuth();
    const { data, error } = await serviceClient
      .schema("fleet")
      .from("import_batches")
      .select("id, status, row_count, valid_count, error_count, duplicate_count, date_from, date_to, drivers_found, admin_notes, created_at, admin_confirmed_at, injected_at, injected_count, rejected_at, reject_reason")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return NextResponse.json({ batches: data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}

/* ── POST — upload + parse CSV ── */
export async function POST(req: NextRequest) {
  try {
    const { userId, tenantId } = await requireAdminAuth();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Fichier requis" }, { status: 400 });

    const MAX = 2 * 1024 * 1024; // 2 MB max pour CSV
    if (file.size > MAX) return NextResponse.json({ error: "Fichier trop volumineux (max 2 MB)" }, { status: 400 });

    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length < 2) return NextResponse.json({ error: "Fichier vide ou sans données" }, { status: 400 });

    // Normaliser les headers
    const headers = rows[0].map((h) => h.toLowerCase().replace(/[\s-]/g, "_"));
    const required = ["date", "chauffeur", "ca_brut"];
    const missing = required.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      return NextResponse.json({
        error: `Colonnes manquantes : ${missing.join(", ")}. Utilisez le template téléchargeable.`,
      }, { status: 400 });
    }

    const idx = (name: string) => headers.indexOf(name);

    // Charger les chauffeurs du tenant pour le mapping nom → id
    const { data: drivers } = await serviceClient
      .schema("fleet")
      .from("profiles")
      .select("id, driver_id, full_name")
      .eq("tenant_id", tenantId)
      .eq("role", "driver");

    const driverMap = new Map<string, { id: string; driver_id: string }>();
    (drivers ?? []).forEach((d) => {
      if (d.full_name) driverMap.set(d.full_name.trim().toLowerCase(), { id: d.id, driver_id: d.driver_id });
    });

    // Charger les rapports existants pour détecter les doublons
    const { data: existingReports } = await serviceClient
      .schema("fleet")
      .from("daily_reports")
      .select("driver_id, date")
      .eq("tenant_id", tenantId);

    const existingSet = new Set(
      (existingReports ?? []).map((r) => `${r.driver_id}__${r.date}`)
    );

    // Parser chaque ligne
    const parsedRows: Record<string, unknown>[] = [];
    const validationErrors: { row: number; field: string; message: string }[] = [];
    const driversFound = new Set<string>();
    let dates: string[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 1;

      const date = row[idx("date")]?.trim() ?? "";
      const chauffeur = row[idx("chauffeur")]?.trim() ?? "";
      const caBrutRaw = row[idx("ca_brut")]?.trim() ?? "";

      // Validation date
      if (!isValidDate(date)) {
        validationErrors.push({ row: rowNum, field: "date", message: `Date invalide "${date}" (format attendu : YYYY-MM-DD)` });
      }

      // Validation chauffeur
      const driverKey = chauffeur.toLowerCase();
      const driver = driverMap.get(driverKey);
      if (!driver) {
        validationErrors.push({ row: rowNum, field: "chauffeur", message: `Chauffeur "${chauffeur}" introuvable dans le système` });
      } else {
        driversFound.add(chauffeur);
      }

      // Validation CA brut
      const caBrut = parseNumber(caBrutRaw);
      if (caBrut === null || caBrut < 0) {
        validationErrors.push({ row: rowNum, field: "ca_brut", message: `CA brut invalide "${caBrutRaw}" (nombre entier attendu)` });
      }

      // Champs optionnels
      const km = idx("km_parcourus") >= 0 ? parseNumber(row[idx("km_parcourus")] ?? "") : null;
      const rides = idx("nombre_courses") >= 0 ? parseNumber(row[idx("nombre_courses")] ?? "") : null;
      const fuel = idx("frais_carburant") >= 0 ? parseNumber(row[idx("frais_carburant")] ?? "") : null;
      const notes = idx("notes") >= 0 ? (row[idx("notes")] ?? "").trim() : "";

      // Détection doublon
      const isDuplicate = !!(driver && isValidDate(date) && existingSet.has(`${driver.driver_id}__${date}`));

      parsedRows.push({
        row: rowNum,
        date,
        driver_id: driver?.driver_id ?? null,
        driver_profile_id: driver?.id ?? null,
        driver_name: chauffeur,
        ca_brut: caBrut,
        km_parcourus: km,
        nombre_courses: rides,
        frais_carburant: fuel,
        notes,
        is_duplicate: isDuplicate,
        has_error: !isValidDate(date) || !driver || caBrut === null || caBrut < 0,
      });

      if (isValidDate(date)) dates.push(date);
    }

    const validRows = parsedRows.filter((r) => !r.has_error);
    const errorRows = parsedRows.filter((r) => r.has_error);
    const duplicateRows = parsedRows.filter((r) => r.is_duplicate && !r.has_error);

    dates.sort();
    const dateFrom = dates[0] ?? null;
    const dateTo = dates[dates.length - 1] ?? null;

    // Stocker le batch
    const { data: batch, error: insertError } = await serviceClient
      .schema("fleet")
      .from("import_batches")
      .insert({
        tenant_id: tenantId,
        created_by: userId,
        status: "pending_admin_review",
        row_count: parsedRows.length,
        valid_count: validRows.length,
        error_count: errorRows.length,
        duplicate_count: duplicateRows.length,
        date_from: dateFrom,
        date_to: dateTo,
        drivers_found: Array.from(driversFound),
        parsed_rows: parsedRows,
        validation_errors: validationErrors,
      })
      .select("id")
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({
      batchId: batch.id,
      rowCount: parsedRows.length,
      validCount: validRows.length,
      errorCount: errorRows.length,
      duplicateCount: duplicateRows.length,
      dateFrom,
      dateTo,
      driversFound: Array.from(driversFound),
      parsedRows,
      validationErrors,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
}
