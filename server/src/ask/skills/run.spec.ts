import { describe, expect, it, vi } from "vitest";
import type { LanguageModelV4CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";

import { fixtureConfig, fixtureCorpus } from "../../test/ask-fixtures.js";
import { type Reply, replying } from "../../test/ask-models.js";
import { MAX_DRAFTS, rankInstructions, repairNote, revisionNote, STOPS } from "./protocol.js";
import { copilotInput, skillFor } from "./registry.js";
import { runSkill } from "./run.js";
import { SkillAnswer, type SkillJob } from "./skill.js";

const answering = (reply: (sent: string, call: number) => Reply) => replying(reply);

/** A model whose every call fails before it writes anything. */
const broken = (id = "broken") =>
  new MockLanguageModelV4({ modelId: id, doGenerate: () => Promise.reject(new Error("down")) });

const sent = (call: LanguageModelV4CallOptions | undefined) => JSON.stringify(call?.prompt);

async function jobFor(input: Record<string, unknown>): Promise<SkillJob> {
  const parsed = copilotInput.parse(input);
  const job = await skillFor(parsed.task).request(parsed, {
    config: fixtureConfig(),
    corpus: async () => fixtureCorpus(),
    image: async () => ({ ok: false, error: "not_found" }),
  });
  if (job instanceof SkillAnswer) throw new Error("no job");
  return job;
}

const html = {
  task: "translate",
  text: "<p>Hello <strong>world</strong></p>",
  from: "en",
  to: "de",
  html: true,
};
const verdict = (better: "1" | "2" | "tie") => JSON.stringify({ better, reason: "because" });
const LONG =
  "Built a retrieval system over two million documents with pgvector, cut support escalations by 38 % in a year, and moved the team from weekly releases to shipping several times a day.";
const LONG_DE =
  "Baute ein Retrievalsystem über zwei Millionen Dokumente mit pgvector, senkte die Support-Eskalationen in einem Jahr um 38 % und brachte das Team von wöchentlichen Releases zu mehreren am Tag.";

describe("running a skill (plan phase 28)", () => {
  it("repairs a draft from its exact failures, with the rejected draft in the conversation", async () => {
    const writer = answering((_s, call) =>
      call === 1 ? "<p>Hallo <strong>Welt</p>" : "<p>Hallo <strong>Welt</strong></p>",
    );
    const run = await runSkill({ writer: writer.model, judge: null }, await jobFor(html));
    expect(run).toMatchObject({
      text: "<p>Hallo <strong>Welt</strong></p>",
      failures: [],
      repairs: 1,
      critic: null,
    });
    expect(writer.calls).toHaveLength(2);
    const second = sent(writer.calls[1]);
    // The rejected draft as the model's turn, then the failure in so many words.
    expect(second).toContain("Hallo <strong>Welt</p>");
    expect(second).toContain("missing </strong>");
    expect(repairNote([{ gate: "tags", message: "missing </strong>" }])).toBe(
      "That draft failed these checks:\n- missing </strong>\nWrite it again: fix exactly these and change nothing else. Return only the text.",
    );
  });

  it("returns the best of three failing drafts, with what it still fails", async () => {
    // Failing gates, by draft: tags and numbers; tags; tags, numbers and the language.
    const drafts = [
      "<p>Hallo Welt 2",
      "<p>Hallo <strong>Welt</strong>",
      "Hello world, my friend, 3",
    ];
    const writer = answering((_s, call) => drafts[call - 1]!);
    const run = await runSkill({ writer: writer.model, judge: null }, await jobFor(html));
    expect(writer.calls).toHaveLength(MAX_DRAFTS);
    expect(run.text).toBe("<p>Hallo <strong>Welt</strong>");
    expect(run.failures).toEqual([{ gate: "tags", message: "missing </p>" }]);
    expect(run.repairs).toBe(2);
  });

  it("never cuts a draft over the field's limit: it returns whole, with the limit named", async () => {
    const long = "Eine Übersetzung, die viel zu lang für dieses Feld ist und weitergeht.";
    const writer = answering(() => long);
    const run = await runSkill(
      { writer: writer.model, judge: null },
      await jobFor({
        task: "translate",
        text: "A translation too long.",
        from: "en",
        to: "de",
        maxLength: 40,
      }),
    );
    expect(run.text).toBe(long);
    expect(run.failures).toContainEqual({
      gate: "length",
      message: `${long.length - 40} characters over the limit of 40`,
    });
  });

  it("flags a draft the model cut at its output limit, and asks for no repair", async () => {
    const cut = "Baute ein Retrievalsystem über zwei Millionen Dokumente mit";
    const writer = answering(() => ({ text: cut, stop: "length" }));
    const run = await runSkill(
      { writer: writer.model, judge: null },
      await jobFor({ task: "translate", text: LONG, from: "en", to: "de", critic: false }),
    );
    expect(writer.calls).toHaveLength(1);
    expect(run.text).toBe(cut);
    expect(run.failures[0]).toEqual(STOPS.length);
  });

  it("asks again for an empty draft, and ends a candidate a safety filter stopped", async () => {
    const writer = answering((_s, call) =>
      call === 1 ? "" : "<p>Hallo <strong>Welt</strong></p>",
    );
    const run = await runSkill({ writer: writer.model, judge: null }, await jobFor(html));
    expect(run).toMatchObject({
      text: "<p>Hallo <strong>Welt</strong></p>",
      failures: [],
      repairs: 1,
    });
    // Asked for again as it was: no empty turn, no repair note.
    expect(writer.calls[1]!.prompt).toEqual(writer.calls[0]!.prompt);

    const filtered = answering(() => ({ text: "", stop: "content-filter" }));
    const stopped = await runSkill({ writer: filtered.model, judge: null }, await jobFor(html));
    expect(filtered.calls).toHaveLength(1);
    expect(stopped).toMatchObject({ text: "", failures: [STOPS.filter] });
  });

  it("ranks a draft stopped short below one that fails a gate, and never offers an empty one", async () => {
    const writer = answering((s) =>
      s.includes("its outcome or result")
        ? { text: "Atlas cut support escalations by 38 % with", stop: "length" }
        : s.includes("the problem it solves")
          ? ""
          : "Here is the description: a pgvector system over two million documents, built for support.",
    );
    const run = await runSkill(
      { writer: writer.model, judge: null },
      await jobFor({
        task: "seo",
        text: "<p>Atlas, a retrieval system for support.</p>",
        locale: "en",
      }),
    );
    // The problem lead's three drafts were all empty: not an alternative to put in a field.
    expect(run.candidates.map((c) => c.lead)).toEqual(["stack", "outcome"]);
    expect(run.candidates[1]!.failures[0]).toEqual(STOPS.length);
    // Its retries still count: the stack lead's two repairs and the problem lead's two.
    expect(run.repairs).toBe(4);
    expect(writer.calls).toHaveLength(MAX_DRAFTS + 1 + MAX_DRAFTS);
  });

  it("explores three leads and ranks the passing drafts pairwise, positions swapped", async () => {
    const writer = answering((s) =>
      s.includes("its outcome or result")
        ? "Atlas cut support escalations by 38 % with retrieval over two million documents."
        : s.includes("the problem it solves")
          ? "Support teams drowning in tickets: Atlas answers from two million documents."
          : "Here is the description: a pgvector system over two million documents, built for support.",
    );
    // The judge prefers the problem lead's draft in either position.
    const judge = answering((s) => {
      const [, one = "", two = ""] = s.split(/Draft [12]:/);
      return verdict(one.includes("drowning") ? "1" : two.includes("drowning") ? "2" : "tie");
    });
    const job = await jobFor({
      task: "seo",
      text: "<h2>Atlas</h2><p>Support escalations fell by 38 % with retrieval over two million documents.</p>",
      locale: "en",
    });
    const run = await runSkill({ writer: writer.model, judge: judge.model }, job);

    expect(run.candidates.map((c) => c.lead)).toEqual(["problem", "outcome", "stack"]);
    expect(run.text).toContain("drowning");
    // The stack lead never got past "starts with a preamble": three drafts, flagged, last.
    expect(run.candidates[2]).toMatchObject({ drafts: MAX_DRAFTS, failures: [{ gate: "bare" }] });
    expect(run.repairs).toBe(2);
    // One pair, read twice: each draft shown first once.
    expect(judge.calls).toHaveLength(2);
    const orders = judge.calls.map((call) => {
      const s = sent(call);
      return s.indexOf("drowning") < s.indexOf("cut support") ? "problem first" : "outcome first";
    });
    expect(orders.sort()).toEqual(["outcome first", "problem first"]);
    expect(sent(judge.calls[0])).toContain(
      rankInstructions("a search-result description of the page"),
    );
    expect(sent(judge.calls[0])).toContain("Support escalations fell by 38 %");
  });

  it("counts a judge that changes its mind with the order as a tie, and keeps the leads' order", async () => {
    const writer = answering((s) =>
      s.includes("its outcome or result")
        ? "Atlas cut support escalations by 38 % with retrieval over two million documents."
        : s.includes("the problem it solves")
          ? "Support teams drowning in tickets: Atlas answers from two million documents fast."
          : "Atlas: pgvector retrieval over two million documents for a support team that drowned.",
    );
    // Always the draft shown first: position bias.
    const judge = answering(() => verdict("1"));
    const run = await runSkill(
      { writer: writer.model, judge: judge.model },
      await jobFor({
        task: "seo",
        text: "<p>Atlas, a retrieval system for support.</p>",
        locale: "en",
      }),
    );
    expect(judge.calls).toHaveLength(6);
    expect(run.candidates.map((c) => c.lead)).toEqual(["outcome", "problem", "stack"]);
  });

  it("counts a pair the judge could not read as a tie, and says so in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writer = answering((s) =>
      s.includes("its outcome or result")
        ? "Atlas cut support escalations by 38 % with retrieval over two million documents."
        : s.includes("the problem it solves")
          ? "Support teams drowning in tickets: Atlas answers from two million documents fast."
          : "Atlas: pgvector retrieval over two million documents for a support team that drowned.",
    );
    const run = await runSkill(
      { writer: writer.model, judge: broken() },
      await jobFor({
        task: "seo",
        text: "<p>Atlas, a retrieval system for support.</p>",
        locale: "en",
      }),
    );
    expect(run.candidates.map((c) => c.lead)).toEqual(["outcome", "problem", "stack"]);
    expect(warn).toHaveBeenCalledWith("[copilot] the judge could not compare two drafts", "down");
    warn.mockRestore();
  });

  it("leaves out a lead that could not be drafted, logged, and fails when none could", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writer = answering((s) => {
      if (s.includes("the problem it solves")) throw new Error("down");
      return "Atlas: retrieval over two million documents for support teams.";
    });
    const job = await jobFor({
      task: "seo",
      text: "<p>Atlas, a retrieval system for support.</p>",
      locale: "en",
    });
    const run = await runSkill({ writer: writer.model, judge: null }, job);
    expect(run.candidates.map((c) => c.lead)).toEqual(["outcome", "stack"]);
    expect(warn).toHaveBeenCalledWith("[copilot] the problem lead could not be drafted", "down");
    await expect(runSkill({ writer: broken(), judge: null }, job)).rejects.toThrow("down");
    warn.mockRestore();
  });

  it("lets a cancel through: an aborted judge or critic stops the run, and so do leads cut short (plan phase 29)", async () => {
    const seoWriter = answering((s) =>
      s.includes("its outcome or result")
        ? "Atlas cut support escalations by 38 % with retrieval over two million documents."
        : s.includes("the problem it solves")
          ? "Support teams drowning in tickets: Atlas answers from two million documents fast."
          : "Atlas: pgvector retrieval over two million documents for a support team that drowned.",
    );
    const seoJob = await jobFor({
      task: "seo",
      text: "<p>Atlas, a retrieval system for support.</p>",
      locale: "en",
    });
    /** A model that is cancelled while it answers. */
    const cancelledBy = (controller: AbortController) =>
      new MockLanguageModelV4({
        modelId: "cancelled",
        doGenerate: () => {
          controller.abort(new Error("cancelled"));
          return Promise.reject(new Error("cancelled"));
        },
      });

    const ranking = new AbortController();
    await expect(
      runSkill(
        { writer: seoWriter.model, judge: cancelledBy(ranking), signal: ranking.signal },
        seoJob,
      ),
    ).rejects.toThrow("cancelled");

    const reading = new AbortController();
    const translator = answering(() => LONG_DE);
    await expect(
      runSkill(
        { writer: translator.model, judge: cancelledBy(reading), signal: reading.signal },
        await jobFor({ task: "translate", text: LONG, from: "en", to: "de" }),
      ),
    ).rejects.toThrow("cancelled");

    // One lead done, the others cut off with no judge to ask: no draft to offer either.
    const leads = new AbortController();
    const partial = answering((s) => {
      if (!s.includes("its outcome or result")) {
        leads.abort(new Error("cancelled"));
        throw new Error("cancelled");
      }
      return "Atlas cut support escalations by 38 % with retrieval over two million documents.";
    });
    await expect(
      runSkill({ writer: partial.model, judge: null, signal: leads.signal }, seoJob),
    ).rejects.toThrow("cancelled");
  });

  it("asks no judge with one passing draft, or with no judge chain", async () => {
    const writer = answering((s) =>
      s.includes("its outcome or result")
        ? "Atlas cut support escalations by 38 % with retrieval over two million documents."
        : "Here is the description: Atlas.",
    );
    const judge = answering(() => verdict("1"));
    const job = await jobFor({
      task: "seo",
      text: "<p>Atlas, a retrieval system.</p>",
      locale: "en",
    });
    const run = await runSkill({ writer: writer.model, judge: judge.model }, job);
    expect(judge.calls).toHaveLength(0);
    expect(run.candidates[0]).toMatchObject({ lead: "outcome", failures: [] });

    const plain = answering(() => "Atlas: retrieval over two million documents for support teams.");
    const without = await runSkill({ writer: plain.model, judge: null }, job);
    expect(without.candidates.map((c) => c.lead)).toEqual(["outcome", "problem", "stack"]);
  });

  it("lets the critic read a long translation, and keeps its revision when it passes the gates", async () => {
    const writer = answering((s) =>
      s.includes("A reviewer read your translation")
        ? LONG_DE
        : LONG_DE.replace("senkte die Support-Eskalationen", "senkte die Eskalationen"),
    );
    const critic = answering(() =>
      JSON.stringify({
        ok: false,
        problems: ["“support” was dropped from “support escalations”."],
      }),
    );
    const job = await jobFor({ task: "translate", text: LONG, from: "en", to: "de" });
    const run = await runSkill({ writer: writer.model, judge: critic.model }, job);
    expect(run).toMatchObject({
      text: LONG_DE,
      failures: [],
      critic: { result: "revised", notes: ["“support” was dropped from “support escalations”."] },
    });
    expect(sent(critic.calls[0])).toContain("Source:");
    expect(sent(critic.calls[0])).toContain("meaning lost, changed or added");
  });

  it("refuses a revision that fails a gate, and keeps the draft that passed", async () => {
    const first = LONG_DE;
    const writer = answering((s) =>
      s.includes("A reviewer read your translation") ? LONG_DE.replace("38 %", "40 %") : first,
    );
    const critic = answering(() => JSON.stringify({ ok: false, problems: ["The tone is off."] }));
    const run = await runSkill(
      { writer: writer.model, judge: critic.model },
      await jobFor({ task: "translate", text: LONG, from: "en", to: "de" }),
    );
    expect(run).toMatchObject({ text: first, failures: [], critic: { result: "refused" } });
  });

  it("refuses a revision that could not be written, and keeps the critic's notes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writer = answering((s) => {
      if (s.includes("A reviewer read your translation")) throw new Error("down");
      return LONG_DE;
    });
    const critic = answering(() => JSON.stringify({ ok: false, problems: ["The tone is off."] }));
    const run = await runSkill(
      { writer: writer.model, judge: critic.model },
      await jobFor({ task: "translate", text: LONG, from: "en", to: "de" }),
    );
    expect(run).toMatchObject({
      text: LONG_DE,
      failures: [],
      critic: { result: "refused", notes: ["The tone is off."] },
    });
    expect(sent(writer.calls[1])).toContain(
      JSON.stringify(revisionNote(["The tone is off."])).slice(1, -1),
    );
    expect(warn).toHaveBeenCalledWith("[copilot] the revision could not be written", "down");
    warn.mockRestore();
  });

  it("asks no critic for a short text, when told not to, or about a draft that failed", async () => {
    const critic = answering(() => JSON.stringify({ ok: true, problems: [] }));
    const writer = answering(() => "<p>Hallo <strong>Welt</strong></p>");
    await runSkill({ writer: writer.model, judge: critic.model }, await jobFor(html));
    const told = answering(() => LONG_DE);
    await runSkill(
      { writer: told.model, judge: critic.model },
      await jobFor({ task: "translate", text: LONG, from: "en", to: "de", critic: false }),
    );
    const failing = answering(() => LONG_DE.replace("38 %", "39 %"));
    const run = await runSkill(
      { writer: failing.model, judge: critic.model },
      await jobFor({ task: "translate", text: LONG, from: "en", to: "de" }),
    );
    expect(critic.calls).toHaveLength(0);
    expect(run.critic).toBeNull();
    expect(run.failures[0]).toMatchObject({ gate: "numbers" });

    const ok = answering(() => LONG_DE);
    const read = await runSkill(
      { writer: ok.model, judge: critic.model },
      await jobFor({ task: "translate", text: LONG, from: "en", to: "de" }),
    );
    expect(read.critic).toEqual({ result: "ok", notes: [] });
  });

  it("leaves a draft unchecked when the critic fails, and says so in the log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const writer = answering(() => LONG_DE);
    const run = await runSkill(
      { writer: writer.model, judge: broken() },
      await jobFor({ task: "translate", text: LONG, from: "en", to: "de" }),
    );
    expect(run).toMatchObject({ text: LONG_DE, critic: null });
    expect(warn).toHaveBeenCalledWith("[copilot] the critic could not read the draft", "down");
    warn.mockRestore();
  });

  it("checks an FAQ answer's citations and figures, and gives it without the markers", async () => {
    const writer = answering((_s, call) =>
      call === 1
        ? "Atlas cut escalations by 40 % [^project:atlas@en]."
        : "Atlas cut escalations by 38 % [^project:atlas@en].",
    );
    const run = await runSkill(
      { writer: writer.model, judge: null },
      await jobFor({ task: "faq-answer", question: "What did Atlas achieve?", locale: "en" }),
    );
    expect(sent(writer.calls[1])).toContain("states 40, which no cited document does");
    expect(run).toMatchObject({ text: "Atlas cut escalations by 38 %.", failures: [], repairs: 1 });
  });
});
