import { CSP_NONCE, DOCUMENT, inject, type Provider } from "@angular/core";
import { BEFORE_APP_SERIALIZED } from "@angular/platform-server";
import { injectRequest } from "@analogjs/router/tokens";

import { readRequestNonce } from "./request-nonce";

/**
 * The inline script Analog's build injects into index.html for event replay
 * (`@angular/core/event-dispatch-contract.min.js`). Angular nonces the replay
 * call it adds next to it, but not this one.
 */
export const EVENT_DISPATCH_SCRIPT_ID = "ng-event-dispatch-contract";

/**
 * Stamps the per-request nonce on the one inline script Angular does not
 * nonce itself. Only that script, by id: stamping every inline script would
 * also bless any script that ever slipped into the rendered markup.
 */
export function stampEventDispatchScript(doc: Document, nonce: string | null): void {
  if (!nonce) return;
  doc.getElementById(EVENT_DISPATCH_SCRIPT_ID)?.setAttribute("nonce", nonce);
}

/**
 * Server-only. Hands Nitro's per-request nonce to Angular, which stamps it on
 * the scripts it adds while rendering (the event-replay call), and stamps
 * Analog's inline event-dispatch script just before the HTML is serialized.
 * Without a nonce (dev, `CSP_MODE=off`) both are no-ops.
 */
export function provideRequestCspNonce(): Provider[] {
  return [
    { provide: CSP_NONCE, useFactory: () => readRequestNonce(injectRequest()) },
    {
      provide: BEFORE_APP_SERIALIZED,
      multi: true,
      useFactory: () => {
        const doc = inject(DOCUMENT);
        const nonce = inject(CSP_NONCE);
        return () => stampEventDispatchScript(doc, nonce);
      },
    },
  ];
}
