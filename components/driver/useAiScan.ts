// Déplacé tel quel depuis app/driver/page.tsx (refonte UI v2, étape 1) :
// logique partagée par l'UI actuelle et l'UI v2 — mêmes requêtes, mêmes
// écritures, même ordre, même gestion d'erreur.
import { useEffect, useState } from "react";
import { compressImageToJpeg } from "@/lib/ai/imageCompressor";
import type { AiScanResult } from "./shared";

export function useAiScan(date: string, onExtracted: (r: AiScanResult) => void) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<"idle" | "working" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<AiScanResult | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/ai/extract-declaration", { method: "GET" })
      .then((r) => { if (alive && r.status === 200) setEnabled(true); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const scan = async (fileList: FileList | File[] | null) => {
    if (!fileList || fileList.length === 0 || phase === "working") return;
    const files = Array.from(fileList).slice(0, 3);
    setPhase("working"); setMessage("Compression des images..."); setResult(null);
    try {
      const fd = new FormData();
      fd.append("date", date);
      for (const f of files) {
        const jpeg = await compressImageToJpeg(f);
        fd.append("files", new File([jpeg], "scan.jpg", { type: "image/jpeg" }));
      }
      setMessage("Lecture en cours (quelques secondes)...");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45_000);
      const res = await fetch("/api/ai/extract-declaration", { method: "POST", body: fd, signal: ctrl.signal });
      clearTimeout(timer);
      if (res.status === 204) { setEnabled(false); return; }
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setPhase("error"); setMessage(j.error || "Lecture impossible — saisis manuellement."); return; }
      const r = j as AiScanResult;
      const readCount = Object.values(r.fields).filter((v) => v !== null).length;
      if (readCount === 0) {
        setPhase("error");
        setMessage("Aucune valeur lisible sur ces images — vérifie la netteté ou saisis manuellement.");
        return;
      }
      setResult(r); setPhase("done"); setMessage("");
      onExtracted(r);
    } catch {
      setPhase("error"); setMessage("Lecture impossible (réseau ?) — le formulaire manuel reste disponible.");
    }
  };

  return { enabled, phase, message, result, scan };
}
