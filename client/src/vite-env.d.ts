/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEV_API_URL?: string;
  readonly VITE_GIT_SHA?: string;
  /** Public Sentry DSN; error reporting is off when unset. */
  readonly VITE_SENTRY_DSN?: string;
  /** Umami tracker script URL and website id; analytics are off unless both are set. */
  readonly VITE_UMAMI_SRC?: string;
  readonly VITE_UMAMI_WEBSITE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
