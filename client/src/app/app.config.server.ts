import { mergeApplicationConfig, ApplicationConfig } from "@angular/core";
import { provideServerRendering } from "@angular/platform-server";

import { appConfig } from "./app.config";
import { provideRequestCspNonce } from "./security/csp-nonce";

/**
 * The URL carries the language, and `/` is redirected by
 * `src/server/middleware/locale.ts` before rendering. The one request-specific
 * input is the CSP nonce from `src/server/middleware/csp.ts`.
 */
const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(), provideRequestCspNonce()],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
