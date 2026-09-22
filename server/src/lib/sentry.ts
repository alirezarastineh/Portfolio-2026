type SentrySdk = typeof import("@sentry/node");

let sdk: SentrySdk | undefined;

/**
 * Error reporting to Sentry, off unless SENTRY_DSN is set. The SDK is only
 * imported then, so an unconfigured deploy pays nothing for it.
 *
 * Errors only: no tracing, and `skipOpenTelemetrySetup` keeps the SDK from
 * registering its OpenTelemetry auto-instrumentation — for a portfolio API
 * that is memory and per-request overhead with nothing to show for it.
 */
export async function initSentry(): Promise<void> {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || sdk) return;

  const Sentry = await import("@sentry/node");
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE || undefined,
    // No IPs, cookies or request bodies leave the server.
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
  });
  sdk = Sentry;
}

/** No-op while Sentry is not configured. */
export function captureError(error: unknown, tags: Record<string, string> = {}): void {
  sdk?.captureException(error, { tags });
}

/** Lets queued events leave before the process exits. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  await sdk?.flush(timeoutMs);
}
