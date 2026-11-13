import type { LocaleView } from "./components/field-pair.component";

/** Each editor's language view, remembered in this browser (plan 5, U10). */
const KEY = "admin.lang.";

/** The view this browser remembers for an editor; null when none, or storage is blocked. */
export function storedView(editor: string): LocaleView | null {
  try {
    const view = localStorage.getItem(KEY + editor);
    return view === "en" || view === "de" || view === "both" ? view : null;
  } catch {
    return null;
  }
}

/** Remembers an editor's view; with storage blocked, the choice lasts for this visit. */
export function storeView(editor: string, view: LocaleView): void {
  try {
    localStorage.setItem(KEY + editor, view);
  } catch {
    // Blocked: nothing to keep.
  }
}
