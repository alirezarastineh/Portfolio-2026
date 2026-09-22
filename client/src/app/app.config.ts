import { provideHttpClient, withInterceptors } from "@angular/common/http";
import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from "@angular/core";
import { provideClientHydration, withEventReplay } from "@angular/platform-browser";
import { provideFileRouter, requestContextInterceptor } from "@analogjs/router";

import { adminApiInterceptor } from "./admin/admin-api.interceptor";
import { ContentStore } from "./content/content.store";
import { ReportingErrorHandler } from "./monitoring/reporting-error-handler";
import { LanguageService } from "./services/language.service";

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: ReportingErrorHandler },
    provideFileRouter(),
    provideHttpClient(
      withInterceptors([requestContextInterceptor, adminApiInterceptor]),
    ),
    provideClientHydration(withEventReplay()),
    /**
     * Blocks the first render until the initial locale's content is available.
     *
     * On the server that is one in-process Nitro call; in the browser the same
     * relative URL is replayed from TransferState, so it resolves instantly and
     * without a second network request. Only the initial locale is awaited —
     * the other is fetched lazily on first toggle.
     */
    provideAppInitializer(() => {
      const store = inject(ContentStore);
      const language = inject(LanguageService);
      return store.load(language.lang());
    }),
  ],
};
