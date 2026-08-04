/**
 * Compression d'images CÔTÉ CLIENT (Canvas API native — zéro dépendance).
 * Objectif : photos Android/iPhone 3-8 Mo → JPEG ~150-400 Ko avant upload,
 * pour économiser la data 2G/3G Dakar et les tokens vision Anthropic.
 *
 * Bonus : toBlob("image/jpeg") CONVERTIT tout format que le navigateur sait
 * décoder — y compris HEIC sur iOS Safari — sans bibliothèque dédiée.
 * Si le navigateur ne sait pas décoder (HEIC sur Chrome Android, rare),
 * la promesse rejette et l'UI affiche un message clair.
 */

const MAX_DIMENSION = 1200; // px, grand côté
const JPEG_QUALITY = 0.85;

export async function compressImageToJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas non disponible");
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
    );
    if (!blob) throw new Error("compression impossible");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("format d'image non pris en charge par ce téléphone — réessaie en JPEG"));
    img.src = url;
  });
}
