import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  typescript: {
    tsconfigPath: "./tsconfig.json",
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
  hideSourceMaps: true,
  disableLogger: true,

  // Tunneling pour éviter les bloqueurs de publicités
  tunnelRoute: "/monitoring",

  automaticVercelMonitors: false,
});
