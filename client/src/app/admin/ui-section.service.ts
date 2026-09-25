import { inject, Injectable } from "@angular/core";

import { AdminApiService, type ApiIssue } from "./admin-api.service";
import type { AppTranslations, Locale } from "../content/schema";

export type UiGroup = keyof AppTranslations;

export interface UiGroupLoad<K extends UiGroup> {
  value: Record<Locale, AppTranslations[K]>;
  updatedAt: string | null;
}

export type SaveOutcome =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: "stale" | "failed"; error: string }
  | { ok: false; reason: "invalid"; error: string; issues: ApiIssue[] };

/**
 * The `ui` translation tree is one jsonb document per locale, but it is edited
 * in slices (hero, about, contact, …). This loads the whole document and hands
 * a page just its group; on save, only that group is sent and the server
 * merges it in, under a lock — so one editor can never clobber another's
 * fields, however old its copy of the rest.
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

  saveGroup<K extends UiGroup>(
    group: K,
    value: Record<Locale, AppTranslations[K]>,
    updatedAt: string | null,
  ): Promise<SaveOutcome> {
    return this.saveGroups({ [group]: value }, updatedAt);
  }

  /**
   * Issues come back as `[group, locale, field]` — the `groups.` prefix of the
   * request is taken off.
   */
  async saveGroups(
    groups: Partial<Record<UiGroup, Record<Locale, unknown>>>,
    updatedAt: string | null,
  ): Promise<SaveOutcome> {
    const saved = await this.api.patchUiGroups(groups, updatedAt);
    if (saved.ok) return { ok: true, updatedAt: saved.data.updatedAt };

    if (saved.status === 409) return { ok: false, reason: "stale", error: "stale" };
    if (saved.status === 400) {
      return {
        ok: false,
        reason: "invalid",
        error: saved.error,
        issues: (saved.issues ?? []).map((issue) => ({
          ...issue,
          path: issue.path[0] === "groups" ? issue.path.slice(1) : issue.path,
        })),
      };
    }
    return { ok: false, reason: "failed", error: saved.error };
  }
}
