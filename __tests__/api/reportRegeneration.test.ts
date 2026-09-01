/**
 * Un rapport déjà poussé au client ne doit jamais être écrasé silencieusement :
 * régénérer remplace le document reçu et renotifie. Sans `force`, la fonction
 * signale l'existant et ne touche à rien ; l'appelant demande confirmation.
 */

const uploads: string[] = [];
let listResult: { data: unknown[] | null; error: { message: string } | null } = { data: [], error: null };

const storageApi = {
  from: () => ({
    list: async () => listResult,
    upload: async (path: string) => { uploads.push(path); return { error: null }; },
    createSignedUrl: async () => ({ data: { signedUrl: "https://signed.example/x" } }),
  }),
  createBucket: async () => ({ error: null }),
};

// Le builder HTML lit profiles/daily_reports/… : toute requête renvoie du vide.
function tableStub() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "lte", "limit", "order"]) b[m] = () => b;
  b.single = () => Promise.resolve({ data: { name: "M3A" }, error: null });
  b.maybeSingle = () => Promise.resolve({ data: null, error: null });
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res);
  return b;
}

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: () => tableStub(), storage: storageApi }),
}));
jest.mock("@/lib/notifications", () => ({
  sendNotification: jest.fn(),
  getTenantAdminId: jest.fn(async () => null),
}));

const TENANT = "tenant-1";
const FROM = "2026-08-01";
const TO = "2026-08-31";
const FILE = `rapport_${FROM}_${TO}.html`;

describe("generateAndStoreReport — protection contre l'écrasement", () => {
  beforeEach(() => { uploads.length = 0; });

  it("signale l'existant et n'écrase pas, sans force", async () => {
    listResult = { data: [{ name: FILE, created_at: "2026-09-01T07:00:00Z", metadata: { size: 42 } }], error: null };
    const { generateAndStoreReport } = await import("@/lib/reportHtml");

    const r = await generateAndStoreReport(TENANT, FROM, TO);
    expect(r.status).toBe("exists");
    expect(r.file).toBe(FILE);
    expect(r.period).toBe("01/08/2026 → 31/08/2026");
    // Rien n'est écrit : le rapport déjà reçu par le client est intact.
    expect(uploads).toHaveLength(0);
  });

  it("écrase quand force est demandé explicitement", async () => {
    listResult = { data: [{ name: FILE, created_at: "2026-09-01T07:00:00Z", metadata: { size: 42 } }], error: null };
    const { generateAndStoreReport } = await import("@/lib/reportHtml");

    const r = await generateAndStoreReport(TENANT, FROM, TO, { force: true });
    expect(r.status).toBe("created");
    expect(uploads).toEqual([`${TENANT}/${FILE}`]);
  });

  it("génère normalement quand la période n'a pas encore de rapport", async () => {
    listResult = { data: [{ name: "rapport_2026-07-01_2026-07-31.html", created_at: null, metadata: null }], error: null };
    const { generateAndStoreReport } = await import("@/lib/reportHtml");

    const r = await generateAndStoreReport(TENANT, FROM, TO);
    expect(r.status).toBe("created");
    expect(uploads).toEqual([`${TENANT}/${FILE}`]);
  });
});

describe("listStoredReports — une panne de lecture n'est pas « aucun rapport »", () => {
  it("remonte l'erreur de stockage", async () => {
    listResult = { data: null, error: { message: "Access denied" } };
    const { listStoredReports } = await import("@/lib/reportHtml");
    await expect(listStoredReports(TENANT)).rejects.toThrow(/Access denied/);
  });

  it("traite un bucket jamais créé comme une liste vide", async () => {
    listResult = { data: null, error: { message: "Bucket not found" } };
    const { listStoredReports } = await import("@/lib/reportHtml");
    await expect(listStoredReports(TENANT)).resolves.toEqual([]);
  });
});

export {};
