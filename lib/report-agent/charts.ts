/**
 * report-agent — graphiques SVG intégrés au rapport (aucun script, imprimables).
 * RÈGLE : aucun import hors de lib/report-agent/ (voir README.md).
 *
 * Conventions (une seule échelle par graphique, jamais deux axes) :
 *  - barres fines (≤ 24 px), extrémité arrondie côté valeur, base carrée ;
 *  - grille et axes en filets gris discrets, texte en encre (jamais la couleur de la série) ;
 *  - étiquettes sélectives ; une légende dès qu'il y a deux séries ;
 *  - chaque marque porte un <title> : la valeur exacte au survol, le tableau du
 *    rapport restant la référence à l'impression.
 * Palette : bleu et or validés ensemble (écart daltonien, contraste sur fond blanc) ;
 * une seule teinte, du clair au foncé, pour une intensité (carte de chaleur).
 */

export const CHART_COLORS = { a: "#2563A8", b: "#B8860B", grid: "#E5E7EB", axis: "#9CA3AF", ink: "#1F2937", ink2: "#4B5563", ink3: "#6B7280" };
const FONT = "Inter,'Segoe UI',Helvetica,sans-serif";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Graduation « ronde » couvrant max : pas dans {1, 2, 2,5, 5} × 10^n. */
function ticks(max: number, n = 4): { top: number; values: number[] } {
  if (!(max > 0)) return { top: 1, values: [0, 1] };
  const raw = max / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  return { top, values: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step) };
}

/** Rectangle à extrémité arrondie (4 px) côté valeur, carré à la base. */
function bar(x: number, y: number, w: number, h: number, fill: string, title: string, horizontal = false): string {
  if (h <= 0 || w <= 0) return "";
  const r = Math.min(4, horizontal ? w : h, (horizontal ? h : w) / 2);
  const d = horizontal
    ? `M${r1(x)},${r1(y)} h${r1(w - r)} a${r},${r} 0 0 1 ${r},${r} v${r1(h - 2 * r)} a${r},${r} 0 0 1 -${r},${r} h-${r1(w - r)} z`
    : `M${r1(x)},${r1(y + h)} v-${r1(h - r)} a${r},${r} 0 0 1 ${r},-${r} h${r1(w - 2 * r)} a${r},${r} 0 0 1 ${r},${r} v${r1(h - r)} z`;
  return `<path d="${d}" fill="${fill}"><title>${esc(title)}</title></path>`;
}

