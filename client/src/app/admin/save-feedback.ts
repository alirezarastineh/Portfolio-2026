import { toast } from "@spartan-ng/brain/sonner";

import type { ApiIssue } from "./admin-api.service";
import { issueSummary } from "./issues";

/**
 * Another tab (or session) saved first. Reload fetches that version into the
 * editor; the edits here are dropped, which is why it is a button to press
 * and not something done behind the editor's back.
 */
export function toastStale(reload: () => unknown, what = "This section"): void {
  toast.error("Saved elsewhere", {
    description: `${what} changed in another tab or session. Reload to get that version — the unsaved edits here are dropped.`,
    duration: 20_000,
    action: { label: "Reload", onClick: () => void reload() },
  });
}

/** The save was refused field by field; the fields themselves say why. */
export function toastIssues(issues: readonly ApiIssue[]): void {
  toast.error("Check the highlighted fields", {
    description: issueSummary(issues) || "Some values were not accepted.",
  });
}
