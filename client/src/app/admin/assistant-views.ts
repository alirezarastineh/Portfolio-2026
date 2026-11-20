/** The Assistant's views (plan 5, U18): one route, the view in `?view=`, Now with none. */
export type AssistantView =
  "now" | "conversations" | "reviews" | "questions" | "journal" | "quality" | "settings";

export const VIEWS: readonly { id: AssistantView; label: string }[] = [
  { id: "now", label: "Now" },
  { id: "conversations", label: "Conversations" },
  { id: "reviews", label: "Reviews" },
  { id: "questions", label: "Questions" },
  { id: "journal", label: "Journal" },
  { id: "quality", label: "Quality" },
  { id: "settings", label: "Settings" },
];

/** The names an address may carry: the views', and the eleven tabs' before U18 (Today's links, bookmarks). */
const NAMES = new Map<string, AssistantView>([
  ["conversations", "conversations"],
  ["reviews", "reviews"],
  ["questions", "questions"],
  ["journal", "journal"],
  ["quality", "quality"],
  ["settings", "settings"],
  ["overview", "now"],
  ["trust", "now"],
  ["playground", "now"],
  ["faq", "questions"],
  ["insights", "questions"],
  ["evals", "quality"],
  ["copilot", "quality"],
]);

/** The view an address names: Now for none, "now", or a name it does not know. */
export function viewOf(name: string | null): AssistantView {
  return NAMES.get(name ?? "") ?? "now";
}

/** What `?view=` carries for a view: nothing for Now. */
export function viewParam(view: AssistantView): string | null {
  return view === "now" ? null : view;
}
