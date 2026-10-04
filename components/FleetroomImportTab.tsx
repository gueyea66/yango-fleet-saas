"use client";

/**
 * Onglet « Import Fleetroom » : le gestionnaire dépose les exports Yango
 * (transactions, commandes, soldes) tels quels ; l'app en tire les
 * déclarations journalières. Règles et garde-fous : docs/IMPORT-FLEETROOM.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { notifyDataChanged } from "@/lib/dataRefresh";
import {
  detectKind, parseOrders, parseTransactions, periodOf, splitCsv, type FleetroomKind,
} from "@/lib/fleetroom/parse";

const MAX_BYTES = 4 * 1024 * 1024; // limite du corps de requête Vercel (4,5 Mo)

const KIND_LABEL: Record<FleetroomKind, string> = {
  transactions: "Transactions",
  orders: "Commandes",
  soldes: "Soldes",
};

interface Picked {
  file: File;
  kind: FleetroomKind | null;
  rows: number;
  from: string | null;
  to: string | null;
}

interface IngestResult {
  files: { name: string; kind: FleetroomKind | null; status: string; message?: string; rows_total?: number; rows_new?: number }[];
  rebuild: {
    inserted: number; updated: number; conflicts: number; recharges: number; unmapped_drivers: string[];
    /** Absent tant que la migration 076 n'est pas appliquée. */
    ecarts_solde?: { chauffeur: string; jour: string; type: "jour" | "intervalle"; depuis: string | null;
      attendu: number; constate: number; ecart: number }[];
  } | null;
  linkedDrivers: string[];
  unknownDrivers: string[];
}

interface ImportRow {
  id: string;
  kind: FleetroomKind;
  period_from: string | null;
  period_to: string | null;
  rows_total: number;
  rows_new: number;
  created_at: string;
}

interface Conflict {
  driver_id: string;
  jour: string;
  declared: Record<string, number | string | null>;
  fleetroom: Record<string, number | null>;
  profiles: { full_name: string } | null;
}

const fmt = (n: unknown) =>
  n == null || n === "" ? "—" : new Intl.NumberFormat("fr-FR").format(Math.round(Number(n)));

