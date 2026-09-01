/**
 * Non-régression : supprimer un chauffeur ne doit JAMAIS faire disparaître le
 * véhicule qui lui était assigné (incident du Kia K3).
 *
 * Le véhicule est un actif de la flotte : la suppression du chauffeur doit le
 * désassigner, pas le détruire. Et si la base refuse la désassignation (FK
 * ON DELETE CASCADE encore en place, migration 045 non appliquée), la
 * suppression doit être refusée plutôt que de détruire le véhicule.
 */

interface QueryState {
  table: string;
  op: string | null;
  payload?: Record<string, unknown>;
  filters: [string, unknown][];
  single: boolean;
}

type Handler = (s: QueryState) => { data?: unknown; error?: { message: string } | null };

const calls: QueryState[] = [];
let handler: Handler = () => ({ data: null, error: null });
const deletedAuthUsers: string[] = [];

function makeClient() {
  return {
    from(table: string) {
      const state: QueryState = { table, op: null, filters: [], single: false };
      const builder: Record<string, unknown> = {
        select: () => { state.op ??= "select"; return builder; },
        update: (v: Record<string, unknown>) => { state.op = "update"; state.payload = v; return builder; },
        delete: () => { state.op = "delete"; return builder; },
        insert: (v: Record<string, unknown>) => { state.op = "insert"; state.payload = v; return builder; },
        upsert: (v: Record<string, unknown>) => { state.op = "upsert"; state.payload = v; return builder; },
        eq: (col: string, val: unknown) => { state.filters.push([col, val]); return builder; },
        order: () => builder,
        limit: () => builder,
        single: () => { state.single = true; return builder; },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
          calls.push({ ...state, filters: [...state.filters] });
          return Promise.resolve(handler(state)).then(res, rej);
        },
      };
      return builder;
    },
    auth: {
      admin: {
        deleteUser: async (id: string) => { deletedAuthUsers.push(id); return {}; },
      },
    },
  };
}

jest.mock("@supabase/supabase-js", () => ({ createClient: () => makeClient() }));
jest.mock("@/lib/audit", () => ({ audit: jest.fn() }));
jest.mock("@/lib/auth/server", () => ({
  requireAdminAuth: async () => ({ tenantId: "tenant-1", userId: "admin-1", role: "admin" }),
  getClientIp: () => "127.0.0.1",
}));

const TENANT = "tenant-1";
const PROFILE_ID = "profile-1";

function deleteRequest() {
  return new Request("http://localhost/api/admin/drivers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "delete", driverId: "D001" }),
  });
}

function baseHandler(overrides: Handler | null = null): Handler {
  return (s) => {
    if (overrides) {
      const r = overrides(s);
      if (r !== undefined && r !== null) return r;
    }
    if (s.table === "profiles" && s.single) {
      return { data: { id: PROFILE_ID, tenant_id: TENANT }, error: null };
    }
    if (s.table === "vehicles" && s.op === "select") {
      return { data: [{ id: "veh-1", plate: "AA-123-BB" }], error: null };
    }
    return { data: null, error: null };
  };
}

describe("DELETE chauffeur — le véhicule assigné doit survivre", () => {
  beforeEach(() => {
    calls.length = 0;
    deletedAuthUsers.length = 0;
    jest.resetModules();
  });

  it("désassigne le véhicule AVANT de supprimer le profil", async () => {
    handler = baseHandler();
    const { POST } = await import("@/app/api/admin/drivers/route");

    const res = await POST(deleteRequest());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      success: true,
      unassignedVehicles: ["AA-123-BB"],
    });

    const unassign = calls.findIndex(
      (c) => c.table === "vehicles" && c.op === "update" && c.payload?.driver_id === null
    );
    const profileDelete = calls.findIndex((c) => c.table === "profiles" && c.op === "delete");

    expect(unassign).toBeGreaterThanOrEqual(0);
    expect(profileDelete).toBeGreaterThanOrEqual(0);
    // L'ordre est ce qui protège le véhicule : libéré, puis le chauffeur part.
    expect(unassign).toBeLessThan(profileDelete);

    // Aucune suppression de ligne véhicule, jamais.
    expect(calls.some((c) => c.table === "vehicles" && c.op === "delete")).toBe(false);
  });

  it("refuse la suppression (409) si le véhicule ne peut pas être libéré", async () => {
    // Simule la base d'avant la migration 045 : driver_id NOT NULL + CASCADE.
    handler = baseHandler((s) =>
      s.table === "vehicles" && s.op === "update"
        ? { data: null, error: { message: 'null value in column "driver_id" violates not-null constraint' } }
        : (null as never)
    );
    const { POST } = await import("@/app/api/admin/drivers/route");

    const res = await POST(deleteRequest());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toContain("AA-123-BB");
    expect(body.error).toContain("045");

    // Le profil ne doit PAS avoir été supprimé : sinon la cascade emporte le véhicule.
    expect(calls.some((c) => c.table === "profiles" && c.op === "delete")).toBe(false);
    expect(deletedAuthUsers).toHaveLength(0);
  });

  it("supprime normalement un chauffeur sans véhicule", async () => {
    handler = baseHandler((s) =>
      s.table === "vehicles" && s.op === "select" ? { data: [], error: null } : (null as never)
    );
    const { POST } = await import("@/app/api/admin/drivers/route");

    const res = await POST(deleteRequest());
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.table === "vehicles" && c.op === "update")).toBe(false);
    expect(calls.some((c) => c.table === "profiles" && c.op === "delete")).toBe(true);
    expect(deletedAuthUsers).toEqual([PROFILE_ID]);
  });
});
