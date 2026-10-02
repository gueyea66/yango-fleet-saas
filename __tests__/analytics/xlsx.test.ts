import ExcelJS from "exceljs";
import { buildXlsx } from "@/lib/analytics/xlsx";
import { totalRow } from "@/lib/analytics/reports";

const columns = [
  { key: "date", label: "Date", type: "date" as const },
  { key: "chauffeur", label: "Chauffeur", type: "text" as const },
  { key: "ca", label: "CA", type: "xof" as const, sum: true },
  { key: "acc", label: "Acceptation", type: "pct" as const },
];
const rows = [
  { date: "2026-09-29", chauffeur: "Moussa", ca: 25_000, acc: 0.9 },
  { date: "2026-09-30", chauffeur: "Awa", ca: 15_500, acc: null },
];

describe("extraction Excel", () => {
  it("ligne TOTAL : seules les colonnes additionnables", () => {
    expect(totalRow(columns, rows)).toEqual({ date: "TOTAL", chauffeur: null, ca: 40_500, acc: null });
    expect(totalRow(columns, [])).toBeNull();
  });
  it("fichier relisible : titre, en-têtes, valeurs typées, total", async () => {
    const buf = await buildXlsx({ report: "declarations", title: "Déclarations journalières", subtitle: "Du 29/09/2026 au 30/09/2026", columns, rows, hasFleetroom: false });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    expect(ws.getCell("A1").value).toBe("Déclarations journalières");
    expect(ws.getRow(4).values).toEqual([undefined, "Date", "Chauffeur", "CA", "Acceptation"]);
    expect(ws.getCell("A5").value).toEqual(new Date(Date.UTC(2026, 8, 29)));
    expect(ws.getCell("C5").value).toBe(25_000);
    expect(ws.getCell("C7").value).toBe(40_500);
    expect(ws.getCell("A7").value).toBe("TOTAL");
  });
});
