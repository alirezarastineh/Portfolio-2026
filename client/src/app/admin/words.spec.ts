import { describe, expect, it } from "vitest";

import { uiSchema, type AppTranslations } from "../content/schema";
import { isHidden } from "./hidden-fields";
import { ROWS } from "./word-rows";
import {
  foundWords,
  matchesWord,
  missingGerman,
  tokenIssues,
  WORD_GROUPS,
  type WordFilters,
  type WordRow,
} from "./words";

const ALL: WordFilters = { q: "", section: "", missing: false, unsaved: false };
const byCodePoint = (a: string, b: string): number => {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
};
const emptyUi = () =>
  Object.fromEntries(WORD_GROUPS.map((group) => [group, {}])) as unknown as AppTranslations &
    Record<string, Record<string, string>>;
const row = (change: Partial<WordRow> = {}): WordRow => ({
  group: "contact",
  key: "submit",
  label: "Send button",
  ...change,
});

describe("Words' rows", () => {
  it("hold every key of the twelve groups once, each shown key a row and each hidden one none", () => {
    expect(WORD_GROUPS).toHaveLength(12);
    expect(WORD_GROUPS).not.toContain("profile");
    expect(WORD_GROUPS).not.toContain("about");
    const rows = ROWS.map((r) => `${r.group}.${r.key}`);
    expect(new Set(rows).size).toBe(rows.length);
    const keys = WORD_GROUPS.flatMap((group) =>
      Object.keys(uiSchema.shape[group].shape).map((key) => `${group}.${key}`),
    );
    const shown = keys.filter((key) => !isHidden("section", "ui", key));
    expect(rows.toSorted(byCodePoint)).toEqual(shown.toSorted(byCodePoint));
    expect(keys.length - shown.length).toBe(6);
  });

  it("mark a token exactly where the server's schema wants one", () => {
    for (const r of ROWS) {
      const shape = uiSchema.shape[r.group].shape as Record<
        string,
        { safeParse(v: string): { success: boolean } }
      >;
      const field = shape[r.key];
      // A text without its token is refused; with it, it passes.
      const refused =
        !field.safeParse("text").success && field.safeParse(`text ${r.token}`).success;
      expect(refused, `${r.group}.${r.key}`).toBe(r.token !== undefined);
    }
  });
});

describe("the filters", () => {
  const text = { en: "Send message", de: "Nachricht senden" };

  it("find a word in the name or either language, any case", () => {
    expect(matchesWord(row(), text, false, { ...ALL, q: "SEND" })).toBe(true);
    expect(matchesWord(row(), text, false, { ...ALL, q: "nachricht" })).toBe(true);
    expect(matchesWord(row(), text, false, { ...ALL, q: "button" })).toBe(true);
    expect(matchesWord(row(), text, false, { ...ALL, q: "zzz" })).toBe(false);
  });

  it("keep a group by its heading's id: Work holds two", () => {
    expect(matchesWord(row(), text, false, { ...ALL, section: "contact" })).toBe(true);
    expect(matchesWord(row(), text, false, { ...ALL, section: "work" })).toBe(false);
    const card = row({ group: "projectCard", key: "live", label: "Live link" });
    expect(matchesWord(card, text, false, { ...ALL, section: "work" })).toBe(true);
    const legal = row({ group: "legal", key: "nav", label: "Footer group label" });
    expect(matchesWord(legal, text, false, { ...ALL, section: "footer-and-legal" })).toBe(true);
  });

  it("call a German missing when it is empty, a placeholder, or the English's own words", () => {
    expect(missingGerman("Send", "")).toBe(true);
    expect(missingGerman("Send", "  ")).toBe(true);
    expect(missingGerman("Name", "Name")).toBe(true);
    expect(missingGerman("Send", "Senden")).toBe(false);
    // Nothing to translate from.
    expect(missingGerman("", "")).toBe(false);
    expect(matchesWord(row(), { en: "Name", de: "Name" }, false, { ...ALL, missing: true })).toBe(
      true,
    );
    expect(matchesWord(row(), text, false, { ...ALL, missing: true })).toBe(false);
  });

  it("show only what is changed and not saved, with every filter at once", () => {
    expect(matchesWord(row(), text, true, { ...ALL, unsaved: true })).toBe(true);
    expect(matchesWord(row(), text, false, { ...ALL, unsaved: true })).toBe(false);
    const all = { q: "send", section: "contact", missing: false, unsaved: true };
    expect(matchesWord(row(), text, true, all)).toBe(true);
    expect(matchesWord(row(), text, true, { ...all, section: "navigation" })).toBe(false);
  });
});

describe("the token check", () => {
  it("names each text that lost its token by its row and language, as the server would refuse it", () => {
    const years = row({ group: "experience", key: "years", label: "Years", token: "{n}" });
    const texts: Record<string, string> = { en: "{n} yr", de: "Jahre" };
    expect(tokenIssues([row(), years], (_, locale) => texts[locale])).toEqual([
      {
        path: ["experience", "de", "years"],
        message: "Keep {n}: the number goes there.",
        label: "Experience › Years (German)",
      },
    ]);
    expect(tokenIssues([years], () => "{n} J.")).toEqual([]);
  });
});

describe("Find's entries for Words", () => {
  it("name each shown key by its heading and English, search key and both texts, and land on its row", () => {
    // Every group empty but the two below.
    const en = emptyUi();
    const de = emptyUi();
    en.contact = { submit: "Send message", heading: "" } as never;
    de.contact = { submit: "Nachricht senden", heading: "Kontakt" } as never;
    en.nav = { skills: "Skills", about: "About" } as never;
    de.nav = { skills: "Skills", about: "Über mich" } as never;

    const found = foundWords({ en, de });
    expect(found.map((f) => f.key)).toEqual(["nav.about", "contact.submit", "contact.heading"]);
    expect(found[1]).toEqual({
      key: "contact.submit",
      label: "Contact › Send message",
      search: "contact.submit Send message Nachricht senden",
      path: "/admin/words?row=contact.submit",
    });
    // No English: the German names it.
    expect(found[2].label).toBe("Contact › Kontakt");
  });
});
