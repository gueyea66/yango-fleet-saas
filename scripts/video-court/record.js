/**
 * Teaser 50 s (retour Abdou 02/09 : version courte, sans démo détaillée,
 * orientée prise de contact). Enregistre l'animation HTML en 1920×1080 puis
 * convertit en MP4 H.264 (ffmpeg-static) → public/landing/video/m3a-fleet-demo.mp4
 * Usage : node scripts/video-court/record.js
 */
const { chromium } = require("playwright");
const { execFileSync } = require("child_process");
const ffmpeg = require("ffmpeg-static");
const path = require("path");
const fs = require("fs");

const HERE = __dirname;
const RAW = path.join(HERE, "raw");
const OUT = path.join(HERE, "..", "..", "public", "landing", "video", "m3a-fleet-demo.mp4");
const DURATION_MS = 51_500;

(async () => {
  fs.rmSync(RAW, { recursive: true, force: true });
  fs.mkdirSync(RAW, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    recordVideo: { dir: RAW, size: { width: 1920, height: 1080 } },
  });
  const page = await ctx.newPage();
  await page.goto("file://" + path.join(HERE, "index.html").replace(/\\/g, "/"));
  await page.waitForTimeout(DURATION_MS);
  await ctx.close();
  await browser.close();

  const webm = fs.readdirSync(RAW).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("webm introuvable");
  console.log("▶ conversion mp4…");
  execFileSync(ffmpeg, [
    "-y", "-i", path.join(RAW, webm),
    "-ss", "0.4", // coupe le blanc initial du chargement
    "-c:v", "libx264", "-preset", "slow", "-crf", "23",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    OUT,
  ], { stdio: "inherit" });
  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(1);
  console.log(`✔ ${OUT} (${mb} Mo)`);
})();
