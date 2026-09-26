"use client";

import { useRef } from "react";
import {
  Fuel, Ticket, ShieldAlert, Wrench, Droplets, Gavel, Wallet, HandCoins, Ellipsis, Camera, Check, X, type LucideIcon,
} from "lucide-react";
import { Card, Button } from "@/components/ui";
import { useExpenseForm } from "@/components/driver/useExpenseForm";
import { CAT_AVANCE } from "@/lib/expenseCategories";
import { displayLabel } from "@/lib/tenant/platformLabel";
import { formatAmount, groupInput } from "@/lib/v2/format";
import { parseAmountInput, type DriverTab } from "@/lib/v2/driver";
import type { Profile } from "@/components/driver/shared";
import { ScreenHeader, ScreenBody, DoneHero, InlineNumber, fieldStyle, Label } from "./parts";

const CAT_ICONS: Record<string, LucideIcon> = {
  Carburant: Fuel,
  "Péage": Ticket,
  "Contrôle routier": ShieldAlert,
  Entretien: Wrench,
  Lavage: Droplets,
  Amende: Gavel,
  "Solde Yango": Wallet,
  [CAT_AVANCE]: HandCoins,
  Autre: Ellipsis,
};

/**
 * Dépense v2 (maquette 1d). Insert `expenses` + uploads + action_logs +
 * notification : logique de l'UI actuelle, partagée via useExpenseForm.
 * `CAT_AVANCE` n'est proposée qu'aux comptes techniques (déjà filtré par le hook).
 */
