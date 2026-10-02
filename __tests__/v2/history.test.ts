import {
  buildHistoryRows, historyStatusCounts, normStatus, countUploadsByRef, chunk, fileKind, enrichUpload,
  expenseRangeOr, isoDayOrNull,
} from "@/lib/v2/history";

const reports = [
  { id: "r1", driver_id: "d1", date: "2026-09-10", status: "approved", net_after_expenses: 20000, created_at: "2026-09-10T20:00:00Z" },
  { id: "r2", driver_id: "d2", date: "2026-09-12", status: "submitted", net_after_expenses: 15000, created_at: "2026-09-12T21:00:00Z" },
  { id: "r3", driver_id: "d1", date: "2026-09-12", status: "rejected", net_after_expenses: 9000, created_at: "2026-09-12T22:00:00Z" },
  { id: "r4", driver_id: "d1", date: "2026-09-11", status: "archived", net_after_expenses: 1 },
  { id: "r5", driver_id: "d2", date: "2026-08-30", status: "approved", net_after_expenses: 5 },
  { id: "r6", driver_id: "d2", date: "2026-09-05", status: "approved", comment: "[REPOS] malade", net_after_expenses: 0 },
];
const expenses = [
  { id: "e1", driver_id: "d1", expense_date: "2026-09-11", status: "approved", amount: 3000, category: "Carburant" },
  { id: "e2", driver_id: "d2", expense_date: null, created_at: "2026-09-13T08:00:00Z", status: null, amount: 1500 },
  { id: "e3", driver_id: "d1", expense_date: "2026-09-02", status: "rejected", amount: 700 },
];
const range = { from: "2026-09-01", to: "2026-09-30" };

describe("historique : déclarations + charges dans une seule liste", () => {
  it("mélange les deux types, du plus récent au plus ancien, archivées écartées", () => {
    const rows = buildHistoryRows(reports, expenses, { range });
    expect(rows.map((r) => r.id)).toEqual(["e2", "r3", "r2", "e1", "r1", "r6", "e3"]);
    expect(rows.find((r) => r.id === "r4")).toBeUndefined();
  });
  it("la période borne la liste (r5 est en août)", () => {
    expect(buildHistoryRows(reports, expenses, { range }).some((r) => r.id === "r5")).toBe(false);
    expect(buildHistoryRows(reports, expenses).some((r) => r.id === "r5")).toBe(true);
  });
  it("filtre de type : Déclarations / Charges", () => {
    expect(buildHistoryRows(reports, expenses, { type: "report", range }).every((r) => r.kind === "report")).toBe(true);
    expect(buildHistoryRows(reports, expenses, { type: "expense", range }).map((r) => r.id)).toEqual(["e2", "e1", "e3"]);
  });
  it("filtre de statut ; dépense sans statut = en attente", () => {
    expect(buildHistoryRows(reports, expenses, { status: "submitted", range }).map((r) => r.id)).toEqual(["e2", "r2"]);
    expect(buildHistoryRows(reports, expenses, { status: "rejected", range }).map((r) => r.id)).toEqual(["r3", "e3"]);
  });
  it("filtre chauffeur", () => {
    expect(buildHistoryRows(reports, expenses, { driverIds: ["d2"], range }).map((r) => r.id)).toEqual(["e2", "r2", "r6"]);
  });
  it("compteurs de statut et nombre de photos par ligne", () => {
    const rows = buildHistoryRows(reports, expenses, { range, counts: { r1: 2, e1: 1 } });
    expect(historyStatusCounts(rows)).toEqual({ all: 7, submitted: 2, approved: 3, rejected: 2 });
    expect(rows.find((r) => r.id === "r1")?.photos).toBe(2);
    expect(rows.find((r) => r.id === "e1")?.photos).toBe(1);
    expect(rows.find((r) => r.id === "r2")?.photos).toBe(0);
  });
  it("jour de repos : pas de montant", () => {
    const r6 = buildHistoryRows(reports, [], { range }).find((r) => r.id === "r6")!;
    expect(r6.repos).toBe(true);
    expect(r6.amount).toBe(0);
  });
  it("normStatus", () => {
    expect(normStatus(undefined)).toBe("submitted");
    expect(normStatus("approved")).toBe("approved");
    expect(normStatus("archived")).toBeNull();
  });
});

describe("pièces jointes", () => {
  it("compte par ref_id, ignore les lignes sans ref", () => {
    expect(countUploadsByRef([{ ref_id: "a" }, { ref_id: "a" }, { ref_id: "b" }, { ref_id: null }, {}])).toEqual({ a: 2, b: 1 });
  });
  it("chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
  it("HEIC/HEIF : pas une vignette <img>", () => {
    expect(fileKind("IMG_0001.HEIC")).toBe("heic");
    expect(fileKind("photo.heif")).toBe("heic");
    expect(fileKind("recu.JPG")).toBe("image");
    expect(fileKind("scan.webp")).toBe("image");
    expect(fileKind("facture.pdf")).toBe("pdf");
    expect(fileKind("notes.docx")).toBe("other");
    expect(fileKind("blob", "image/heic")).toBe("heic");
    expect(fileKind(null)).toBe("other");
  });
  it("enrichUpload : URL absente = signature échouée", () => {
    expect(enrichUpload({ file_name: "a.heic" }, "https://x")).toMatchObject({ kind: "heic", isImg: false, signFailed: false, publicUrl: "https://x" });
    expect(enrichUpload({ file_name: "a.jpg" }, undefined)).toMatchObject({ kind: "image", isImg: true, signFailed: true, publicUrl: "" });
  });
});

describe("filtre période des dépenses (route /api/admin/reports)", () => {
  it("expense_date sinon date d'envoi, borne haute exclusive au lendemain", () => {
    expect(expenseRangeOr("2026-09-01", "2026-09-30")).toBe(
      "and(expense_date.gte.2026-09-01,expense_date.lte.2026-09-30),and(expense_date.is.null,created_at.gte.2026-09-01,created_at.lt.2026-10-01)",
    );
    expect(expenseRangeOr("2025-10-01", null)).toBe(
      "and(expense_date.gte.2025-10-01),and(expense_date.is.null,created_at.gte.2025-10-01)",
    );
    expect(expenseRangeOr(null, null)).toBeNull();
  });
  it("rejette tout ce qui n'est pas une date (pas d'injection dans le filtre)", () => {
    expect(isoDayOrNull("2026-09-01),or(id.eq.x")).toBeNull();
    expect(expenseRangeOr("x", "y")).toBeNull();
  });
});
