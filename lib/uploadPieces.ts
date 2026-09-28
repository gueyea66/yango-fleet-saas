/**
 * Envoi des pièces jointes d'une déclaration ou d'une dépense.
 *
 * Existe parce que les deux formulaires chauffeur avalaient les échecs. Le code
 * était, des deux côtés :
 *
 *     const up = await fetch("/api/kyc-upload", …);
 *     const upRes = await up.json().catch(() => ({}));
 *     await supabase.from("uploads").insert({ …, file_path: upRes.path || path });
 *
 * Quand la route refusait le fichier — mauvais format, plus de 10 Mo, réseau
 * coupé — `upRes.path` était `undefined`, le repli `|| path` écrivait le chemin
 * que le client avait *souhaité*, et une ligne `uploads` pointait vers un
 * fichier qui n'existait nulle part. Le chauffeur voyait « envoyé », l'admin ne
 * voyait aucune pièce, et personne ne savait pourquoi. Constaté le 26/09 : la
 * dépense carburant de 11h39 est partie sans sa preuve, sans un message.
 *
 * Ici, une pièce n'est enregistrée que si le serveur confirme l'avoir stockée,
 * et ce qui a échoué est renvoyé à l'appelant avec sa raison pour être dit à
 * l'écran. Une pièce perdue en silence est pire qu'une pièce refusée : le
 * chauffeur a jeté son reçu.
 */
import { createClient } from "@/lib/supabase/client";

export interface EchecPiece {
  nom: string;
  raison: string;
}

export interface ResultatPieces {
  reussies: number;
  echecs: EchecPiece[];
}

export interface EnvoiPiecesParams {
  fichiers: File[];
  driverId: string;
  tenantId: string;
  /** "expense" | "report" — alimente `uploads.file_type`. */
  fileType: string;
  /** Identifiant de la dépense ou du rapport auquel rattacher les pièces. */
  refId: string;
}

/** Extension sûre, repli sur `bin` quand le nom n'en porte pas. */
function extensionDe(nom: string): string {
  const parts = nom.split(".");
  if (parts.length < 2) return "bin";
  const ext = parts.pop()!.toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

/**
 * Envoie les fichiers un par un. Un échec n'interrompt pas les suivants : sur
 * trois reçus dont un trop lourd, les deux autres doivent arriver.
 */
export async function envoyerPieces(p: EnvoiPiecesParams): Promise<ResultatPieces> {
  const supabase = createClient() as unknown as {
    from: (t: string) => { insert: (v: unknown) => Promise<{ error: { message: string } | null }> };
  };
  const echecs: EchecPiece[] = [];
  let reussies = 0;

  for (const file of p.fichiers) {
    const chemin = `${p.driverId}/${p.fileType}_${p.refId}_${Date.now()}.${extensionDe(file.name)}`;
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("path", chemin);
      const res = await fetch("/api/kyc-upload", { method: "POST", body: fd });
      const body = await res.json().catch(() => ({} as { path?: string; error?: string }));

      if (!res.ok || !body.path) {
        echecs.push({ nom: file.name, raison: body.error || `erreur ${res.status}` });
        continue;
      }

      // `body.path` et non `chemin` : la route réécrit le chemin pour forcer le
      // préfixe tenant (isolation, cf. sanitizePath). Enregistrer le chemin
      // demandé donnerait une ligne qui ne retrouve pas son fichier.
      const { error } = await supabase.from("uploads").insert({
        driver_id: p.driverId, tenant_id: p.tenantId,
        file_name: file.name, file_path: body.path,
        file_type: p.fileType, file_size: file.size, ref_id: p.refId,
      });
      if (error) { echecs.push({ nom: file.name, raison: error.message }); continue; }
      reussies += 1;
    } catch (err) {
      echecs.push({ nom: file.name, raison: err instanceof Error ? err.message : "réseau indisponible" });
    }
  }

  return { reussies, echecs };
}

/** Message prêt à afficher, ou `null` quand tout est passé. */
export function messageEchecs(r: ResultatPieces): string | null {
  if (r.echecs.length === 0) return null;
  const details = r.echecs.map((e) => `• ${e.nom} — ${e.raison}`).join("\n");
  return r.reussies > 0
    ? `${r.reussies} pièce(s) envoyée(s), ${r.echecs.length} refusée(s) :\n${details}\n\nRéessaie depuis l'historique, ou préviens ton gestionnaire.`
    : `Aucune pièce n'a pu être envoyée :\n${details}\n\nLa déclaration est enregistrée. Garde le reçu et réessaie.`;
}
