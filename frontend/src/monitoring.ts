import * as Sentry from "@sentry/react";

const dsn = (import.meta.env.VITE_SENTRY_DSN_FRONTEND as string | undefined)?.trim();
const environment = (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined)?.trim() || "dev";
const release = (import.meta.env.VITE_SENTRY_RELEASE as string | undefined)?.trim() || undefined;
const tracesSampleRateRaw = Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 0);
const tracesSampleRate = Number.isFinite(tracesSampleRateRaw)
  ? Math.max(0, Math.min(1, tracesSampleRateRaw))
  : 0;

export const sentryEnabled = Boolean(dsn);

if (sentryEnabled && dsn) {
  Sentry.init({
    dsn,
    environment,
    release,
    tracesSampleRate,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.headers) {
        const headers = event.request.headers as Record<string, unknown>;
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (lower === "authorization" || lower === "cookie") {
            headers[key] = "[redacted]";
          }
        }
      }
      return event;
    },
    initialScope: {
      tags: {
        service: "frontend",
      },
    },
  });
}

export { Sentry };
