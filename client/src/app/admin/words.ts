import type { ApiIssue } from "./admin-api.service";
import type { AppTranslations, Locale } from "../content/schema";
import { hasText } from "./editor-outline";
import { isHidden } from "./hidden-fields";

/** Words' groups (plan 5, U12): every `ui` group but Profile's and About's, which their pages hold. */
export type WordGroup = Exclude<keyof AppTranslations, "profile" | "about">;

/** Each group's heading, in the table's order; Work holds two groups. */
export const WORD_HEADINGS: Record<WordGroup, string> = {
  nav: "Navigation",
  hero: "Hero labels",
  contact: "Contact",
  projects: "Work",
  projectCard: "Work",
  caseStudy: "Case study",
  skills: "Skills",
  experience: "Experience",
  writing: "Writing",
  legal: "Footer and legal",
  notFound: "404",
  ask: "Assistant",
};

export const WORD_GROUPS = Object.keys(WORD_HEADINGS) as WordGroup[];

/** A heading's id, for its section and the group filter: "Footer and legal" → "footer-and-legal". */
export const sectionId = (heading: string): string => heading.toLowerCase().replaceAll(" ", "-");

/** A row of Words: one `ui` key, in both languages. */
export interface WordRow {
  group: WordGroup;
  key: string;
  label: string;
  hint?: string;
  multiline?: boolean;
  /** The server refuses a text without it (`withToken`): the number goes there. */
  token?: "{n}" | "{i}";
}

export interface WordFilters {
  q: string;
  /** A heading's id, or "" for every group. */
  section: string;
  missing: boolean;
  unsaved: boolean;
}

/** "Missing in German": English with text, and a German with none, or the English's own words. */
export function missingGerman(en: string, de: string): boolean {
  return hasText(en) && (!hasText(de) || de.trim() === en.trim());
}

/** Whether the filters show a row: its name or a text holds the word, and every other filter agrees. */
export function matchesWord(
  row: WordRow,
  text: Record<Locale, string>,
  unsaved: boolean,
  filters: WordFilters,
): boolean {
  const word = filters.q.trim().toLowerCase();
  return (
    (!word || [row.label, text.en, text.de].some((t) => t.toLowerCase().includes(word))) &&
    (!filters.section || sectionId(WORD_HEADINGS[row.group]) === filters.section) &&
    (!filters.missing || missingGerman(text.en, text.de)) &&
    (!filters.unsaved || unsaved)
  );
}

/** Each text that lost its token, as the server would refuse it, named by its row. */
export function tokenIssues(
  rows: readonly WordRow[],
  text: (row: WordRow, locale: Locale) => string,
): ApiIssue[] {
  return rows.flatMap((row) => {
    const token = row.token;
    if (!token) {
      return [];
    }
    return (["en", "de"] as const)
      .filter((locale) => !text(row, locale).includes(token))
      .map((locale) => ({
        path: [row.group, locale, row.key],
        message: `Keep ${token}: the number goes there.`,
        label: `${WORD_HEADINGS[row.group]} › ${row.label} (${locale === "en" ? "English" : "German"})`,
      }));
  });
}

/** Find's entries for Words: each shown key by its heading and English, searched by key and both texts. */
export function foundWords(
  ui: Record<Locale, AppTranslations>,
): { key: string; label: string; search: string; path: string }[] {
  return WORD_GROUPS.flatMap((group) =>
    Object.entries(ui.en[group] as Record<string, string | undefined>).flatMap(([key, en = ""]) => {
      if (isHidden("section", "ui", `${group}.${key}`)) {
        return [];
      }
      const de = (ui.de[group] as Record<string, string | undefined>)[key] ?? "";
      return [
        {
          key: `${group}.${key}`,
          label: `${WORD_HEADINGS[group]} › ${en || de || key}`,
          search: `${group}.${key} ${en} ${de}`,
          path: `/admin/words?row=${group}.${key}`,
        },
      ];
    }),
  );
}
