import { isPlatformBrowser } from "@angular/common";
import { ErrorHandler, inject, Injectable, InjectionToken, PLATFORM_ID } from "@angular/core";

type BrowserSdk = typeof import("@sentry/browser");

/**
 * Public Sentry DSN; reporting is off when empty. A token rather than a direct
 * `import.meta.env` read because Vite inlines those at build time.
 */
export const SENTRY_DSN = new InjectionToken<string | undefined>("SENTRY_DSN", {
  providedIn: "root",
  factory: () => import.meta.env.VITE_SENTRY_DSN,
});

/** Resolved once, on the first error that is actually reported. */
let sdk: Promise<BrowserSdk> | undefined;

function loadSdk(dsn: string): Promise<BrowserSdk> {
  sdk ??= import("@sentry/browser").then((Sentry) => {
    Sentry.init({
      dsn,
      release: import.meta.env.VITE_GIT_SHA || undefined,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      integrations: (defaults) =>
        defaults.filter(
          (integration) =>
            // Angular already forwards window errors and unhandled rejections
            // here (provideBrowserGlobalErrorListeners); Sentry's own handlers
            // would report each of them twice.
            integration.name !== "GlobalHandlers" &&
            // Release-health session pings: a request on every page load for a
            // metric this site does not need.
            integration.name !== "BrowserSession",
        ),
    });
    return Sentry;
  });
  return sdk;
}

/**
 * Logs like Angular's default handler and, when a Sentry DSN is configured,
 * reports the error. The SDK is a separate chunk imported only once an error
 * happens, so visitors whose session never errors never download it.
 */
@Injectable()
export class ReportingErrorHandler implements ErrorHandler {
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly dsn = inject(SENTRY_DSN);

  handleError(error: unknown): void {
    console.error(error);

    const dsn = this.dsn;
    if (!this.isBrowser || !dsn) return;

    void loadSdk(dsn)
      .then((Sentry) => Sentry.captureException(error))
      // Reporting must never become a second error of its own.
      .catch(() => {});
  }
}
