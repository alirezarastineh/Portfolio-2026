import { defineEventHandler, setResponseHeader } from "h3";

import { writeRequestNonce } from "../../app/security/request-nonce";
import {
  buildCsp,
  cspConfigFromEnv,
  cspHeaderName,
  isPagePath,
  newNonce,
  REPORT_GROUP,
  type CspConfig,
} from "../utils/csp";

let config: CspConfig | undefined;

/**
 * Issues a fresh nonce for every page request and sends the policy that
 * allows it. The nonce rides on the Node request to Angular
 * (`provideRequestCspNonce` in app.config.server.ts), which stamps it on the
 * inline event-replay scripts.
 *
 * `CSP_MODE`: `enforce` (default), `report-only` (the rollout week) or `off`.
 * Skipped under `vite dev`, whose HMR client injects inline scripts. Strictly
 * `true`: in the Nitro build `import.meta.env` is `process.env`, where a stray
 * `DEV=1` string must not switch the policy off.
 */
export default defineEventHandler((event) => {
  if (import.meta.env?.DEV === true) return;

  config ??= cspConfigFromEnv(process.env);
  if (config.mode === "off" || !isPagePath(event.path)) return;

  const nonce = newNonce();
  writeRequestNonce(event.node.req, nonce);
  setResponseHeader(event, cspHeaderName(config.mode), buildCsp(nonce, config));
  if (config.sentry) {
    setResponseHeader(event, "Reporting-Endpoints", `${REPORT_GROUP}="${config.sentry.reportUri}"`);
  }
});
