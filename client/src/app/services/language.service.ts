import { isPlatformBrowser } from "@angular/common";
import { computed, inject, Injectable, PLATFORM_ID, signal } from "@angular/core";

import { de, en, type AppTranslations } from "../i18n";

@Injectable({ providedIn: "root" })
export class LanguageService {
  private readonly platform = inject(PLATFORM_ID);
  private readonly _lang = signal<"en" | "de">(this.getInitial());

  readonly lang = this._lang.asReadonly();
  readonly t = computed<AppTranslations>(() => (this._lang() === "en" ? en : de));

  toggle(): void {
    const next = this._lang() === "en" ? "de" : "en";
    this._lang.set(next);
    if (isPlatformBrowser(this.platform)) {
      try {
        if (typeof localStorage !== "undefined" && localStorage) {
          localStorage.setItem("portfolio-lang", next);
        }
      } catch {
        // Ignore storage errors
      }
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("lang", next);
      }
    }
  }

  private getInitial(): "en" | "de" {
    if (!isPlatformBrowser(this.platform)) return "en";
    try {
      const stored =
        typeof localStorage !== "undefined" && localStorage
          ? localStorage.getItem("portfolio-lang")
          : null;
      if (stored === "en" || stored === "de") return stored;
    } catch {
      // Ignore storage errors
    }
    if (typeof navigator !== "undefined" && navigator?.language?.startsWith("de")) {
      return "de";
    }
    return "en";
  }
}

