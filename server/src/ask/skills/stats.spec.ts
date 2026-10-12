import { describe, expect, it } from "vitest";

import type { Skill } from "./skill.js";
import { SKILL_RULES, skillTable, type UseAggregate, versionStats } from "./stats.js";

const counts = (
  version: string,
  n: Partial<Omit<UseAggregate, "skill" | "version">> = {},
  skill = "seo",
): UseAggregate => {
  const kept = n.kept ?? 0;
  const edited = n.edited ?? 0;
  const discarded = n.discarded ?? 0;
  const abstained = n.abstained ?? 0;
  const waiting = n.waiting ?? 0;
  return {
    skill,
    version,
    source: n.source ?? "copilot",
    uses: kept + edited + discarded + abstained + waiting,
    kept,
    edited,
    discarded,
    abstained,
    waiting,
    repaired: n.repaired ?? 0,
    needsEye: n.needsEye ?? 0,
    alternativesKept: n.alternativesKept ?? 0,
    revised: n.revised ?? 0,
    medianEdit: n.medianEdit ?? null,
    first: n.first ?? "2026-10-01T00:00:00.000Z",
    last: n.last ?? "2026-10-02T00:00:00.000Z",
  };
};

const skill = (id: string, version: string) =>
  ({
    id,
    version,
    description: `${id} does a thing`,
    whenToUse: "when needed",
    models: "text",
    gates: [],
    leads: [],
    critic: false,
    template: "Write it.",
  }) as unknown as Skill;

describe("a skill version's rates (plan phase 27)", () => {
  it("keeps a draft kept as it was or edited, of the decided ones", () => {
    expect(versionStats(counts("v1", { kept: 3, edited: 2, discarded: 5 }), true)).toMatchObject({
      decided: 10,
      keepRate: 0.5,
      editRate: 0.2,
      flagged: false,
    });
  });

  it("flags a version kept under half the time, once 10 drafts are decided", () => {
    expect(SKILL_RULES).toEqual({ keepFloor: 0.5, minimumDecided: 10 });
    expect(versionStats(counts("v1", { kept: 2, edited: 2, discarded: 6 }), true)).toMatchObject({
      decided: 10,
      keepRate: 0.4,
      flagged: true,
    });
    // Nine decided: too few to say.
    expect(versionStats(counts("v1", { kept: 2, edited: 2, discarded: 5 }), true)).toMatchObject({
      decided: 9,
      flagged: false,
    });
  });

  it("counts an abstention or a draft still waiting in no rate", () => {
    expect(versionStats(counts("v1", { kept: 1, abstained: 5, waiting: 7 }), true)).toMatchObject({
      uses: 13,
      decided: 1,
      keepRate: 1,
      editRate: 0,
      flagged: false,
    });
    expect(versionStats(counts("v1", { abstained: 3, waiting: 20 }), true)).toMatchObject({
      decided: 0,
      keepRate: null,
      editRate: null,
      flagged: false,
    });
  });
});

describe("the skills' table", () => {
  it("lists every skill, its current version first even unused, then older ones by last use", () => {
    const table = skillTable(
      [skill("seo", "v3"), skill("alt", "a1")],
      [
        counts("v1", { kept: 1, last: "2026-09-01T00:00:00.000Z" }),
        counts("v2", { kept: 4, edited: 1, medianEdit: 2, last: "2026-09-20T00:00:00.000Z" }),
        counts("a0", { discarded: 2 }, "alt"),
      ],
    );
    expect(table.map((s) => s.id)).toEqual(["seo", "alt"]);
    const [seo, alt] = table;
    expect(seo!.versions.map((v) => [v.version, v.current, v.uses])).toEqual([
      ["v3", true, 0],
      ["v2", false, 5],
      ["v1", false, 1],
    ]);
    expect(seo!.versions[0]).toMatchObject({ first: null, last: null, keepRate: null });
    expect(seo!.versions[1]).toMatchObject({ keepRate: 1, editRate: 0.2, medianEdit: 2 });
    // Another skill's versions stay with it.
    expect(alt!.versions.map((v) => v.version)).toEqual(["a1", "a0"]);
    expect(seo).toMatchObject({ description: "seo does a thing", template: "Write it." });
    expect(Object.keys(seo!.versions[1]!)).not.toContain("skill");
    expect(Object.keys(seo!.versions[1]!)).not.toContain("source");
    expect(seo!.agent).toEqual([]);
  });

  it("counts the agents' drafts apart, the current version first (plan phases 29–31)", () => {
    const table = skillTable(
      [skill("seo", "v3")],
      [
        counts("v2", { kept: 4, last: "2026-09-20T00:00:00.000Z" }),
        counts("v1", { discarded: 2, source: "agent", last: "2026-09-01T00:00:00.000Z" }),
        counts("v2", { edited: 1, source: "agent", last: "2026-09-21T00:00:00.000Z" }),
        counts("v3", { kept: 3, waiting: 1, source: "agent" }),
      ],
    );
    const [seo] = table;
    // The copilot's rows hold the copilot's drafts only.
    expect(seo!.versions.map((v) => [v.version, v.uses])).toEqual([
      ["v3", 0],
      ["v2", 4],
    ]);
    expect(seo!.agent.map((v) => [v.version, v.current, v.uses, v.keepRate])).toEqual([
      ["v3", true, 4, 1],
      ["v2", false, 1, 1],
      ["v1", false, 2, 0],
    ]);
  });
});
