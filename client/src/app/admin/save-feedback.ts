import { toast } from "@spartan-ng/brain/sonner";

import { SESSION_LOST } from "./admin-api.interceptor";
import type { ApiIssue } from "./admin-api.service";
import type { ConfirmService } from "./components/confirm-dialog.component";
import { issueSummary } from "./issues";

/** Long enough to read the toast and reach for its button. */
const UNDO_MS = 10_000;

/**
 * Another tab or session saved first. Asked, never done behind the editor's
 * back: true reloads that version, which drops the edits here; false keeps
 * them, and the caller moves on to the new version so the next Save goes through.
 */
export function askStale(confirm: ConfirmService, what = "This section"): Promise<boolean> {
  return confirm.ask({
    title: "Saved elsewhere",
    description: `${what} changed in another tab or session. Your edits are still here: keep them and Save replaces that version, or reload to get it and drop them.`,
    confirmLabel: "Reload",
    cancelLabel: "Keep my edits",
    destructive: true,
  });
}

/** A save that failed for a reason of its own: a lost session says what to do next. */
export function toastNotSaved(error: string, title = "Not saved"): void {
  if (SESSION_LOST.has(error)) {
    toast.error("Not saved: you were signed out. Sign in, then save again.");
  } else {
    toast.error(title, { description: error });
  }
}

/** The save was refused field by field; the fields themselves say why. */
export function toastIssues(issues: readonly ApiIssue[]): void {
  toast.error("Check the highlighted fields", {
    description: issueSummary(issues) || "Some values were not accepted.",
  });
}

/** A step that replaced typed text, with one way back for as long as the toast stays. */
export function toastUndo(message: string, undo: () => void, focusOn: string): void {
  toast(message, {
    duration: UNDO_MS,
    action: {
      label: "Undo",
      onClick: () => {
        undo();
        // Its button goes with the toast. After the render, which enables Save again.
        setTimeout(() => document.querySelector<HTMLElement>(focusOn)?.focus(), 50);
      },
    },
  });
}

/** Discard's way back: the edits return, and Save (the bar's, or the editor header's) is where the keyboard lands. */
export function toastDiscarded(undo: () => void): void {
  toastUndo(
    "Changes discarded",
    undo,
    "app-save-bar [aria-keyshortcuts], app-editor-header [aria-keyshortcuts]",
  );
}
