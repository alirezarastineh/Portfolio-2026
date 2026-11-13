import { describe, expect, it } from "vitest";

import type { AppContent } from "../content/schema";
import type { LocaleReview, PublishReview } from "./admin-api.service";
import { draftMarks, inDraft, languageNote, liveText } from "./change-trace";

const content = (value: unknown) => value as AppContent;

function side(locale: "en" | "de", live: unknown, draft: unknown): LocaleReview {
  return {
    locale,
    issues: [],
    changed: true,
    draft: content(draft),
    live: live === null ? null : content(live),
    liveVersionId: live === null ? null : 12,
    docs: [],
  };
}

function review(en: LocaleReview, de: LocaleReview): PublishReview {
  return { canPublish: true, locales: [en, de] };
}

const about = (bio: string, heading = "About") => ({ ui: { about: { heading, bio } } });

describe("draftMarks", () => {
  it("lists, per language, the paths publishing would change, and keeps what is live", () => {
    const marks = draftMarks(
      review(
        side("en", about("Live bio"), about("Draft bio")),
        side("de", about("Bio"), about("Bio")),
      ),
      1_000,
    );
    expect(marks.paths).toEqual({ en: ["ui.about.bio"], de: [] });
    expect(marks.live.en).toEqual(about("Live bio"));
    expect(marks.asked).toBe(1_000);
  });

  it("before the first publish, every field is in the draft", () => {
    const marks = draftMarks(review(side("en", null, about("A")), side("de", null, about("B"))), 0);
    expect(marks.paths.en).toEqual(["ui.about.heading", "ui.about.bio"]);
    expect(marks.live.de).toBeNull();
  });

  it("leaves hidden fields out: no editor shows them, so nothing marks them", () => {
    const hidden = (subtitle: string) => ({ ui: { about: { subtitle, bio: "Bio" } } });
    const marks = draftMarks(
      review(side("en", hidden("Old"), hidden("New")), side("de", {}, {})),
      0,
    );
    expect(marks.paths.en).toEqual([]);
    expect(inDraft(marks, "ui.about")).toBe(false);
  });

  it("a draft that cannot be built marks nothing: the review lists its problems", () => {
    const broken = { ...side("en", about("A"), about("A")), draft: null };
    expect(draftMarks(review(broken, side("de", about("A"), about("A"))), 0).paths.en).toEqual([]);
  });
});

describe("inDraft", () => {
  const marks = draftMarks(
    review(
      side("en", { ui: { about: { bio: "a" } }, projects: [] }, about("b")),
      side("de", about("x", "Über"), about("x", "Über mich")),
    ),
    0,
  );

  it("marks a field by its own path, in either language", () => {
    expect(inDraft(marks, "ui.about.bio")).toBe(true);
    expect(inDraft(marks, "ui.about.heading")).toBe(true);
  });

  it("marks an item when anything under it changed, and not a longer name that starts alike", () => {
    expect(inDraft(marks, "ui.about")).toBe(true);
    expect(inDraft(marks, "ui.ab")).toBe(false);
    expect(inDraft(marks, "ui.about.bi")).toBe(false);
    const items = draftMarks(
      review(
        side(
          "en",
          { projects: [{ slug: "atlas", name: "A" }] },
          { projects: [{ slug: "atlas", name: "B" }] },
        ),
        side("de", {}, {}),
      ),
      0,
    );
    expect(inDraft(items, "projects[atlas]")).toBe(true);
    expect(inDraft(items, "projects[atl]")).toBe(false);
  });

  it("knows nothing without a review", () => {
    expect(inDraft(null, "ui.about.bio")).toBe(false);
  });
});

describe("liveText", () => {
  const marks = draftMarks(
    review(side("en", about("Live"), about("Live")), side("de", about("Lebt"), about("Lebt"))),
    0,
  );

  it("reads the live site's text at a path, in both languages", () => {
    expect(liveText(marks, "ui.about.bio")).toEqual({ en: "Live", de: "Lebt" });
  });

  it("is null where either language has nothing live", () => {
    expect(liveText(marks, "ui.about.philosophy")).toBeNull();
    expect(liveText(null, "ui.about.bio")).toBeNull();
    const firstPublish = draftMarks(
      review(side("en", null, about("A")), side("de", null, about("B"))),
      0,
    );
    expect(liveText(firstPublish, "ui.about.bio")).toBeNull();
  });
});

describe("languageNote", () => {
  const live = { en: "Live English", de: "Live German" };

  it("says the German is missing when the English has words and the German has none", () => {
    expect(languageNote("Words", "", live)).toBe("Missing in German");
    expect(languageNote("<p>Words</p>", "<p></p>", null)).toBe("Missing in German");
  });

  it("says the English changed when it differs from live and the German does not", () => {
    expect(languageNote("New English", "Live German", live)).toBe("English changed, German not");
  });

  it("says nothing when both moved, neither did, there is no English, or nothing is live", () => {
    expect(languageNote("New English", "Neues Deutsch", live)).toBeNull();
    expect(languageNote("Live English", "Live German", live)).toBeNull();
    expect(languageNote("", "", live)).toBeNull();
    expect(languageNote("New English", "Live German", null)).toBeNull();
  });
});
