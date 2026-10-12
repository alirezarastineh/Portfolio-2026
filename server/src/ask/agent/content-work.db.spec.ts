import { and, eq } from "drizzle-orm";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../app.js";
import type { Locale } from "../../content/schema.js";
import { getDb } from "../../db/client.js";
import {
  aiProposals,
  aiRuns,
  aiSettings,
  aiSkillUses,
  aiUsageFeatures,
  mediaAssets,
  projects,
  projectTranslations,
} from "../../db/schema.js";
import { seed } from "../../db/seed.js";
import { eventually, fixtureConfig, fixtureCorpus } from "../../test/ask-fixtures.js";
import { apiError, mockEntry, replying, usage, type ScriptedModel } from "../../test/ask-models.js";
import { createAdmin, resetDb, TestClient } from "../../test/helpers.js";
import { randomBytes } from "node:crypto";
import type { AskConfig } from "../config.js";
import { resetBreakers } from "../models/circuit.js";
import { abortAllRuns } from "../runs/runner.js";
import { invalidateAssistantCache } from "../settings.js";
import { skillFor } from "../skills/registry.js";
import { DRAFTED_TWICE, RUN_LIMIT } from "./content-work.js";
import { insertProposal } from "./proposals.js";
import { contentTargets, type Target } from "./targets.js";

let config: AskConfig;
let writer: ScriptedModel;
/** The copilot chain's model: a Gemini one reads images, an OpenRouter one does not; none at all. */
let writerId: string | null = "gemini-3.5-flash-lite";
/** The judge chain (ranking, the critic): none unless a test sets one. */
let judge: ScriptedModel | null = null;

const app = createApp({
  ask: {
    config: () => config,
    chain: (_c, role) =>
      role === "copilot"
        ? writerId
          ? [mockEntry(writerId, writer.model)]
          : []
        : role === "judge" && judge
          ? [mockEntry("gemini-3.7-flash", judge.model)]
          : [],
    corpus: async (c) => fixtureCorpus(c),
  },
});

let admin: TestClient;

/**
 * A writer that answers from what it is sent; `tokens` sets each call's input
 * size (its cost), `hold` keeps a call waiting until `open()`, and with
 * `abortable` a held call ends when the run is cancelled or shut down, as a
 * provider's request does.
 */
function drafting(
  reply: (sent: string) => string,
  options: { tokens?: number; hold?: (sent: string) => boolean; abortable?: boolean } = {},
) {
  const calls: LanguageModelV4CallOptions[] = [];
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  const model = new MockLanguageModelV4({
    modelId: "writer",
    doGenerate: async (call) => {
      calls.push(call);
      const sent = JSON.stringify(call.prompt);
      if (options.hold?.(sent)) {
        await new Promise<void>((resolve, reject) => {
          void opened.then(resolve);
          if (options.abortable) {
            call.abortSignal?.addEventListener("abort", () => reject(call.abortSignal!.reason), {
              once: true,
            });
          }
        });
      }
      const text = reply(sent);
      return {
        content: text ? [{ type: "text", text }] : [],
        finishReason: { unified: "stop", raw: "stop" },
        usage: usage(options.tokens ?? 50, 10),
        warnings: [],
      };
    },
  });
  return { model, calls, open: () => open() };
}

/** Translations into German, and search descriptions too short to pass. */
const answers = (sent: string) =>
  sent.includes("Translate the text from English to German")
    ? "Suche, die mit Quellen antwortet."
    : "Too short.";

beforeEach(async () => {
  await resetDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
  invalidateAssistantCache();
  resetBreakers();
  config = fixtureConfig();
  writer = drafting(answers);
  writerId = "gemini-3.5-flash-lite";
  judge = null;
  await seed();
  await closeGaps();
  await createAdmin();
  admin = new TestClient(app);
  await admin.login();
});

afterEach(() => vi.restoreAllMocks());

async function switchOn(featureCaps?: Record<string, number>) {
  await getDb()
    .insert(aiSettings)
    .values({ id: 1, featureSwitches: { agent: true }, ...(featureCaps ? { featureCaps } : {}) });
  invalidateAssistantCache();
}

