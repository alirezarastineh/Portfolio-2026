import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { LOCALES } from "../../content/schema.js";
import { fixtureConfig } from "../../test/ask-fixtures.js";
import { PROMPT_LEAKS } from "../answer-patterns.js";
import { buildLeakGuard, SHINGLE_WORDS, words } from "../leak-guard.js";
import { CAREFUL_BLOCKS, PROMPT_CANARY, SCOPE, SYSTEM_PROMPT } from "../prompt.js";
import { DEFAULT_SETTINGS } from "../settings.js";
import { TOOL_NAMES } from "../tools.js";
import { assistantDocuments, defaultSystemCard, SYSTEM_CARD_UPDATED } from "./assistant-docs.js";

/**
 * The default system card answers "how do you work?" and is cited for it, so
 * an answer may quote it whole. Plan phase 33: whatever it says, it must not
 * be the instructions — no tool name, no leak piece, no run of them.
 */

const configs = {
  plain: fixtureConfig(),
  "with search by meaning": (() => {
    const config = fixtureConfig();
    return { ...config, embeddings: { ...config.embeddings, enabled: true } };
  })(),
};

const instructions = buildLeakGuard({
  instructions: [SYSTEM_PROMPT, ...CAREFUL_BLOCKS].join("\n\n"),
  corpusTexts: [],
  quotable: [SCOPE],
  canary: PROMPT_CANARY,
  secrets: [],
}).shingles;

function runsOf(text: string): string[] {
  const all = words(text);
  return all
    .slice(0, Math.max(0, all.length - SHINGLE_WORDS + 1))
    .map((_, i) => all.slice(i, i + SHINGLE_WORDS).join(" "));
}

describe("defaultSystemCard", () => {
  it("would see a run copied from the instructions", () => {
    expect(runsOf(SYSTEM_PROMPT).filter((run) => instructions.has(run)).length).toBeGreaterThan(
      100,
    );
  });

  for (const [name, config] of Object.entries(configs)) {
    for (const locale of ["en", "de"] as const) {
      describe(`${locale}, ${name}`, () => {
        const card = defaultSystemCard(locale, config);

        it("names the models and none of the tools", () => {
          expect(card).toContain(config.gemini.model);
          expect(card).toContain(config.gemini.deepModel!);
          for (const tool of TOOL_NAMES) expect(card).not.toContain(tool);
        });

        it("holds no piece and no run of the instructions", () => {
          for (const piece of PROMPT_LEAKS) expect(card).not.toMatch(new RegExp(piece, "i"));
          expect(runsOf(card).filter((run) => instructions.has(run))).toEqual([]);
        });

        it("claims nothing a switch decides: the same card whatever the deploy's search", () => {
          // Search by meaning needs the deploy's flag, the admin's switch, its vectors and its
          // fence: a card saying so would be wrong while any is off, and the eval fixture's card
          // would change with the environment the run happens to have.
          expect(card).toBe(defaultSystemCard(locale, configs.plain));
          expect(card).not.toMatch(locale === "de" ? /Bedeutung/ : /meaning/i);
        });

        it("points agents to the read-only surface", () => {
          expect(card).toContain("/llms.txt");
          expect(card).toContain("/.well-known/agent-card.json");
        });
      });
    }
  }
});

describe("the system card's date (visitor plan V21)", () => {
  it("is the day the default's words last changed: new words need a new day", () => {
    // New words fail here: set SYSTEM_CARD_UPDATED to the day they changed, then this hash.
    const words = LOCALES.map((locale) => defaultSystemCard(locale, configs.plain)).join("\n");
    const hash = createHash("sha256").update(words).digest("hex").slice(0, 12);
    expect([SYSTEM_CARD_UPDATED, hash]).toEqual(["2026-11-04", "32ccd24cae86"]);
  });

  it("dates the admin's own card by the save that holds it", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      systemCard: { en: "My own words.", de: "" },
      updatedAt: "2026-11-01T10:00:00.000Z",
    };
    const cards = assistantDocuments(settings, [], configs.plain).filter(
      (d) => d.kind === "system-card",
    );
    expect(cards.map((d) => [d.id, d.updated])).toEqual([
      ["system-card@en", "2026-11-01"],
      ["system-card@de", SYSTEM_CARD_UPDATED],
    ]);
  });
});
