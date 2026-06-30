import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Capturer 10% des transactions pour les perf traces (augmenter si besoin)
  tracesSampleRate: 0.1,

  // Désactiver les replays en prod pour économiser le quota
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,

  // Ne pas logger les erreurs en dev
  debug: false,

  // Ignorer les erreurs peu intéressantes
  ignoreErrors: [
    "ResizeObserver loop limit exceeded",
    "Network request failed",
    /^AbortError/,
  ],
});