/** Fills every gap the seed left, so a test plans only the ones it makes. */
async function closeGaps() {
  const targets = await contentTargets(["translations", "seo"], 1000);
  for (const t of targets)
    await fill(t, t.goal === "seo" ? "A short, filled search description of the page." : "Filled.");
}

async function fill(target: Target, text: string) {
  if (target.kind === "project") {
    await getDb()
      .update(projectTranslations)
      .set({ [target.field]: text })
      .where(
        and(
          eq(projectTranslations.projectId, target.entityId),
          eq(projectTranslations.locale, target.locale),
        ),
      );
    return;
  }
  throw new Error(`the seed left a gap this spec does not fill: ${target.key}`);
}

async function projectIds(): Promise<string[]> {
  return (await getDb().select({ id: projects.id }).from(projects).orderBy(projects.position)).map(
    (p) => p.id,
  );
}

async function setText(projectId: string, locale: Locale, change: Record<string, string>) {
  await getDb()
    .update(projectTranslations)
    .set(change)
    .where(
      and(eq(projectTranslations.projectId, projectId), eq(projectTranslations.locale, locale)),
    );
}

/** A German hook to translate on each of the first `n` projects. */
async function hookGaps(n: number): Promise<string[]> {
  const ids = (await projectIds()).slice(0, n);
  for (const id of ids) {
    await setText(id, "en", { hook: "Search that answers with sources." });
    await setText(id, "de", { hook: "" });
  }
  return ids.map((id) => `translations|project|${id}|hook|de`);
}

const start = (body: Record<string, unknown>) =>
  admin.post("/admin/assistant/runs", { kind: "agent", task: "content", ...body });

interface RunView {
  run: {
    id: string;
    status: string;
    error: string | null;
    summary: unknown;
    progress: { total: number };
  };
  items: {
    key: string;
    status: string;
    attempts: number;
    result: Record<string, unknown> | null;
  }[];
}

async function started(body: Record<string, unknown>): Promise<string> {
  const res = await start(body);
  expect(res.status).toBe(202);
  return ((await res.json()) as { id: string }).id;
}

const ended = (id: string) =>
  eventually(async () => {
    const view = (await (await admin.get(`/admin/assistant/runs/${id}`)).json()) as RunView;
    return ["done", "failed", "cancelled", "interrupted"].includes(view.run.status)
      ? view
      : undefined;
  }, 15_000);

const proposals = () => getDb().select().from(aiProposals);

