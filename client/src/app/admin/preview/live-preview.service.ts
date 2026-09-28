import {
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
  type WritableSignal,
} from "@angular/core";

import { AdminApiService, type ApiIssue } from "../admin-api.service";
import type { AppContent, Locale } from "../../content/schema";

export type PreviewDevice = "desktop" | "phone";

/** The saved draft for one language, as the preview composes the unsaved edits over it. */
export type DraftBase =
  | { state: "loading" }
  | { state: "ready"; content: AppContent }
  | { state: "failed"; error: string; issues: ApiIssue[] };

const KEYS = {
  open: "admin.preview.open",
  size: "admin.preview.size",
  device: "admin.preview.device",
};
/** The preview's share of the width, in percent: its default and its limits. */
export const PREVIEW_SIZE = { default: 45, min: 25, max: 70 } as const;
/** Side by side needs room: from Tailwind's `lg`. */
const WIDE = "(min-width: 1024px)";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage may be blocked: the choice then lasts for this visit.
  }
}

export function clampSize(value: number): number {
  if (!Number.isFinite(value)) return PREVIEW_SIZE.default;
  return Math.min(PREVIEW_SIZE.max, Math.max(PREVIEW_SIZE.min, value));
}

/**
 * The live preview beside an editor: whether it is open, how wide, desktop or
 * phone (remembered in this browser, so it stays as it was from one editor to
 * the next), and the saved draft per language that the editors' unsaved
 * edits are drawn over.
 *
 * The draft is fetched once per language and again after a write, since a
 * save elsewhere (or this editor's own) changes it.
 *
 * Provided by the admin route, alongside the `AdminApiService` it calls.
 */
@Injectable()
export class LivePreviewService {
  private readonly api = inject(AdminApiService);

  readonly open = signal(read(KEYS.open) === "1");
  readonly size = signal(clampSize(Number(read(KEYS.size) ?? PREVIEW_SIZE.default)));
  readonly device = signal<PreviewDevice>(read(KEYS.device) === "phone" ? "phone" : "desktop");
  /** Wide enough for the editor and the preview side by side. */
  readonly wide = signal(globalThis.matchMedia?.(WIDE).matches ?? false);

  private readonly bases: Record<Locale, WritableSignal<DraftBase | null>> = {
    en: signal<DraftBase | null>(null),
    de: signal<DraftBase | null>(null),
  };
  private readonly inFlight = new Map<Locale, Promise<void>>();

  constructor() {
    effect(() => write(KEYS.open, this.open() ? "1" : "0"));
    effect(() => write(KEYS.size, String(Math.round(this.size()))));
    effect(() => write(KEYS.device, this.device()));

    const query = globalThis.matchMedia?.(WIDE);
    if (query) {
      const follow = (event: MediaQueryListEvent) => this.wide.set(event.matches);
      query.addEventListener("change", follow);
      inject(DestroyRef).onDestroy(() => query.removeEventListener("change", follow));
    }

    // A write changed the draft: what is loaded is stale. Reloaded when next shown.
    effect(() => {
      if (this.api.writes() === 0) return;
      untracked(() => {
        for (const locale of ["en", "de"] as const) {
          if (this.bases[locale]() !== null) void this.load(locale, true);
        }
      });
    });
  }

  /** The draft for `locale` as loaded so far (reactive); `loading` before `ensure`. */
  base(locale: Locale): DraftBase {
    return this.bases[locale]() ?? { state: "loading" };
  }

  /** Loads the draft for `locale` unless it already is (or is on its way). */
  ensure(locale: Locale): void {
    if (this.bases[locale]() === null) void this.load(locale);
  }

  /**
   * Fetches the draft. A reload keeps showing what was loaded until the new one
   * arrives, so the preview does not blink on every save.
   */
  load(locale: Locale, again = false): Promise<void> {
    const pending = this.inFlight.get(locale);
    if (pending !== undefined) return pending;
    if (!again || this.bases[locale]() === null) this.bases[locale].set({ state: "loading" });
    const request = this.api
      .preview(locale)
      .then((result) => {
        this.bases[locale].set(
          result.ok
            ? { state: "ready", content: result.data }
            : { state: "failed", error: result.error, issues: result.issues ?? [] },
        );
      })
      .finally(() => this.inFlight.delete(locale));
    this.inFlight.set(locale, request);
    return request;
  }
}
