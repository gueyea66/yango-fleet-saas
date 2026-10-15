import { figerPeriode, restaurerPeriode } from "@/lib/v2/vueDefaut";
import { defaultPeriod, type AdminPeriod } from "@/lib/v2/periodFilter";

const OCT = new Date(2026, 9, 15);
const NOV = new Date(2026, 10, 3);
const base = (d: Date) => defaultPeriod(d);
const p = (x: Partial<AdminPeriod>): AdminPeriod => ({ ...base(OCT), ...x });

describe("vue par défaut : période", () => {
  it("le mois en cours reste le mois en cours", () => {
    const f = figerPeriode(p({ kind: "mois", month: "2026-10" }), OCT);
    expect(f).toEqual({ kind: "mois", relative: true });
    expect(restaurerPeriode(f, base(NOV))).toMatchObject({ kind: "mois", month: "2026-11" });
  });

  it("7 jours, jour et année en cours suivent aujourd'hui", () => {
    expect(figerPeriode(p({ kind: "7j" }), OCT).relative).toBe(true);
    expect(figerPeriode(p({ kind: "jour" }), OCT).relative).toBe(true);
    const an = figerPeriode(p({ kind: "annee", year: 2026 }), OCT);
    expect(an.relative).toBe(true);
    expect(restaurerPeriode(an, base(new Date(2027, 0, 5)))).toMatchObject({ kind: "annee", year: 2027 });
  });

  it("une période choisie à la main est rouverte telle quelle", () => {
    const sept = figerPeriode(p({ kind: "mois", month: "2026-09" }), OCT);
    expect(restaurerPeriode(sept, base(NOV))).toMatchObject({ kind: "mois", month: "2026-09" });
    const plusieurs = figerPeriode(p({ kind: "mois", month: "2026-09", months: ["2026-07", "2026-09"] }), OCT);
    expect(restaurerPeriode(plusieurs, base(NOV))).toMatchObject({ kind: "mois", month: "2026-09", months: ["2026-07", "2026-09"] });
    const dates = figerPeriode(p({ kind: "dates", from: "2026-09-01", to: "2026-09-20" }), OCT);
    expect(restaurerPeriode(dates, base(NOV))).toMatchObject({ kind: "dates", from: "2026-09-01", to: "2026-09-20" });
    const an = figerPeriode(p({ kind: "annee", year: 2025 }), OCT);
    expect(restaurerPeriode(an, base(NOV))).toMatchObject({ kind: "annee", year: 2025 });
  });
});