describe("the content agent (plan phase 29)", () => {
  it("waits for the admin to switch admin agents on", async () => {
    await hookGaps(1);
    const refused = await start({ goals: ["translations"] });
    expect(refused.status).toBe(503);
    expect(await refused.json()).toEqual({ error: "feature_off" });
  });

  it("refuses a run with nothing to do, or goals it does not know", async () => {
    await switchOn();
    const nothing = await start({ goals: ["translations"] });
    expect(nothing.status).toBe(400);
    expect(await nothing.json()).toEqual({ error: "nothing_to_do" });
    for (const goals of [[], ["typos"], ["alt", "alt"]]) {
      expect((await start({ goals })).status, JSON.stringify(goals)).toBe(400);
    }
    expect((await start({ goals: ["alt"], maxItems: 101 })).status).toBe(400);
    expect((await start({ goals: ["alt"], maxUsd: 2 })).status).toBe(400);
  });

  it("drafts gated proposals over a seeded database, never the content, and records the spend and the drafts as the agent's (the done-when)", async () => {
    await switchOn();
    const [hook] = await hookGaps(1);
    const [projectId] = await projectIds();
    // A German search description to draft from the page: this writer's drafts are too short.
    await setText(projectId!, "de", { seoDescription: "" });
    await setText(projectId!, "en", { seoDescription: "" });

    const id = await started({ goals: ["translations", "seo"] });
    const view = await ended(id);
    expect(view.run).toMatchObject({ status: "done", error: null });
    expect(view.run.summary).toEqual({ proposed: 1, needsYou: 2, stale: 0 });

    const rows = await proposals();
    const byKey = (key: string) =>
      rows.find((p) => [p.goal, p.kind, p.entityId, p.field, p.locale].join("|") === key)!;
    expect(byKey(hook!)).toMatchObject({
      runId: id,
      status: "proposed",
      before: "",
      after: "Suche, die mit Quellen antwortet.",
      skill: "translate",
      version: skillFor("translate").version,
      flags: [],
      notes: [],
    });
    const seo = byKey(`seo|project|${projectId}|seoDescription|de`);
    expect(seo).toMatchObject({ status: "needs_you", after: "Too short.", flags: ["min-length"] });
    expect(seo.notes).toEqual(["10 characters; at least 50"]);

    // The content is untouched: proposals only.
    const [de] = await getDb()
      .select()
      .from(projectTranslations)
      .where(
        and(eq(projectTranslations.projectId, projectId!), eq(projectTranslations.locale, "de")),
      );
    expect(de).toMatchObject({ hook: "", seoDescription: "" });

    // Spent as the agent; each draft is a skill use, the agent's.
    const spent = await getDb().select().from(aiUsageFeatures);
    expect(new Set(spent.map((r) => r.feature))).toEqual(new Set(["agent"]));
    const uses = await getDb().select().from(aiSkillUses);
    expect(uses.map((u) => u.source)).toEqual(["agent", "agent", "agent"]);
    expect(byKey(hook!).useId).toBe(uses.find((u) => u.skill === "translate")!.id);

    // The translation kept the portfolio's names: the glossary went with it.
    const translation = writer.calls.find((c) =>
      JSON.stringify(c.prompt).includes("Translate the text"),
    );
    expect(JSON.stringify(translation?.prompt)).toContain(
      "Keep these names and terms exactly as they are",
    );
  });

  it("lets a target filled meanwhile go stale, at no cost", async () => {
    await switchOn();
    const [first, second] = await hookGaps(2);
    // The first draft waits while the admin fills the second field by hand.
    const held = drafting(answers, { hold: () => true });
    writer = held;
    const id = await started({ goals: ["translations"] });
    await eventually(async () => (held.calls.length === 1 ? true : undefined));
    const secondId = second!.split("|")[2]!;
    await setText(secondId, "de", { hook: "Von Hand geschrieben." });
    held.open();

    const view = await ended(id);
    expect(view.items.map((i) => [i.key, i.result])).toEqual([
      [first, expect.objectContaining({ status: "proposed" })],
      [second, { stale: true }],
    ]);
    expect(writer.calls).toHaveLength(1);
    expect(view.run.summary).toEqual({ proposed: 1, needsYou: 0, stale: 1 });
  });

  it("resumes a run cut off, drafting only what was left", async () => {
    await switchOn();
    const gaps = await hookGaps(3);
    // The second draft is in flight when the run is cancelled. This provider ignores the abort,
    // so the draft comes back after the cancel: it is not proposed, since the run was stopped.
    const held = drafting(answers, { hold: () => held.calls.length >= 2 });
    writer = held;
    const id = await started({ goals: ["translations"] });
    await eventually(async () => (held.calls.length === 2 ? true : undefined));
    expect((await admin.post(`/admin/assistant/runs/${id}/cancel`, {})).status).toBe(200);
    held.open();
    const cancelled = await ended(id);
    expect(cancelled.run.status).toBe("cancelled");
    expect(cancelled.items.map((i) => i.status)).toEqual(["done", "pending", "pending"]);
    expect(await proposals()).toHaveLength(1);

    // The third's proposal is there already, as a process that stopped after writing it leaves it.
    const [, , third] = gaps;
    const [goal, kind, entityId, field, locale] = third!.split("|");
    await insertProposal({
      runId: id,
      goal: goal as "translations",
      kind: kind as "project",
      entityId: entityId!,
      field: field!,
      locale: locale as Locale,
      label: "Project · Hook (DE)",
      after: "Schon vorgeschlagen.",
      skill: "translate",
      version: skillFor("translate").version,
      status: "proposed",
    });

    writer = drafting(answers);
    expect((await admin.post(`/admin/assistant/runs/${id}/resume`, {})).status).toBe(202);
    const resumed = await ended(id);
    expect(resumed.run).toMatchObject({ status: "done", summary: { proposed: 3 } });
    // Only the second is drafted again: the first was done, the third already proposed.
    expect(writer.calls).toHaveLength(1);
    const keys = (await proposals()).map((p) =>
      [p.goal, p.kind, p.entityId, p.field, p.locale].join("|"),
    );
    expect(keys.sort()).toEqual([...gaps].sort());
  });

  it("plans at most its item limit", async () => {
    await switchOn();
    const gaps = await hookGaps(3);
    const view = await ended(await started({ goals: ["translations"], maxItems: 2 }));
    expect(view.items.map((i) => i.key)).toEqual(gaps.slice(0, 2));
  });

  it("stops at its own spend limit before an item as dear as its dearest would cross it", async () => {
    await switchOn();
    await hookGaps(3);
    // Each draft costs about $0.03 at this model's price: after the first, $0.03 spent is under
    // the $0.05 limit, but another as dear would make $0.06.
    writer = drafting(answers, { tokens: 100_000 });
    const view = await ended(await started({ goals: ["translations"], maxUsd: 0.05 }));
    expect(view.run).toMatchObject({ status: "failed", error: RUN_LIMIT });
    expect(view.items.map((i) => i.status)).toEqual(["done", "pending", "pending"]);
    // The limit is the run's: a resume stops at it again.
    expect((await admin.post(`/admin/assistant/runs/${view.run.id}/resume`, {})).status).toBe(202);
    const again = await ended(view.run.id);
    expect(again.run).toMatchObject({ status: "failed", error: RUN_LIMIT });
    expect(writer.calls).toHaveLength(1);
  });

  it("stops when the models are down, resumable; an item failing twice needs the admin", async () => {
    await switchOn();
    const [hook] = await hookGaps(1);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    writer = {
      model: new MockLanguageModelV4({ doGenerate: () => Promise.reject(apiError(503)) }),
      calls: [],
    };
    const first = await ended(await started({ goals: ["translations"] }));
    expect(first.run.status).toBe("failed");
    expect(first.run.error).toMatch(/stopped answering/);
    expect(first.items).toEqual([
      expect.objectContaining({ key: hook, status: "unavailable", attempts: 1 }),
    ]);

    resetBreakers();
    expect((await admin.post(`/admin/assistant/runs/${first.run.id}/resume`, {})).status).toBe(202);
    const second = await ended(first.run.id);
    expect(second.run).toMatchObject({
      status: "done",
      summary: { proposed: 0, needsYou: 1, stale: 0 },
    });
    expect(await proposals()).toEqual([
      expect.objectContaining({ status: "needs_you", after: null, notes: [DRAFTED_TWICE] }),
    ]);
  });

  it("survives a restart: the draft cut off is drafted again, and never counts as a failure", async () => {
    await switchOn();
    const [hook] = await hookGaps(1);
    const held = drafting(answers, { hold: () => true, abortable: true });
    writer = held;
    const id = await started({ goals: ["translations"] });
    await eventually(async () => (held.calls.length === 1 ? true : undefined));
    // A deploy's SIGTERM: every run in this process stops, its draft in flight with it.
    abortAllRuns();
    const cut = await ended(id);
    expect(cut.run.status).toBe("interrupted");
    expect(cut.items).toEqual([
      expect.objectContaining({ key: hook, status: "pending", attempts: 1 }),
    ]);
    expect(await proposals()).toEqual([]);

    // Resumed with the models answering: drafted, not handed over as failing twice.
    writer = drafting(answers);
    expect((await admin.post(`/admin/assistant/runs/${id}/resume`, {})).status).toBe(202);
    const resumed = await ended(id);
    expect(resumed.run).toMatchObject({ status: "done", summary: { proposed: 1, needsYou: 0 } });
    expect(await proposals()).toEqual([
      expect.objectContaining({ status: "proposed", after: "Suche, die mit Quellen antwortet." }),
    ]);
  });

  it("counts only the models' failures: cut off by a restart, then down once, the item is unavailable and the run stops", async () => {
    await switchOn();
    const [hook] = await hookGaps(1);
    const held = drafting(answers, { hold: () => true, abortable: true });
    writer = held;
    const id = await started({ goals: ["translations"] });
    await eventually(async () => (held.calls.length === 1 ? true : undefined));
    abortAllRuns();
    expect((await ended(id)).run.status).toBe("interrupted");

    // Its second start meets the models down: a first failure, not a second.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    writer = {
      model: new MockLanguageModelV4({ doGenerate: () => Promise.reject(apiError(503)) }),
      calls: [],
    };
    expect((await admin.post(`/admin/assistant/runs/${id}/resume`, {})).status).toBe(202);
    const down = await ended(id);
    expect(down.run).toMatchObject({ status: "failed" });
    expect(down.run.error).toMatch(/stopped answering/);
    expect(down.items).toEqual([
      expect.objectContaining({
        key: hook,
        status: "unavailable",
        attempts: 2,
        result: { unavailable: true, failures: 1 },
      }),
    ]);
    expect(await proposals()).toEqual([]);
  });

  it("records the calls an aborted draft made before it stopped", async () => {
    await switchOn();
    await hookGaps(1);
    // The first draft is English (refused by the language gate); its repair is held, then cut off.
    const held = drafting(
      (sent) =>
        sent.includes("That draft failed") ? "Suche." : "Search that answers with sources.",
      { hold: (sent) => sent.includes("That draft failed"), abortable: true },
    );
    writer = held;
    const id = await started({ goals: ["translations"] });
    await eventually(async () => (held.calls.length === 2 ? true : undefined));
    abortAllRuns();
    expect((await ended(id)).run.status).toBe("interrupted");
    // The first draft's call was paid for: it is in the agent's spend.
    await eventually(async () => {
      const spent = await getDb().select().from(aiUsageFeatures);
      return spent.some((r) => r.feature === "agent" && r.requests >= 1) ? true : undefined;
    });
    expect(await proposals()).toEqual([]);
  });

  it("stops between items once its cap is reached, resumable", async () => {
    await switchOn({ agent: 0.0000001 });
    await hookGaps(2);
    const view = await ended(await started({ goals: ["translations"] }));
    expect(view.run.status).toBe("failed");
    expect(view.run.error).toMatch(/its own daily cap/);
    expect(view.items.map((i) => i.status)).toEqual(["done", "pending"]);
  });

  it("drafts nothing it cannot, and says why: a source too long, an image it cannot read, no model that sees", async () => {
    await switchOn();
    const [projectId] = await projectIds();
    await setText(projectId!, "en", { body: `<p>${"Wort ".repeat(4_100)}</p>` });
    await setText(projectId!, "de", { body: "" });
    const [image] = await getDb()
      .insert(mediaAssets)
      .values({
        filename: `${randomBytes(8).toString("hex")}.png`,
        originalName: "diagram.png",
        mime: "image/png",
        byteSize: 10,
        checksumSha256: randomBytes(32),
        altDe: "Ein Diagramm.",
      })
      .returning({ id: mediaAssets.id });

    await ended(await started({ goals: ["translations", "alt"] }));
    expect(writer.calls).toHaveLength(0);
    const notes = Object.fromEntries((await proposals()).map((p) => [p.goal, p]));
    expect(notes["translations"]).toMatchObject({ status: "needs_you", after: null });
    expect(notes["translations"]!.notes[0]).toMatch(/more than one draft takes/);
    expect(notes["alt"]).toMatchObject({
      entityId: image!.id,
      status: "needs_you",
      notes: ["Its file could not be read: write the alt text in the media library."],
    });

    // No model of the chain reads images.
    await getDb().delete(aiProposals);
    writerId = "vendor/text-only";
    await ended(await started({ goals: ["alt"] }));
    expect(await proposals()).toEqual([
      expect.objectContaining({
        notes: ["No model of the copilot's chain can take it: it needs one that reads images."],
      }),
    ]);
  });

  it("hands over a target whose every draft came back empty", async () => {
    await switchOn();
    await hookGaps(1);
    writer = drafting(() => "");
    await ended(await started({ goals: ["translations"] }));
    expect(await proposals()).toEqual([
      expect.objectContaining({
        status: "needs_you",
        after: null,
        notes: ["Every draft came back empty (a safety filter, maybe): draft it in the editor."],
      }),
    ]);
  });

  it("keeps a second reading's notes with a long translation's proposal", async () => {
    await switchOn();
    const [projectId] = await projectIds();
    const english =
      "Atlas answers support questions from two million documents and cites every source it uses, so the team can check each answer quickly and trust what the assistant says to customers every day.";
    const german =
      "Atlas beantwortet Supportfragen aus zwei Millionen Dokumenten und nennt jede Quelle, die es nutzt, damit das Team jede Antwort schnell prüfen und dem vertrauen kann, was der Assistent den Kunden jeden Tag sagt.";
    await setText(projectId!, "en", { hook: english });
    await setText(projectId!, "de", { hook: "" });
    writer = drafting((sent) =>
      sent.includes("A reviewer read your translation")
        ? german.replace("Supportfragen", "Support-Fragen")
        : german,
    );
    judge = replying(() =>
      JSON.stringify({
        ok: false,
        problems: ["“Supportfragen” reads better as “Support-Fragen”."],
      }),
    );
    await ended(await started({ goals: ["translations"] }));
    expect(await proposals()).toEqual([
      expect.objectContaining({
        status: "proposed",
        after: german.replace("Supportfragen", "Support-Fragen"),
        notes: ["A second reading changed it: “Supportfragen” reads better as “Support-Fragen”."],
      }),
    ]);
  });

  it("refuses a run with no copilot model, or an input that mixes in a replay's", async () => {
    await switchOn();
    await hookGaps(1);
    writerId = null;
    const none = await start({ goals: ["translations"] });
    expect(none.status).toBe(400);
    expect(await none.json()).toEqual({ error: "no_chain" });
    writerId = "gemini-3.5-flash-lite";
    const mixed = await start({
      goals: ["translations"],
      entry: "00000000-0000-4000-8000-000000000001",
    });
    expect(mixed.status).toBe(400);
    expect(await mixed.json()).toEqual({ error: "invalid_input" });
  });

  it("lists the proposals, by run and by status", async () => {
    await switchOn();
    await hookGaps(1);
    const [projectId] = await projectIds();
    await setText(projectId!, "de", { seoDescription: "" });
    await setText(projectId!, "en", { seoDescription: "" });
    const id = await started({ goals: ["translations", "seo"] });
    await ended(id);

    const all = (await (await admin.get(`/admin/assistant/proposals?run=${id}`)).json()) as {
      proposals: { status: string; label: string }[];
    };
    expect(all.proposals).toHaveLength(3);
    const needing = (await (
      await admin.get("/admin/assistant/proposals?status=needs_you")
    ).json()) as {
      proposals: { status: string }[];
    };
    expect(needing.proposals.map((p) => p.status)).toEqual(["needs_you", "needs_you"]);
    expect((await admin.get("/admin/assistant/proposals?run=nope")).status).toBe(400);
    expect((await admin.get("/admin/assistant/proposals?status=done")).status).toBe(400);
  });

  it("keeps one proposal per target and run, in a known status (migration 0024)", async () => {
    const db = getDb();
    const [run] = await db
      .insert(aiRuns)
      .values({ kind: "agent", status: "done", params: { task: "content" } })
      .returning({ id: aiRuns.id });
    const row = {
      runId: run!.id,
      goal: "translations" as const,
      kind: "project" as const,
      entityId: "p",
      field: "hook",
      locale: "de" as const,
      label: "P · Hook (DE)",
      skill: "translate",
      version: "v",
      status: "proposed" as const,
    };
    const id = await insertProposal({ ...row, after: "Erster Entwurf." });
    // The same target again in the same run: the first proposal stays.
    expect(await insertProposal({ ...row, after: "Zweiter Entwurf." })).toBe(id);
    expect(await proposals()).toEqual([
      expect.objectContaining({ id, after: "Erster Entwurf.", before: "", flags: [], notes: [] }),
    ]);
    await expect(
      db.insert(aiProposals).values({ ...row, status: "done" as never }),
    ).rejects.toThrow();
    await expect(
      db.insert(aiProposals).values({ ...row, goal: "typos" as never }),
    ).rejects.toThrow();
    // The run deleted, its proposals stay.
    await db.delete(aiRuns).where(eq(aiRuns.id, run!.id));
    expect(await proposals()).toEqual([expect.objectContaining({ id, runId: null })]);
  });
});