const card = { background: "var(--sk-bg)", border: "1px solid var(--sk-surface)", borderRadius: 12, padding: "14px 18px" } as const;
const caption = { fontSize: 12, fontWeight: 700, color: "var(--sk-t2)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 } as const;

export default function FleetroomImportTab() {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [soldesJour, setSoldesJour] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResult | null>(null);
  const [history, setHistory] = useState<{ imports: ImportRow[]; openConflicts: number; lastDay: string | null } | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [h, c] = await Promise.all([
      fetch("/api/admin/fleetroom").then((r) => r.json()).catch(() => null),
      fetch("/api/admin/fleetroom/conflicts").then((r) => r.json()).catch(() => null),
    ]);
    if (h && !h.error) setHistory(h);
    if (c && !c.error) setConflicts(c.conflicts ?? []);
  }, []);
  // Chargement initial : l'état est posé après la réponse réseau, pas pendant l'effet.
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  async function onFiles(list: FileList | null) {
    if (!list) return;
    setResult(null);
    setError(null);
    const out: Picked[] = [];
    for (const file of Array.from(list)) {
      const rows = splitCsv(await file.text());
      const kind = rows.length ? detectKind(rows[0]) : null;
      let period = { from: null as string | null, to: null as string | null };
      try {
        if (kind === "transactions") period = periodOf(parseTransactions(rows).map((t) => t.jour));
        if (kind === "orders") period = periodOf(parseOrders(rows).map((o) => o.jour));
      } catch { /* l'en-tête est reconnu mais incomplet : le serveur le dira */ }
      out.push({ file, kind, rows: Math.max(0, rows.length - 1), ...period });
    }
    setPicked(out);
    // Date proposée pour l'export Soldes : dernier jour couvert par les transactions.
    const lastTx = out.filter((p) => p.kind === "transactions").map((p) => p.to).filter(Boolean).sort().pop();
    if (out.some((p) => p.kind === "soldes") && !soldesJour && lastTx) setSoldesJour(lastTx);
  }

  const hasSoldes = picked.some((p) => p.kind === "soldes");
  const totalBytes = picked.reduce((a, p) => a + p.file.size, 0);
  const unknown = picked.filter((p) => !p.kind);
  const canSend = picked.length > 0 && unknown.length === 0 && totalBytes <= MAX_BYTES
    && (!hasSoldes || /^\d{4}-\d{2}-\d{2}$/.test(soldesJour)) && !busy;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      picked.forEach((p) => fd.append("files", p.file));
      if (hasSoldes) fd.append("soldesJour", soldesJour);
      const res = await fetch("/api/admin/fleetroom", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`);
      setResult(json);
      notifyDataChanged(); // tableau de bord et listes à jour sans recharger la page
      setPicked([]);
      if (inputRef.current) inputRef.current.value = "";
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resolve(c: Conflict, action: "keep_declared" | "use_fleetroom") {
    const res = await fetch("/api/admin/fleetroom/conflicts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ driver_id: c.driver_id, jour: c.jour, action }),
    });
    if (res.ok) { setConflicts((cs) => cs.filter((x) => !(x.driver_id === c.driver_id && x.jour === c.jour))); notifyDataChanged(); }
    else setError((await res.json()).error ?? "Échec");
  }

  return (
    <div className="p-6 max-w-4xl space-y-8">
      <div>
        <h2 className="text-xl font-bold text-white mb-2">Import Fleetroom</h2>
        <p className="text-sm" style={{ color: "var(--sk-t3)" }}>
          Déposez les exports Yango Fleetroom tels quels : <b>transactions</b> et <b>commandes</b> de la période,
          et si possible les <b>soldes</b> du dernier jour (ceux des jours précédents sont reconstitués
          à partir de celui-ci). Les déclarations de chaque chauffeur sont calculées
          automatiquement. Redéposer un fichier ou une période qui chevauche ne crée aucun doublon.
          {history?.lastDay && <> Dernier jour reçu : <b>{history.lastDay}</b>.</>}
        </p>
      </div>

      <div style={card}>
        <input ref={inputRef} type="file" accept=".csv,text/csv" multiple className="hidden"
          onChange={(e) => onFiles(e.target.files)} />
        <button onClick={() => inputRef.current?.click()}
          className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm text-black"
          style={{ background: "linear-gradient(135deg,var(--tenant-color),var(--tenant-color-dark))" }}>
          <Upload size={16} strokeWidth={2.2} /> Choisir les exports (CSV)
        </button>

        {picked.length > 0 && (
          <div className="mt-4 space-y-2 text-sm">
            {picked.map((p) => (
              <div key={p.file.name} className="flex flex-wrap justify-between gap-2" style={{ color: "var(--sk-t1)" }}>
                <span>{p.file.name}</span>
                <span style={{ color: p.kind ? "var(--sk-t2)" : "#dc2626" }}>
                  {p.kind ? `${KIND_LABEL[p.kind]} · ${fmt(p.rows)} lignes${p.from ? ` · ${p.from} → ${p.to}` : ""}`
                    : "Export non reconnu"}
                </span>
              </div>
            ))}
            {hasSoldes && (
              <label className="flex items-center gap-3 pt-2" style={{ color: "var(--sk-t2)" }}>
                Date des soldes (le fichier ne la contient pas)
                <input type="date" value={soldesJour} onChange={(e) => setSoldesJour(e.target.value)}
                  className="bg-gray-800 border border-gray-600 text-white text-sm rounded-lg px-3 py-1" />
              </label>
            )}
            {totalBytes > MAX_BYTES && (
              <div style={{ color: "#dc2626" }}>
                Fichiers trop lourds ({(totalBytes / 1048576).toFixed(1)} Mo) : déposez au plus ~2 mois à la fois.
              </div>
            )}
            <button onClick={send} disabled={!canSend}
              className="mt-2 px-5 py-2 rounded-xl font-bold text-sm text-black disabled:opacity-40"
              style={{ background: "var(--tenant-color)" }}>
              {busy ? "Intégration en cours…" : "Intégrer"}
            </button>
          </div>
        )}
        {error && <div className="mt-3 text-sm" style={{ color: "#dc2626" }}>{error}</div>}
      </div>

      {result && (
        <div style={card} className="text-sm space-y-2">
          <div style={caption}>Compte rendu</div>
          {result.files.map((f) => (
            <div key={f.name} style={{ color: "var(--sk-t1)" }}>
              {f.kind ? KIND_LABEL[f.kind] : f.name} :{" "}
              {f.status === "imported" ? `${fmt(f.rows_new)} nouvelles lignes, ${fmt((f.rows_total ?? 0) - (f.rows_new ?? 0))} déjà connues`
                : f.message}
            </div>
          ))}
          {result.rebuild && (
            <div style={{ color: "var(--sk-t1)" }}>
              Déclarations : {fmt(result.rebuild.inserted)} créées, {fmt(result.rebuild.updated)} mises à jour ·
              recharges : {fmt(result.rebuild.recharges)} · écarts avec les chauffeurs : {fmt(result.rebuild.conflicts)}
            </div>
          )}
          {(result.rebuild?.ecarts_solde?.length ?? 0) > 0 && (
            <div style={{ color: "#b45309" }}>
              Soldes à vérifier : les transactions ne collent pas à l&apos;export Soldes, les soldes
              reconstitués autour de ces jours sont faux d&apos;autant. Redéposez les transactions complètes.
              <ul className="mt-1 list-disc pl-5">
                {result.rebuild!.ecarts_solde!.map((e) => (
                  <li key={`${e.chauffeur}-${e.jour}-${e.type}`}>
                    {e.chauffeur}, {e.jour} : attendu {fmt(e.attendu)}, Yango {fmt(e.constate)} (écart {fmt(e.ecart)}) —{" "}
                    {e.type === "jour" ? "transactions du jour incomplètes" : `transactions manquantes depuis le ${e.depuis}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.unknownDrivers.length > 0 && (
            <div style={{ color: "#b45309" }}>
              Chauffeurs absents de l&apos;app (ajoutez-les puis redéposez) : {result.unknownDrivers.join(", ")}
            </div>
          )}
        </div>
      )}

      {conflicts.length > 0 && (
        <div>
          <div style={caption}>Écarts à trancher ({conflicts.length})</div>
          <p className="text-sm mb-3" style={{ color: "var(--sk-t3)" }}>
            Jours où le chauffeur avait déjà déclaré : sa déclaration n&apos;a pas été écrasée.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ color: "var(--sk-t1)" }}>
              <thead style={{ color: "var(--sk-t3)" }}>
                <tr className="text-left">
                  <th className="py-2 pr-3">Jour</th><th className="pr-3">Chauffeur</th>
                  <th className="pr-3">Espèces décl. / Yango</th><th className="pr-3">Carte décl. / Yango</th>
                  <th className="pr-3">Courses</th><th className="pr-3">Solde</th><th />
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => (
                  <tr key={c.driver_id + c.jour} style={{ borderTop: "1px solid var(--sk-surface)" }}>
                    <td className="py-2 pr-3">{c.jour}</td>
                    <td className="pr-3">{c.profiles?.full_name ?? "—"}</td>
                    <td className="pr-3">{fmt(c.declared.especes)} / {fmt(c.fleetroom.especes)}</td>
                    <td className="pr-3">{fmt(c.declared.carte)} / {fmt(c.fleetroom.carte)}</td>
                    <td className="pr-3">{fmt(c.declared.courses)} / {fmt(c.fleetroom.courses)}</td>
                    <td className="pr-3">{fmt(c.declared.solde)} / {fmt(c.fleetroom.solde)}</td>
                    <td className="whitespace-nowrap">
                      <button onClick={() => resolve(c, "keep_declared")} className="px-2 py-1 mr-1 rounded-lg text-xs"
                        style={{ border: "1px solid var(--sk-surface)" }}>Garder la déclaration</button>
                      <button onClick={() => resolve(c, "use_fleetroom")} className="px-2 py-1 rounded-lg text-xs text-black"
                        style={{ background: "var(--tenant-color)" }}>Prendre Yango</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {history && history.imports.length > 0 && (
        <div>
          <div style={caption}>Derniers dépôts</div>
          <div className="space-y-2">
            {history.imports.map((i) => (
              <div key={i.id} style={card} className="text-sm flex flex-wrap justify-between gap-2">
                <span style={{ color: "var(--sk-t1)" }}>
                  {KIND_LABEL[i.kind]} · {i.period_from} → {i.period_to}
                </span>
                <span style={{ color: "var(--sk-t3)" }}>
                  {fmt(i.rows_new)} nouvelles / {fmt(i.rows_total)} · déposé le {String(i.created_at).slice(0, 10)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
