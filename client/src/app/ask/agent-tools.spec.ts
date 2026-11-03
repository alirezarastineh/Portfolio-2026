import { signal } from "@angular/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { agentTools, type AgentStore } from "./agent-tools";
import type { AskMessage, Entry, RemoteConfig } from "./ask-types";
import type { MapPage } from "./portfolio-map";

const ON: RemoteConfig = {
  state: "ok",
  deep: true,
  suggestions: {},
  limits: { maxChars: 600, historyTurns: 8 },
  model: "m",
  match: true,
};

const PAGES: MapPage[] = [
  { id: "project:atlas@en", kind: "project", title: "Atlas", url: "/en/work/atlas", related: [] },
  { id: "profile@en", kind: "profile", title: "About", url: "/en#about", related: [] },
];

/** A store whose answers land a moment after the entry, as the chat's do. */
function setup(
  remote: RemoteConfig | null = ON,
  parts: unknown[] = [{ type: "text", text: "Hi." }],
) {
  const entries = signal<Entry[]>([]);
  const chat = { status: "ready", messages: [] as AskMessage[] };
  const reply = (input: string) => {
    const userId = `user-${entries().length}-0000`;
    entries.update((list) => [
      ...list,
      { id: `e${list.length}`, kind: "ask", input, userId, deep: false },
    ]);
    return Promise.resolve().then(() => {
      chat.messages = [
        ...chat.messages,
        { id: userId, role: "user", parts: [{ type: "text", text: input }] },
        { id: `answer-${userId}`, role: "assistant", parts } as AskMessage,
      ];
    });
  };
  const store = {
    chat,
    entries,
    remote: signal(remote),
    askQuestion: vi.fn(reply),
    sendMatch: vi.fn((kind: string) => reply(`match ${kind}`)),
    messageFor: vi.fn(() => "Failed."),
  };
  const navigate = vi.fn(() => Promise.resolve(true));
  const tools = agentTools({
    store: store as unknown as AgentStore,
    locale: () => "en",
    navigate,
    pages: () => Promise.resolve(PAGES),
  });
  const run = (name: string, args: Record<string, unknown> = {}) =>
    tools
      .find((t) => t.name === name)!
      .execute(args, { signal: new AbortController().signal }) as Promise<string>;
  return { store, chat, navigate, tools, run };
}

afterEach(() => {
  delete (globalThis as { umami?: unknown }).umami;
});

describe("agentTools (plan 3 W6)", () => {
  it("declares the spending tools only while their feature is on", () => {
    const names = (remote: RemoteConfig | null) => setup(remote).tools.map((t) => t.name);
    expect(names(ON)).toEqual(["list_pages", "open_page", "ask_portfolio", "match_brief"]);
    expect(names({ ...ON, match: false })).toEqual(["list_pages", "open_page", "ask_portfolio"]);
    expect(names({ ...ON, state: "resting" })).toEqual(["list_pages", "open_page", "match_brief"]);
    expect(names(null)).toEqual(["list_pages", "open_page"]);
    for (const tool of setup().tools) {
      expect(tool.name.length, tool.name).toBeLessThanOrEqual(30);
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(500);
    }
  });

  it("lists the map's pages, and opens only a path it lists; Umami gets the tool's name only", async () => {
    const umami = { track: vi.fn() };
    (globalThis as { umami?: unknown }).umami = umami;
    const { run, navigate } = setup();
    expect(await run("list_pages")).toBe(
      "/en/work/atlas · project · Atlas\n/en#about · profile · About",
    );
    for (const path of ["/en/work/other", "https://evil.example/", "/\\evil.example", 7]) {
      expect(await run("open_page", { path })).toContain("Not one of the site's pages");
    }
    expect(navigate).not.toHaveBeenCalled();
    expect(await run("open_page", { path: "/en/work/atlas" })).toBe(
      'Opened "Atlas" (/en/work/atlas).',
    );
    expect(navigate).toHaveBeenCalledWith("/en/work/atlas");
    expect(umami.track).toHaveBeenCalledWith("agent_tool", { tool: "open_page" });
  });

  it("asks 'reset' and 'yes' as questions, never as commands, and returns the answer with its sources", async () => {
    const { run, store } = setup(ON, [
      { type: "text", text: "It is **Atlas**.[^p1]" },
      { type: "source-url", sourceId: "p1", url: "/en/work/atlas", title: "Atlas" },
    ]);
    expect(await run("ask_portfolio", { question: " reset " })).toBe(
      "It is Atlas.\nSources:\n- Atlas: /en/work/atlas",
    );
    await run("ask_portfolio", { question: "yes" });
    expect(store.askQuestion.mock.calls).toEqual([["reset"], ["yes"]]);
  });

  it("refuses while an answer streams, and a question or brief over its limit", async () => {
    const { run, store, chat, navigate } = setup();
    expect(await run("ask_portfolio", { question: "x".repeat(601) })).toBe(
      "Too long: at most 600 characters.",
    );
    expect(await run("match_brief", { kind: "role", brief: "x".repeat(4_001) })).toContain(
      "1 to 4000",
    );
    expect(await run("match_brief", { kind: "job", brief: "A role." })).toContain(
      "role, project or problem",
    );
    chat.status = "streaming";
    expect(await run("ask_portfolio", { question: "Who?" })).toContain("still answering");
    expect(await run("match_brief", { kind: "role", brief: "A role." })).toContain(
      "still answering",
    );
    expect(store.askQuestion).not.toHaveBeenCalled();
    expect(store.sendMatch).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps every output within 1,500 characters, the answer's sources whole", async () => {
    const source = { type: "source-url", sourceId: "p1", url: "/en/work/atlas", title: "Atlas" };
    const { run } = setup(ON, [{ type: "text", text: "word ".repeat(1_000) }, source]);
    const out = await run("ask_portfolio", { question: "Tell me everything." });
    expect(out.length).toBeLessThanOrEqual(1_500);
    expect(out).toContain(
      "(cut: the site's terminal shows it whole)\nSources:\n- Atlas: /en/work/atlas",
    );
  });

  it("runs a brief on the match page and returns each point's status; with match off, nothing goes", async () => {
    const rows = [
      { n: 1, text: "Retrieval (must)", status: "evidence", statusLabel: "✓ evidence", cites: [] },
      {
        n: 2,
        text: "Embedded C",
        status: "not-published",
        statusLabel: "not published",
        cites: [],
      },
    ];
    const { run, store, navigate } = setup(ON, [
      { type: "text", text: "Evidence for 1 of 2." },
      { type: "data-match", data: { v: 1, kind: "role", items: rows } },
    ]);
    expect(await run("match_brief", { kind: "role", brief: " A role. " })).toBe(
      "Checked; the user sees the table on /en/match.\n1. Retrieval (must): evidence\n2. Embedded C: not-published",
    );
    expect(navigate).toHaveBeenCalledWith("/en/match");
    expect(store.sendMatch).toHaveBeenCalledWith("role", "A role.", "agent");

    // Switched off after the tools were declared (the trust monitor's demotion).
    store.remote.set({ ...ON, match: false });
    expect(await run("match_brief", { kind: "role", brief: "A role." })).toContain("switched off");
    expect(store.sendMatch).toHaveBeenCalledTimes(1);
  });
});
