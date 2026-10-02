import { entryPathFor } from "@/lib/auth/entry";

describe("entryPathFor (ouverture de l'app installée)", () => {
  it("sans profil → connexion, jamais la vitrine", () => {
    expect(entryPathFor(null)).toBe("/auth/login");
    expect(entryPathFor(undefined)).toBe("/auth/login");
  });
  it("admin → /admin, chauffeur → /driver", () => {
    expect(entryPathFor({ role: "admin" })).toBe("/admin");
    expect(entryPathFor({ role: "driver", active: true })).toBe("/driver");
    expect(entryPathFor({ role: "driver" })).toBe("/driver");
  });
  it("chauffeur désactivé → connexion avec le message", () => {
    expect(entryPathFor({ role: "driver", active: false })).toBe("/auth/login?disabled=1");
  });
  it("rôle inconnu → connexion", () => {
    expect(entryPathFor({ role: "superadmin" })).toBe("/auth/login");
  });
});
