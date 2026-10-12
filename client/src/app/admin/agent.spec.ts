import { describe, expect, it } from "vitest";

import {
  agentWords,
  filterProposals,
  filterStatuses,
  groupProposals,
  isContentRun,
  isOpen,
  plainText,
  runSummary,
  splitLabel,
  startWords,
  statusName,
  summaryLine,
  type Proposal,
} from "./agent";

function proposal(label: string, status: Proposal["status"] = "proposed"): Proposal {
  return {
    id: label,
    createdAt: "2026-10-09T10:00:00.000Z",
    updatedAt: "2026-10-09T10:00:00.000Z",
    runId: "r1",
    goal: "translations",
    kind: "project",
    entityId: "p1",
    field: "hook",
    locale: "de",
    label,
    before: "",
    after: "Ein Haken.",
    skill: "translate",
    version: "v",
    useId: null,
    flags: [],
    notes: [],
    status,
    decidedAt: null,
    appliedAt: null,
    revertedAt: null,
  };
}

describe("the Agent page's helpers (plan phase 30)", () => {
  it("groups proposals by what they change, in the order they come", () => {
    const groups = groupProposals([
      proposal("Atlas · Hook (DE)"),
      proposal("Site copy · profile.heroHeadline (DE)"),
      proposal("Atlas · Name (DE)"),
    ]);
    expect(
      groups.map((g) => [g.entity, g.proposals.map((p) => splitLabel(p.label).field)]),
    ).toEqual([
      ["Atlas", ["Hook (DE)", "Name (DE)"]],
      ["Site copy", ["profile.heroHeadline (DE)"]],
    ]);
    // A name with its own " · " keeps it: only the last one splits off the field.
    expect(splitLabel("Engineer · Acme · Title (EN)")).toEqual({
      entity: "Engineer · Acme",
      field: "Title (EN)",
    });
  });

  it("filters open proposals (drafted or needing the admin) from decided ones", () => {
    const all = [
      proposal("A · X", "proposed"),
      proposal("B · X", "needs_you"),
      proposal("C · X", "applied"),
      proposal("D · X", "stale"),
    ];
    expect(filterProposals(all, "open").map((p) => p.label)).toEqual(["A · X", "B · X"]);
    expect(filterProposals(all, "applied").map((p) => p.label)).toEqual(["C · X"]);
    expect(filterProposals(all, "all")).toHaveLength(4);
    expect(isOpen({ status: "needs_you" })).toBe(true);
    expect(statusName("needs_you")).toBe("Needs you");
    // What each filter asks the server for: all of them, for all.
    expect(filterStatuses("open")).toEqual(["proposed", "needs_you"]);
    expect(filterStatuses("stale")).toEqual(["stale"]);
    expect(filterStatuses("all")).toEqual([]);
  });

  it("reads a content run and its summary among the runs", () => {
    expect(isContentRun({ kind: "agent", params: { task: "content" } })).toBe(true);
    expect(isContentRun({ kind: "agent", params: { task: "replay", entry: "e" } })).toBe(false);
    expect(isContentRun({ kind: "eval", params: {} })).toBe(false);
    const summary = runSummary({ summary: { proposed: 3, needsYou: 1, stale: 2 } as never });
    expect(summary).toEqual({ proposed: 3, needsYou: 1, stale: 2 });
    expect(summaryLine(summary!)).toBe("3 proposed, 1 need you, 2 stale");
    expect(runSummary({ summary: null })).toBeNull();
  });

  it("says the server's refusals in words, and shows a field's text without its markup", () => {
    expect(agentWords("feature_off")).toBe("Admin agents are switched off: Settings → Spending.");
    expect(agentWords("stale")).toMatch(/nothing was overwritten/);
    expect(agentWords("not_found")).toBe("That proposal is gone.");
    expect(agentWords("something_new")).toBe("something_new");
    // The request's own failures, never a raw code.
    expect(agentWords("http_404")).toMatch(/deploy the API first/);
    expect(agentWords("http_502")).toBe("The API failed (HTTP 502): try again; its log says why.");
    expect(agentWords("network_error")).toMatch(/did not answer/);
    expect(agentWords("request_failed")).toBe("The request failed: try again.");
    expect(agentWords("failed")).toMatch(/nothing was written/);
    // A run refused for its limits says them; its other refusals read as everywhere.
    expect(startWords("invalid_input")).toBe(
      "The run's limits are out of range: 1–100 items, $0.01–$1.",
    );
    expect(startWords("feature_off")).toBe(agentWords("feature_off"));
    expect(plainText("<p>Search &amp; <strong>answers</strong>&nbsp;fast</p>")).toBe(
      "Search & answers fast",
    );
  });
});
