// Telemetry bootstrap — Sentry (errors) + PostHog (product analytics).
// Both are gated on env vars so dev/local runs stay silent.

const SENTRY_DSN  = import.meta.env.VITE_SENTRY_DSN  || "";
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY || "";
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
const ENV = import.meta.env.MODE || "production";

let sentry = null;
let posthog = null;

export async function initTelemetry() {
  if (typeof window === "undefined") return;

  if (SENTRY_DSN) {
    try {
      const Sentry = await import("@sentry/react");
      Sentry.init({
        dsn: SENTRY_DSN,
        environment: ENV,
        tracesSampleRate: 0.1,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0.1,
        ignoreErrors: [
          "ResizeObserver loop limit exceeded",
          "Non-Error promise rejection captured",
          "NetworkError",
          "Load failed",
        ],
      });
      sentry = Sentry;
    } catch (e) { console.warn("[telemetry] sentry init failed", e); }
  }

  if (POSTHOG_KEY) {
    try {
      const mod = await import("posthog-js");
      const ph = mod.default || mod;
      ph.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        person_profiles: "identified_only",
        capture_pageview: true,
        autocapture: false,
      });
      posthog = ph;
    } catch (e) { console.warn("[telemetry] posthog init failed", e); }
  }
}

export function captureError(err, ctx) {
  try { sentry?.captureException(err, ctx ? { extra: ctx } : undefined); } catch {}
}

export function captureEvent(name, props) {
  try { posthog?.capture(name, props); } catch {}
}

export function identify(id, traits) {
  try { posthog?.identify(id, traits); } catch {}
}

export function getSentry() { return sentry; }