export function ExpenseV2({ profile, onNav }: { profile: Profile; onNav: (t: DriverTab) => void }) {
  const {
    today, form, setForm, submitted, setSubmitted, setExpenseId, saving, pendingFiles, setPendingFiles,
    set, expenseTypes, advanceTo, setAdvanceTo, targets, addFiles, submit,
  } = useExpenseForm(profile);
  const photoRef = useRef<HTMLInputElement>(null);
  const amount = parseAmountInput(form.amount);

  if (submitted) {
    const reset = () => {
      setForm({ expense_date: today, type: "Carburant", amount: "", odometer: "", fuel_liters: "", comment: "" });
      setAdvanceTo(""); setSubmitted(false); setExpenseId(null);
      // Sans ça, les pièces de la dépense précédente restaient dans la file
      // et repartaient avec la suivante.
      setPendingFiles([]);
    };
    return (
      <>
        <ScreenBody padding="24px 20px" style={{ justifyContent: "center" }}>
          <DoneHero title="Dépense envoyée" text="Ton gestionnaire va la valider. Tu recevras une notification." />
          <Card mobile padding="16px" style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginTop: 10 }}>
            <span style={{ color: "var(--sk-t2)" }}>{displayLabel(form.type)}</span>
            <span className="v2-num" style={{ fontWeight: 600 }}>{formatAmount(amount)} XOF</span>
          </Card>
        </ScreenBody>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, flex: "none" }}>
          <Button variant="outline" size="lg" block onClick={reset} style={{ height: 56 }}>Nouvelle dépense</Button>
          <button type="button" onClick={() => onNav("home")} className="v2-focus"
            style={{ height: 48, background: "none", border: "none", color: "var(--sk-t2)", fontSize: 15, cursor: "pointer" }}>
            Retour à l&apos;accueil
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader title="Nouvelle dépense" onBack={() => onNav("home")} />
      <ScreenBody padding="20px 16px" gap={18}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, color: "var(--v2-muted)" }}>Quoi ?</div>
          <div role="radiogroup" aria-label="Catégorie" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
            {expenseTypes.map((t) => {
              const on = form.type === t;
              const Icon = CAT_ICONS[t] ?? Ellipsis;
              return (
                <button key={t} type="button" role="radio" aria-checked={on} onClick={() => set("type", t)} className="v2-btn v2-focus"
                  style={{
                    height: 64, borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
                    padding: "0 6px", fontSize: 13, fontWeight: on ? 600 : 400, cursor: "pointer", lineHeight: 1.15, textAlign: "center", whiteSpace: "normal",
                    background: on ? "var(--v2-select-bg)" : "var(--sk-bg)",
                    border: `1px solid ${on ? "var(--tenant-color)" : "var(--sk-surface)"}`,
                    color: on ? "var(--tenant-color)" : t === "Autre" ? "var(--sk-t2)" : "var(--sk-t1)",
                  }}>
                  <Icon size={18} aria-hidden />
                  {displayLabel(t)}
                </button>
              );
            })}
          </div>
        </div>

        {form.type === CAT_AVANCE && (
          <div>
            <Label htmlFor="v2-adv">Remis à (chauffeur)</Label>
            <select id="v2-adv" value={advanceTo} onChange={(e) => setAdvanceTo(e.target.value)} className="v2-focus" style={fieldStyle}>
              <option value="">— Non affecté (autre sortie) —</option>
              {targets.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label htmlFor="v2-amount" style={{ fontSize: 13, color: "var(--v2-muted)" }}>Combien ?</label>
          <div style={{ height: 76, borderRadius: 16, background: "var(--sk-bg)", border: `1px solid ${amount > 0 ? "var(--tenant-color)" : "var(--sk-surface)"}`, display: "flex", alignItems: "center", padding: "0 18px", gap: 8 }}>
            <input id="v2-amount" inputMode="numeric" placeholder="0" value={groupInput(form.amount)}
              onChange={(e) => set("amount", e.target.value.replace(/\D/g, ""))}
              className="v2-num" style={{ flex: 1, minWidth: 0, background: "none", border: "none", outline: "none", color: "var(--sk-t1)", fontSize: 34, fontWeight: 600, letterSpacing: "-.02em" }} />
            <span style={{ fontSize: 14, color: "var(--v2-muted)" }}>XOF</span>
          </div>
          {form.type === "Carburant" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--sk-t2)", flex: 1 }}>Litres</span>
                <InlineNumber ariaLabel="Litres" inputMode="decimal" value={form.fuel_liters} onChange={(v) => set("fuel_liters", v)} width={96} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--sk-t2)", flex: 1 }}>Kilométrage <span style={{ color: "var(--sk-t3)" }}>(optionnel)</span></span>
                <InlineNumber ariaLabel="Kilométrage" value={form.odometer} onChange={(v) => set("odometer", v)} width={120} suffix="km" />
              </div>
            </>
          )}
        </div>

        <button type="button" onClick={() => photoRef.current?.click()} className="v2-focus"
          style={{ display: "flex", alignItems: "center", gap: 14, padding: 14, borderRadius: 16, border: pendingFiles.length ? "1px solid var(--sk-surface)" : "1.5px dashed var(--sk-border)", background: pendingFiles.length ? "var(--sk-bg)" : "transparent", color: "inherit", textAlign: "left", cursor: "pointer" }}>
          <span style={{ width: 48, height: 48, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flex: "none",
            color: pendingFiles.length ? "var(--fleet-positive)" : "var(--tenant-color)", background: pendingFiles.length ? "rgba(74,222,128,.12)" : "rgba(var(--tenant-color-rgb),.1)" }}>
            {pendingFiles.length ? <Check size={22} aria-hidden /> : <Camera size={22} aria-hidden />}
          </span>
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--sk-t1)" }}>
              {pendingFiles.length ? `${pendingFiles.length} photo${pendingFiles.length > 1 ? "s" : ""} du reçu` : "Photo du reçu"}
            </span>
            <span style={{ display: "block", fontSize: 13, color: "var(--v2-muted)", marginTop: 2 }}>
              {pendingFiles.length ? "Touche pour en ajouter" : "Recommandé — validation plus rapide"}
            </span>
          </span>
        </button>
        {pendingFiles.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: -8 }}>
            {pendingFiles.map((f, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "100%", padding: "0 4px 0 10px", height: 32, borderRadius: 16, background: "var(--sk-surface)", fontSize: 12, color: "var(--sk-t2)" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{f.name}</span>
                <button type="button" aria-label={`Retirer ${f.name}`} onClick={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                  style={{ width: 28, height: 28, background: "none", border: "none", color: "var(--sk-t3)", cursor: "pointer" }}><X size={14} aria-hidden /></button>
              </span>
            ))}
          </div>
        )}
        <input ref={photoRef} type="file" accept="image/*,.pdf" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            <Label htmlFor="v2-exp-date">Date</Label>
            <input id="v2-exp-date" type="date" value={form.expense_date} max={today} onChange={(e) => set("expense_date", e.target.value)} className="v2-focus" style={{ ...fieldStyle, colorScheme: "inherit" as never }} />
          </div>
          <div>
            <Label htmlFor="v2-exp-note">Note{form.type === "Autre" ? " (conseillée)" : ""}</Label>
            <input id="v2-exp-note" type="text" placeholder="Optionnel" value={form.comment} onChange={(e) => set("comment", e.target.value)} className="v2-focus" style={fieldStyle} />
          </div>
        </div>

        <Button size="xl" block disabled={saving || amount <= 0} onClick={() => void submit()} style={{ marginTop: "auto" }}>
          {saving ? "Envoi en cours…" : amount > 0 ? `Envoyer ${formatAmount(amount)} XOF` : "Indique un montant"}
        </Button>
      </ScreenBody>
    </>
  );
}
