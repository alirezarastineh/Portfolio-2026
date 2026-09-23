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
 * index.html's pre-paint script: applies the saved or system colour theme
 * before the first paint, so the page never flashes the other one.
 */
export const THEME_SCRIPT_ID = "theme-init";

/** The inline scripts Angular does not nonce itself, by id. */
export const KNOWN_INLINE_SCRIPT_IDS = [EVENT_DISPATCH_SCRIPT_ID, THEME_SCRIPT_ID] as const;

/**
 * Stamps the per-request nonce on the known inline scripts Angular does not
 * nonce itself. Only those, by id: stamping every inline script would also
 * bless any script that ever slipped into the rendered markup.
 */
export function stampKnownScripts(doc: Document, nonce: string | null): void {
  if (!nonce) return;
  for (const id of KNOWN_INLINE_SCRIPT_IDS) {
    const script = doc.getElementById(id);
    if (script?.tagName.toLowerCase() === "script") script.setAttribute("nonce", nonce);
  }
}

/**
 * Server-only. Hands Nitro's per-request nonce to Angular, which stamps it on
 * the scripts it adds while rendering (the event-replay call), and stamps the
 * known inline scripts just before the HTML is serialized. Without a nonce
 * (dev, `CSP_MODE=off`) both are no-ops.
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
        return () => stampKnownScripts(doc, nonce);
      },
    },
  ];
}
