import { isPlatformBrowser } from "@angular/common";
import { computed, inject, Injectable, PLATFORM_ID, signal } from "@angular/core";
import type { CanDeactivateFn } from "@angular/router";

import { AdminSessionService } from "./admin-session.service";
import { ConfirmService } from "./components/confirm-dialog.component";
import { RecoveryService } from "./recovery.service";

/** What an editor's header lends the review: its title, its unsaved count and its own Save. */
export interface EditorHandle {
  title: () => string;
  changes: () => number;
  saving: () => boolean;
  save: () => void;
}

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
  private readonly recovery = inject(RecoveryService);
  private readonly dirty = signal<ReadonlySet<string>>(new Set());
  private listening = false;

  readonly hasAny = computed(() => this.dirty().size > 0);
  /** The open editor's header (plan 5, U16): the review names its unsaved edits and runs its Save. */
  readonly editor = signal<EditorHandle | null>(null);

  isDirty(id: string): boolean {
    return this.dirty().has(id);
  }

  /** Editors call this whenever their form's dirty state changes. */
  set(id: string, isDirty: boolean): void {
    this.dirty.update((current) => {
      if (current.has(id) === isDirty) {
        return current;
      }
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

  /** The edits on the page were thrown away on purpose. */
  clearAll(): void {
    this.dirty.set(new Set());
    this.recovery.dropLive();
    this.syncBeforeUnload();
  }

  /**
   * The in-app guard cannot stop a tab close or a reload, so the browser's own
   * prompt covers that case. Registered only while something is dirty — an
   * always-on handler disables the back/forward cache.
   */
  private syncBeforeUnload(): void {
    if (!isPlatformBrowser(this.platform)) {
      return;
    }

    const shouldListen = this.dirty().size > 0;
    if (shouldListen === this.listening) {
      return;
    }

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
export const unsavedChangesGuard: CanDeactivateFn<unknown> = async (_page, _route, from, to) => {
  const unsaved = inject(UnsavedChangesService);
  // Under the sign-in dialog the page cannot be left: no second question over it.
  if (inject(AdminSessionService, { optional: true })?.lost()) {
    return false;
  }
  if (!unsaved.hasAny()) {
    return true;
  }
  // Its query or fragment changing keeps the page and its edits (Words' filters, Find's row); the
  // router asks this guard then too. An entry edited in place (`?edit=<id>`, Experience) is a place,
  // and so is a file's panel (`?file=<id>`, Media), once open: opening one leaves nothing behind.
  if (to?.url && from?.url && samePlace(from.url, to.url)) {
    return true;
  }

  const leave = await inject(ConfirmService).ask({
    title: "Discard unsaved changes?",
    description:
      "This section has edits that have not been saved to the draft. Leaving now loses them.",
    confirmLabel: "Discard and leave",
    cancelLabel: "Stay",
    destructive: true,
  });

  if (leave) {
    unsaved.clearAll();
  }
  return leave;
};

/** The page, the entry open in it (`edit`) and the file whose panel is open (`file`). */
function placeOf(url: string): { path: string; edit: string; file: string } {
  const [path = "", query = ""] = url.split("#")[0].split("?");
  const params = new URLSearchParams(query);
  return { path, edit: params.get("edit") ?? "", file: params.get("file") ?? "" };
}

function samePlace(fromUrl: string, toUrl: string): boolean {
  const from = placeOf(fromUrl);
  const to = placeOf(toUrl);
  return from.path === to.path && from.edit === to.edit && (!from.file || from.file === to.file);
}
