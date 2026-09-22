import { isPlatformBrowser } from "@angular/common";
import { computed, inject, Injectable, PLATFORM_ID, signal } from "@angular/core";
import type { CanDeactivateFn } from "@angular/router";

import { ConfirmService } from "./components/confirm-dialog.component";

/**
 * Tracks which editors hold unsaved work.
 *
 * Global rather than per-component so the route guard can answer without a
 * reference to the component being left, and so the sidebar can show a dot per
 * section.
 */
@Injectable({ providedIn: "root" })
export class UnsavedChangesService {
  private readonly platform = inject(PLATFORM_ID);
  private readonly dirty = signal<ReadonlySet<string>>(new Set());
  private listening = false;

  readonly hasAny = computed(() => this.dirty().size > 0);

  isDirty(id: string): boolean {
    return this.dirty().has(id);
  }

  /** Editors call this whenever their form's dirty state changes. */
  set(id: string, isDirty: boolean): void {
    this.dirty.update((current) => {
      if (current.has(id) === isDirty) return current;
      const next = new Set(current);
      if (isDirty) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
    this.syncBeforeUnload();
  }

  clear(id: string): void {
    this.set(id, false);
  }

  clearAll(): void {
    this.dirty.set(new Set());
    this.syncBeforeUnload();
  }

  /**
   * The in-app guard cannot stop a tab close or a reload, so the browser's own
   * prompt covers that case. Registered only while something is dirty — an
   * always-on handler disables the back/forward cache.
   */
  private syncBeforeUnload(): void {
    if (!isPlatformBrowser(this.platform)) return;

    const shouldListen = this.dirty().size > 0;
    if (shouldListen === this.listening) return;

    if (shouldListen) {
      globalThis.addEventListener("beforeunload", beforeUnloadHandler);
    } else {
      globalThis.removeEventListener("beforeunload", beforeUnloadHandler);
    }
    this.listening = shouldListen;
  }
}

function beforeUnloadHandler(event: BeforeUnloadEvent): void {
  // Calling preventDefault() per the WHATWG HTML standard triggers the browser's
  // confirmation prompt to prevent accidental data loss.
  event.preventDefault();
}

/**
 * Attached to every editor route's `canDeactivate`. Checks the service rather
 * than the component, so one guard covers editors with very different shapes.
 */
export const unsavedChangesGuard: CanDeactivateFn<unknown> = async () => {
  const unsaved = inject(UnsavedChangesService);
  if (!unsaved.hasAny()) return true;

  const leave = await inject(ConfirmService).ask({
    title: "Discard unsaved changes?",
    description:
      "This section has edits that have not been saved to the draft. Leaving now loses them.",
    confirmLabel: "Discard and leave",
    cancelLabel: "Stay",
    destructive: true,
  });

  if (leave) unsaved.clearAll();
  return leave;
};