const svgOpen = (w: number, h: number, label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="${esc(label)}" style="display:block;max-width:${w}px;font-family:${FONT}">`;

export interface ColumnSeries { name: string; values: number[]; color?: string }

/**
 * Colonnes groupées sur une seule échelle. `highlight` : indice de la catégorie
 * mise en avant (étiquettes de valeur sur celle-ci seulement). `target` : repère horizontal.
 */
export function columnsChart(o: {
  label: string; categories: string[]; series: ColumnSeries[]; fmt: (v: number) => string;
  highlight?: number; target?: { value: number; label: string }; height?: number; labelEvery?: number;
}): string {
  const W = 720, H = o.height ?? 230, L = 58, R = 16, T = o.series.length > 1 ? 30 : 16, B = 30;
  const pw = W - L - R, ph = H - T - B;
  const all = o.series.flatMap((s) => s.values).concat(o.target ? [o.target.value] : []);
  const { top, values } = ticks(Math.max(...all, 0));
  const y = (v: number) => T + ph - (Math.max(0, v) / top) * ph;
  const n = o.categories.length, band = pw / Math.max(n, 1);
  const k = o.series.length;
  const bw = Math.min(24, Math.max(3, (band - 6 - (k - 1) * 2) / k));
  const colors = [CHART_COLORS.a, CHART_COLORS.b];
  const every = o.labelEvery ?? 1;

  let out = svgOpen(W, H, o.label);
  for (const v of values) {
    out += `<line x1="${L}" x2="${W - R}" y1="${r1(y(v))}" y2="${r1(y(v))}" stroke="${CHART_COLORS.grid}" stroke-width="1"/>`;
    out += `<text x="${L - 6}" y="${r1(y(v) + 3.5)}" text-anchor="end" font-size="10" fill="${CHART_COLORS.ink3}">${esc(o.fmt(v))}</text>`;
  }
  o.categories.forEach((c, i) => {
    const gx = L + i * band + (band - (k * bw + (k - 1) * 2)) / 2;
    o.series.forEach((s, j) => {
      const v = s.values[i] ?? 0;
      const x = gx + j * (bw + 2);
      out += bar(x, y(v), bw, T + ph - y(v), s.color ?? colors[j % 2], `${c} · ${s.name} : ${o.fmt(v)}`);
      if (o.highlight === i && v > 0) {
        out += `<text x="${r1(x + bw / 2)}" y="${r1(y(v) - 4)}" text-anchor="${k > 1 ? (j === 0 ? "end" : "start") : "middle"}" font-size="10" font-weight="700" fill="${CHART_COLORS.ink}">${esc(o.fmt(v))}</text>`;
      }
    });
    if (i % every === 0 || i === n - 1) {
      out += `<text x="${r1(L + i * band + band / 2)}" y="${H - B + 14}" text-anchor="middle" font-size="10" font-weight="${o.highlight === i ? 700 : 400}" fill="${o.highlight === i ? CHART_COLORS.ink : CHART_COLORS.ink3}">${esc(c)}</text>`;
    }
  });
  out += `<line x1="${L}" x2="${W - R}" y1="${T + ph}" y2="${T + ph}" stroke="${CHART_COLORS.axis}" stroke-width="1"/>`;
  if (o.target && o.target.value > 0) {
    const ty = r1(y(o.target.value));
    out += `<line x1="${L}" x2="${W - R}" y1="${ty}" y2="${ty}" stroke="${CHART_COLORS.ink}" stroke-width="1.5"/>`;
    out += `<text x="${W - R}" y="${ty - 4}" text-anchor="end" font-size="10" font-weight="700" fill="${CHART_COLORS.ink}">${esc(o.target.label)}</text>`;
  }
  if (k > 1) {
    let lx = L;
    o.series.forEach((s, j) => {
      out += `<rect x="${lx}" y="6" width="10" height="10" rx="2" fill="${s.color ?? colors[j % 2]}"/>`;
      out += `<text x="${lx + 14}" y="15" font-size="10.5" fill="${CHART_COLORS.ink2}">${esc(s.name)}</text>`;
      lx += 26 + s.name.length * 6;
    });
  }
  return out + "</svg>";
}

/** Barres horizontales face à une cible commune (une barre par ligne, valeur écrite en clair). */
export function targetBars(o: {
  label: string; rows: { label: string; value: number; note?: string }[];
  target: number; targetLabel: string; fmt: (v: number) => string;
}): string {
  const W = 720, rowH = 26, L = 190, R = 150, T = 26, B = 8;
  const H = T + o.rows.length * rowH + B;
  const pw = W - L - R;
  const max = Math.max(o.target, ...o.rows.map((r) => r.value)) * 1.05 || 1;
  const x = (v: number) => L + (Math.max(0, v) / max) * pw;
  let out = svgOpen(W, H, o.label);
  o.rows.forEach((r, i) => {
    const cy = T + i * rowH;
    out += `<text x="${L - 8}" y="${cy + 15}" text-anchor="end" font-size="10.5" fill="${CHART_COLORS.ink}">${esc(r.label.length > 30 ? `${r.label.slice(0, 29)}…` : r.label)}</text>`;
    out += `<rect x="${L}" y="${cy + 4}" width="${pw}" height="16" fill="#F3F4F6"/>`;
    out += bar(L, cy + 4, x(r.value) - L, 16, CHART_COLORS.a, `${r.label} : ${o.fmt(r.value)}`, true);
    out += `<text x="${L + pw + 8}" y="${cy + 15}" font-size="10.5" fill="${CHART_COLORS.ink}"><tspan font-weight="700">${esc(o.fmt(r.value))}</tspan>${r.note ? `<tspan fill="${CHART_COLORS.ink3}"> · ${esc(r.note)}</tspan>` : ""}</text>`;
  });
  const tx = r1(x(o.target));
  out += `<line x1="${tx}" x2="${tx}" y1="${T - 4}" y2="${H - B}" stroke="${CHART_COLORS.ink}" stroke-width="1.5"/>`;
  out += `<text x="${tx}" y="${T - 9}" text-anchor="middle" font-size="10" font-weight="700" fill="${CHART_COLORS.ink}">${esc(o.targetLabel)}</text>`;
  return out + "</svg>";
}

/**
 * Carte de chaleur lignes × colonnes : une seule teinte, du clair (faible) au foncé (fort).
 * Chaque case porte sa valeur ; le texte passe en blanc sur les cases foncées.
 */
export function heatmap(o: {
  label: string; rows: string[]; cols: string[]; values: number[][];
  fmt: (v: number) => string; legend: string;
}): string {
  const W = 720, L = 86, T = 26, cellH = 30, R = 8, B = 30;
  const cw = (W - L - R) / o.cols.length;
  const H = T + o.rows.length * cellH + B;
  const max = Math.max(...o.values.flat(), 1);
  // rampe d'une seule teinte (bleu), claire → foncée
  const ramp = (t: number) => {
    const a = [239, 246, 255], b = [30, 64, 120];
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.pow(t, 0.85)));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  let out = svgOpen(W, H, o.label);
  o.cols.forEach((c, j) => {
    out += `<text x="${r1(L + j * cw + cw / 2)}" y="${T - 8}" text-anchor="middle" font-size="10" fill="${CHART_COLORS.ink3}">${esc(c)}</text>`;
  });
  o.rows.forEach((row, i) => {
    out += `<text x="${L - 8}" y="${T + i * cellH + 19}" text-anchor="end" font-size="10.5" fill="${CHART_COLORS.ink}">${esc(row)}</text>`;
    o.cols.forEach((c, j) => {
      const v = o.values[i]?.[j] ?? 0, t = v / max;
      // 2 px de fond entre les cases
      out += `<rect x="${r1(L + j * cw + 1)}" y="${T + i * cellH + 1}" width="${r1(cw - 2)}" height="${cellH - 2}" rx="3" fill="${v > 0 ? ramp(t) : "#F9FAFB"}"><title>${esc(`${row} · ${c} : ${o.fmt(v)}`)}</title></rect>`;
      if (v > 0) out += `<text x="${r1(L + j * cw + cw / 2)}" y="${T + i * cellH + 19}" text-anchor="middle" font-size="9.5" font-weight="${t > 0.75 ? 700 : 400}" fill="${t > 0.55 ? "#FFFFFF" : CHART_COLORS.ink}">${esc(o.fmt(v))}</text>`;
    });
  });
  // légende : faible → fort
  const ly = H - 14, lw = 120;
  out += `<text x="${L}" y="${ly + 9}" font-size="9.5" fill="${CHART_COLORS.ink3}">${esc(o.legend)} : faible</text>`;
  const lx = L + 8 + (o.legend.length + 9) * 5.2;
  for (let s = 0; s < 6; s++) out += `<rect x="${r1(lx + s * (lw / 6))}" y="${ly}" width="${r1(lw / 6 - 1)}" height="10" fill="${ramp(s / 5)}"/>`;
  out += `<text x="${r1(lx + lw + 6)}" y="${ly + 9}" font-size="9.5" fill="${CHART_COLORS.ink3}">fort</text>`;
  return out + "</svg>";
}
