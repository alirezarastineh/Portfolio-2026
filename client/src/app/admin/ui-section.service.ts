import { inject, Injectable } from "@angular/core";

import { AdminApiService } from "./admin-api.service";
import type { AppTranslations, Locale } from "../content/schema";

export type UiGroup = keyof AppTranslations;

export interface UiGroupLoad<K extends UiGroup> {
  value: Record<Locale, AppTranslations[K]>;
  updatedAt: string | null;
}

export type SaveOutcome =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: "stale" | "invalid" | "failed"; error: string };

/**
 * The `ui` translation tree is one jsonb document per locale, but it is edited
 * in slices (hero, about, contact, …). This loads the whole document, hands a
 * page just its group, and merges the group back on save so one editor can
 * never clobber another's fields.
 *
 * Provided by the admin route, alongside the `AdminApiService` it calls.
 */
@Injectable()
export class UiSectionService {
  private readonly api = inject(AdminApiService);

  async loadGroup<K extends UiGroup>(group: K): Promise<UiGroupLoad<K> | null> {
    const result = await this.api.getSection<AppTranslations>("ui");
    if (!result.ok) return null;

    return {
      value: {
        en: structuredClone(result.data.data.en[group]),
        de: structuredClone(result.data.data.de[group]),
      },
      updatedAt: result.data.updatedAt,
    };
  }

  async saveGroup<K extends UiGroup>(
    group: K,
    value: Record<Locale, AppTranslations[K]>,
    updatedAt: string | null,
  ): Promise<SaveOutcome> {
    // Re-read before merging: another section may have saved since this page
    // loaded, and only the version check should decide whether that is a
    // conflict — not a silently stale in-memory copy.
    const current = await this.api.getSection<AppTranslations>("ui");
    if (!current.ok) {
      return { ok: false, reason: "failed", error: current.error };
    }

    if (updatedAt && current.data.updatedAt && current.data.updatedAt !== updatedAt) {
      return { ok: false, reason: "stale", error: "stale" };
    }

    const merged = {
      en: { ...current.data.data.en, [group]: value.en },
      de: { ...current.data.data.de, [group]: value.de },
    };

    const saved = await this.api.putSection<AppTranslations>("ui", merged, current.data.updatedAt);

    if (!saved.ok) {
      if (saved.status === 409) return { ok: false, reason: "stale", error: "stale" };
      if (saved.status === 400) return { ok: false, reason: "invalid", error: saved.error };
      return { ok: false, reason: "failed", error: saved.error };
    }

    return { ok: true, updatedAt: saved.data.updatedAt };
  }
}
