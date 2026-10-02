/**
 * Fichier Excel (.xlsx) d'une extraction : titre, période, en-têtes figés,
 * filtres automatiques, formats FR (XOF sans décimale, %, heures), ligne TOTAL.
 * Côté serveur uniquement (exceljs).
 */
import ExcelJS from "exceljs";
import { totalRow, type Column, type ReportResult } from "./reports";

const FORMATS: Record<Column["type"], string | undefined> = {
  text: undefined,
  date: "dd/mm/yyyy",
  int: "#,##0",
  xof: "#,##0",
  dec: "#,##0.0",
  h: "#,##0.0",
  pct: "0%",
};

const toCell = (c: Column, v: string | number | null) => {
  if (v == null || v === "") return null;
  if (c.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  return v;
};

export async function buildXlsx(r: ReportResult & { subtitle: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "M3A Fleet";
  wb.created = new Date();
  const ws = wb.addWorksheet(r.title.slice(0, 31));

  ws.addRow([r.title]).font = { bold: true, size: 14 };
  ws.addRow([r.subtitle]).font = { italic: true, color: { argb: "FF666666" } };
  if (r.truncated) ws.addRow(["⚠ Extraction plafonnée à 30 000 lignes : réduisez la période."]).font = { color: { argb: "FFB45309" } };
  ws.addRow([]);

  const headerRow = ws.addRow(r.columns.map((c) => c.label));
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } }; });
  const headerIdx = headerRow.number;

  for (const row of r.rows) ws.addRow(r.columns.map((c) => toCell(c, row[c.key])));
  const total = totalRow(r.columns, r.rows);
  if (total) {
    const tr = ws.addRow(r.columns.map((c) => toCell(c, total[c.key])));
    tr.font = { bold: true };
    tr.eachCell((cell) => { cell.border = { top: { style: "thin" } }; });
  }

  r.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    const fmt = FORMATS[c.type];
    if (fmt) col.numFmt = fmt;
    const longest = Math.max(c.label.length, ...r.rows.slice(0, 500).map((row) => String(row[c.key] ?? "").length));
    col.width = Math.min(Math.max(longest + 2, c.type === "date" ? 12 : 8), 50);
  });

  ws.views = [{ state: "frozen", ySplit: headerIdx }];
  if (r.rows.length) ws.autoFilter = { from: { row: headerIdx, column: 1 }, to: { row: headerIdx + r.rows.length, column: r.columns.length } };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
