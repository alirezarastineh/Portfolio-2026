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
      localStorage.setItem("portfolio-lang", next);
      document.documentElement.setAttribute("lang", next);
    }
  }

  private getInitial(): "en" | "de" {
    if (!isPlatformBrowser(this.platform)) return "en";
    const stored = localStorage.getItem("portfolio-lang");
    if (stored === "en" || stored === "de") return stored;
    return navigator.language.startsWith("de") ? "de" : "en";
  }
}
