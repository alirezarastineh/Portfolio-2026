import { describe, expect, it } from "vitest";

import {
  checksLine,
  draftOffer,
  gateNames,
  leadName,
  medianEdit,
  modelsLabel,
  percent,
  skillName,
  verdictLine,
  type SkillVersionStats,
} from "./copilot-skills";

const rules = { keepFloor: 0.5, minimumDecided: 10 };

const stats = (over: Partial<SkillVersionStats>): SkillVersionStats => ({
  version: "abc123def456",
  current: true,
  uses: 0,
  kept: 0,
  edited: 0,
  discarded: 0,
  abstained: 0,
  waiting: 0,
  repaired: 0,
  needsEye: 0,
  alternativesKept: 0,
  revised: 0,
  decided: 0,
  keepRate: null,
  editRate: null,
  medianEdit: null,
  flagged: false,
  first: null,
  last: null,
  ...over,
});

describe("the copilot's skills view (plan phase 27)", () => {
  it("names each skill and its models in words", () => {
    expect(skillName("faq-answer")).toBe("FAQ answer");
    expect(skillName("seo")).toBe("Search description");
    expect(skillName("unknown")).toBe("unknown");
    expect(modelsLabel("vision")).toContain("reads images");
    expect(modelsLabel("text")).toContain("Any model");
  });

  it("writes rates as whole percentages, and a dash with nothing to rate", () => {
    expect(percent(5 / 12)).toBe("42 %");
    expect(percent(1)).toBe("100 %");
    expect(percent(null)).toBe("–");
  });

  it("says what a version's numbers amount to: flagged, too few, or its keep rate", () => {
    expect(verdictLine(stats({ decided: 12, keepRate: 5 / 12, flagged: true }), rules)).toBe(
      "Kept 42 % of the time over 12 decided drafts: under 50 %.",
    );
    expect(verdictLine(stats({ decided: 3, keepRate: 1 }), rules)).toBe(
      "3 of the 10 decided drafts a rate needs.",
    );
    expect(verdictLine(stats({ decided: 10, keepRate: 0.8 }), rules)).toBe(
      "Kept 80 % of the time over 10 decided drafts.",
    );
  });

  it("offers nothing beside a clean single draft, and the notes and alternatives otherwise (plan phase 28)", () => {
    expect(draftOffer({ text: "Clean.", model: "m", suggestionId: "s" })).toBeNull();
    expect(
      draftOffer({
        text: "Too long draft.",
        model: "m",
        needsReview: ["12 characters over the limit of 155", "starts with a preamble"],
      }),
    ).toEqual({
      drafts: [
        {
          text: "Too long draft.",
          lead: null,
          notes: ["Needs your eye: 12 characters over the limit of 155; starts with a preamble."],
        },
      ],
      chosen: 0,
    });
    expect(
      draftOffer({
        text: "Outcome first.",
        model: "m",
        lead: "outcome",
        alternatives: [
          { text: "Problem first.", lead: "problem" },
          { text: "Here is: stack.", lead: "stack", needsReview: ["starts with a preamble"] },
        ],
      })?.drafts.map((d) => [d.lead, d.notes]),
    ).toEqual([
      ["outcome", []],
      ["problem", []],
      ["stack", ["Needs your eye: starts with a preamble."]],
    ]);
    expect(
      draftOffer({
        text: "Übersetzt.",
        model: "m",
        critic: { revised: true, notes: ["A term was translated."] },
      })?.drafts[0]?.notes,
    ).toEqual(["A second reading changed it: A term was translated."]);
    // Its revision refused by the checks: what it found still reaches the admin.
    expect(
      draftOffer({
        text: "Übersetzt.",
        model: "m",
        critic: { revised: false, notes: ["A sentence lost its meaning."] },
      })?.drafts[0]?.notes,
    ).toEqual(["A second reading found: A sentence lost its meaning. Its revision was not kept."]);
    expect(
      draftOffer({ text: "Fine.", model: "m", critic: { revised: false, notes: [] } }),
    ).toBeNull();
  });

  it("names the checks, the leads and how a version's drafts were made", () => {
    expect(gateNames(["length", "bare", "no-image-of"])).toBe(
      "within the limit, no preamble or quotes, no “image of”",
    );
    expect(gateNames([])).toBe("None");
    expect(leadName("problem")).toBe("problem first");
    expect(leadName(null)).toBe("another way");
    const made = stats({ uses: 14, repaired: 2, needsEye: 1, alternativesKept: 3, revised: 0 });
    expect(checksLine(made, { leads: ["outcome"], critic: false })).toBe(
      "Of 14 drafts: 2 repaired, 1 needed your eye, 3 kept from an alternative.",
    );
    expect(checksLine(made, { leads: [], critic: true })).toBe(
      "Of 14 drafts: 2 repaired, 1 needed your eye, 0 revised by a second reading.",
    );
  });

  it("gives the median edit in words", () => {
    expect(medianEdit(stats({ medianEdit: 2.5 }))).toBe("3 words");
    expect(medianEdit(stats({ medianEdit: 1 }))).toBe("1 word");
    expect(medianEdit(stats({}))).toBe("–");
  });
});
