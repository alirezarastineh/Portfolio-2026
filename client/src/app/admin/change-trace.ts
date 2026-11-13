import type { AppContent, Locale } from "../content/schema";
import type { PublishReview } from "./admin-api.service";
import { hasText } from "./editor-outline";
import { isHidden } from "./hidden-fields";
import { contentDiff } from "./publish-summary";

/** The change trace (plan 5): changed here and not saved, saved to the draft and not live, or live. */
export type TraceState = "unsaved" | "draft" | "live";

/** What the review says about the draft against the live site, for the trace and the language notes. */
export interface DraftMarks {
  /** Per language, the paths publishing now would change (`ui.about.bio`, `projects[atlas].name`). */
  paths: Record<Locale, readonly string[]>;
  /** Per language, what is live; null before the first publish. */
  live: Record<Locale, AppContent | null>;
  /** When the review was asked for: a save after that is not in it yet. */
  asked: number;
}

/** A path an editor shows: hidden fields (`ui.about.subtitle`) keep their value and no mark. */
function shown(path: string): boolean {
  const dot = path.indexOf(".");
  return dot < 0 || !isHidden("section", path.slice(0, dot), path.slice(dot + 1));
}

/** The same diff as the publish review's count, so the trace and Publish's number agree. */
export function draftMarks(review: PublishReview, asked: number): DraftMarks {
  const marks: DraftMarks = { paths: { en: [], de: [] }, live: { en: null, de: null }, asked };
  for (const side of review.locales) {
    marks.live[side.locale] = side.live;
    if (side.draft) {
      marks.paths[side.locale] = contentDiff(side.live, side.draft)
        .map((e) => e.path)
        .filter(shown);
    }
  }
  return marks;
}

/**
 * A field (`ui.about.bio`) is in the draft when its path changed in either language; an item
 * (`projects[atlas]`) when anything under it did. One rule: the path itself, or one below it.
 */
export function inDraft(marks: DraftMarks | null, path: string): boolean {
  if (!marks) return false;
  const under = (p: string) => p === path || p.startsWith(`${path}.`) || p.startsWith(`${path}[`);
  return marks.paths.en.some(under) || marks.paths.de.some(under);
}

/** The live site's text at a path, in both languages; null where either has none. */
export function liveText(marks: DraftMarks | null, path: string): Record<Locale, string> | null {
  const at = (doc: unknown) =>
    path.split(".").reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], doc);
  const en = at(marks?.live.en);
  const de = at(marks?.live.de);
  return typeof en === "string" && typeof de === "string" ? { en, de } : null;
}

export type LanguageNote = "Missing in German" | "English changed, German not";

/** The German against the English and the live site: missing, or left behind by a newer English. */
export function languageNote(
  en: string,
  de: string,
  live: Record<Locale, string> | null,
): LanguageNote | null {
  if (!hasText(en)) return null;
  if (!hasText(de)) return "Missing in German";
  return live && en !== live.en && de === live.de ? "English changed, German not" : null;
}
