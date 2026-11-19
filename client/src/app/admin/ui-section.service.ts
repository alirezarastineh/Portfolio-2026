import { inject, Injectable } from "@angular/core";

import { AdminApiService, type ApiIssue } from "./admin-api.service";
import { countChangedFields } from "./changed-fields";
import type { AppTranslations, Locale } from "../content/schema";

export type UiGroup = keyof AppTranslations;

export interface UiGroupLoad<K extends UiGroup> {
  value: Record<Locale, AppTranslations[K]>;
  updatedAt: string | null;
}

/** Each group's text as the editor holds it from its last load or save. */
export type OwnedGroups = Partial<Record<UiGroup, Record<Locale, unknown>>>;

export type SaveOutcome =
  | { ok: true; updatedAt: string }
  /**
   * `version` is the document's newest, when it could be read: a save that keeps its edits goes on
   * it. `changed` names the owned groups that moved there.
   */
  | { ok: false; reason: "stale"; error: string; version: string | null; changed: UiGroup[] }
  | { ok: false; reason: "failed"; error: string }
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
    if (!result.ok) {
      return null;
    }

    return {
      value: {
        en: structuredClone(result.data.data.en[group]),
        de: structuredClone(result.data.data.de[group]),
      },
      updatedAt: result.data.updatedAt,
    };
  }

  /** Several groups from one read, at one version (Words). */
  async loadGroups<K extends UiGroup>(
    groups: readonly K[],
  ): Promise<{ value: Record<Locale, Pick<AppTranslations, K>>; updatedAt: string | null } | null> {
    const result = await this.api.getSection<AppTranslations>("ui");
    if (!result.ok) {
      return null;
    }
    const pick = (doc: AppTranslations) =>
      Object.fromEntries(groups.map((g) => [g, structuredClone(doc[g])])) as Pick<
        AppTranslations,
        K
      >;
    return {
      value: { en: pick(result.data.data.en), de: pick(result.data.data.de) },
      updatedAt: result.data.updatedAt,
    };
  }

  saveGroup<K extends UiGroup>(
    group: K,
    value: Record<Locale, AppTranslations[K]>,
    updatedAt: string | null,
    owned: OwnedGroups,
  ): Promise<SaveOutcome> {
    return this.saveGroups({ [group]: value }, updatedAt, owned);
  }

  /**
   * The `ui` document as it stands now: its version, and which of these groups no longer read as
   * the editor holds them. Null when it could not be read.
   */
  async latest(
    owned: OwnedGroups,
  ): Promise<{ updatedAt: string | null; unchanged: boolean; changed: UiGroup[] } | null> {
    const fresh = await this.api.getSection<AppTranslations>("ui");
    if (!fresh.ok) {
      return null;
    }
    const { en, de } = fresh.data.data;
    const changed = (Object.keys(owned) as UiGroup[]).filter(
      (group) => countChangedFields(owned[group], { en: en[group], de: de[group] }) > 0,
    );
    return { updatedAt: fresh.data.updatedAt, unchanged: changed.length === 0, changed };
  }

  /**
   * The document has one version for all its groups, so a 409 can come from a
   * save to a group this editor does not own: then it goes again on the new
   * version. Issues come back as `[group, locale, field]` — the `groups.` prefix
   * of the request is taken off.
   */
  async saveGroups(
    groups: OwnedGroups,
    updatedAt: string | null,
    owned: OwnedGroups,
  ): Promise<SaveOutcome> {
    let saved = await this.api.patchUiGroups(groups, updatedAt);
    let version: string | null = null;
    let changed: UiGroup[] = [];
    if (!saved.ok && saved.status === 409) {
      const latest = await this.latest(owned);
      version = latest?.updatedAt ?? null;
      changed = latest?.changed ?? [];
      if (latest?.unchanged) {
        saved = await this.api.patchUiGroups(groups, latest.updatedAt);
      }
    }
    if (saved.ok) {
      return { ok: true, updatedAt: saved.data.updatedAt };
    }

    if (saved.status === 409) {
      return { ok: false, reason: "stale", error: "stale", version, changed };
    }
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
