/**
 * Le bucket `kyc-documents` est privé : toute erreur de configuration se
 * manifeste par un « Access denied » opaque côté utilisateur. Ces tests
 * verrouillent le diagnostic et la traduction des erreurs Storage.
 */
import { assertServiceRoleKey, describeStorageError } from "@/lib/storage/kyc";

const ENV = { ...process.env };

function jwt(role: string): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role, iss: "supabase" })}.sig`;
}

describe("assertServiceRoleKey", () => {
  beforeEach(() => {
    process.env = { ...ENV, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co" };
  });
  afterAll(() => { process.env = ENV; });

  it("accepte une vraie clé service_role (JWT)", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt("service_role");
    expect(assertServiceRoleKey()).toBeNull();
  });

  it("accepte le nouveau format sb_secret_", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_abc123";
    expect(assertServiceRoleKey()).toBeNull();
  });

  it("rejette une clé anon utilisée à la place de la service_role", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt("anon");
    expect(assertServiceRoleKey()).toMatch(/anon/);
    expect(assertServiceRoleKey()).toMatch(/service_role/);
  });

  it("rejette une clé publishable", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_publishable_abc123";
    expect(assertServiceRoleKey()).toMatch(/publishable/);
  });

  it("signale une clé absente", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(assertServiceRoleKey()).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("signale une clé illisible", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "pas-une-cle";
    expect(assertServiceRoleKey()).toMatch(/n'est pas une clé Supabase valide/);
  });
});

describe("describeStorageError", () => {
  it("transforme « Access denied » en message actionnable", () => {
    const d = describeStorageError({ message: "Access denied" });
    expect(d.message).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(d.message).toContain("Access denied");
    expect(d.status).toBe(502);
  });

  it("reconnaît une violation RLS storage", () => {
    const d = describeStorageError({ message: "new row violates row-level security policy" });
    expect(d.message).toContain("supabase-storage-kyc-policies.sql");
  });

  it("classe un type MIME refusé en 400", () => {
    expect(describeStorageError({ message: "mime type text/plain is not supported" }).status).toBe(400);
  });

  it("classe un dépassement de taille en 413", () => {
    expect(describeStorageError({ message: "The object exceeded the maximum allowed size" }).status).toBe(413);
  });
});
