import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// En-têtes de sécurité HTTP (fix audit V9). Appliqués à toutes les routes.
// CSP volontairement permissive au départ (Next inline styles/scripts,
// Supabase, Sentry) — à resserrer progressivement une fois les origines
// exactes recensées. HSTS/anti-clickjacking/nosniff sont sans risque.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(), microphone=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "./tsconfig.json",
  },
  // Origines acceptées en développement. Sans cette liste, ouvrir l'app sur
  // une autre origine que celle annoncée par `next dev` (typiquement
  // http://127.0.0.1:3000 au lieu de http://localhost:3000, ou l'IP LAN depuis
  // un téléphone) fait renvoyer 403 sur les fichiers JavaScript : la page
  // s'affiche, mais React ne démarre jamais et le formulaire de connexion
  // devient inerte — il se soumet en HTML brut sans jamais appeler Supabase.
  // Constaté le 16/09/2026, une demi-heure perdue à chercher côté mots de passe.
  // Sans effet en production.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default withSentryConfig(nextConfig, {
  // Organisation Sentry et projet (à configurer dans Sentry dashboard)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Désactiver l'upload de sourcemaps en dev local
  silent: !process.env.CI,

  // Réduire la taille du bundle en production
  widenClientFileUpload: true,
  sourcemaps: { disable: true },
  disableLogger: true,

  // Tunneling pour éviter les bloqueurs de publicités
  tunnelRoute: "/monitoring",

  automaticVercelMonitors: false,
});
