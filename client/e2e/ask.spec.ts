import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";

import { askPanel, expect, interactive, settled, test } from "./fixtures";

/**
 * The portfolio assistant, in its panel on every page. The API is cross-origin in
 * the build (`VITE_API_BASE_URL`), so its answers are mocked here with CORS
 * and a preflight, as an AI SDK UI message stream (server-sent events).
 */

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST",
};

type Chunk = Record<string, unknown>;

function stream(chunks: Chunk[]): string {
  return [...chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`), "data: [DONE]\n\n"].join("");
}

function answer(options: {
  id?: string;
  text: string;
  tools?: Chunk[];
  sources?: Chunk[];
  followups?: string[];
}): Chunk[] {
  const id = options.id ?? "m_e2e00000001";
  return [
    { type: "start", messageId: id, messageMetadata: { createdAt: Date.now() } },
    { type: "start-step" },
    ...(options.tools ?? []),
    ...(options.sources ?? []),
    { type: "text-start", id: "t1" },
    ...options.text.split(/(?<= )/).map((delta) => ({ type: "text-delta", id: "t1", delta })),
    { type: "text-end", id: "t1" },
    ...(options.followups
      ? [
          { type: "tool-input-start", toolCallId: "f1", toolName: "suggest_followups" },
          {
            type: "tool-input-available",
            toolCallId: "f1",
            toolName: "suggest_followups",
            input: { items: options.followups },
          },
          { type: "tool-output-available", toolCallId: "f1", output: { ok: true } },
        ]
      : []),
    { type: "finish-step" },
    {
      type: "finish",
      finishReason: "stop",
      messageMetadata: {
        sig: "signed",
        model: "gemini-3.5-flash-lite",
        fallback: false,
        route: "lite",
        totalMs: 1300,
        tokens: { input: 10_000, cached: 9_100, output: 60 },
      },
    },
  ];
}

/** An answer whose finish carries the server's receipt (visitor plan V12). */
function withReceipt(chunks: Chunk[], receipt: Record<string, unknown>): Chunk[] {
  return chunks.map((chunk) =>
    chunk["type"] === "finish"
      ? {
          ...chunk,
          messageMetadata: {
            ...(chunk["messageMetadata"] as Chunk),
            ...(receipt["escalation"] ? { route: "deep" } : {}),
            receipt,
          },
        }
      : chunk,
  );
}

/** What `POST /v1/ask/inspect` answers for the first answer: the server's projection. */
const INSPECTED = {
  v: 1,
  id: "m_e2e00000001",
  at: "2026-10-22T14:03:00.000Z",
  prompt: "ask-2026-10-22.1+982317ef9de8",
  route: "lite",
  reason: "default",
  model: "gemini-3.1-flash-lite",
  ttftMs: 6_640,
  totalMs: 7_900,
  steps: [
    {
      model: "gemini-3.1-flash-lite",
      ttftMs: 640,
      tokens: { input: 9_000, cached: 8_000, output: 60 },
      passedOver: [{ model: "gemini-3.5-flash-lite", outcome: "timeout", ms: 6_000 }],
      tools: [{ name: "search_portfolio", input: "evals", outcome: "ok", chars: 812 }],
    },
  ],
  citations: { kept: ["project:project-one@en"], removed: 0 },
  guard: {},
  flags: ["degraded"],
};

/** What `GET /v1/ask/scorecard` answers while published (visitor plan V13). */
const SCORECARD = {
  v: 1,
  prompt: "ask-2026-10-22.1+982317ef9de8",
  recorded: {
    measured: true,
    at: "2026-10-22T15:18:24.510Z",
    cases: 84,
    completed: 84,
    passed: 76,
    passRate: 76 / 84,
    judge: "gemini-3.5-flash-lite",
    categories: [
      { name: "fact", cases: 18, completed: 18, passed: 14 },
      { name: "page", cases: 5, completed: 5, passed: 5 },
    ],
  },
  live: {
    days: 30,
    minimum: 20,
    answers: 51,
    unanswered: { share: 4 / 55, n: 55 },
    citationsVerified: { share: 0.96, n: 40 },
    repaired: { share: 0.02, n: 51 },
    figuresFlagged: null,
    firstWordMs: { median: 1_800, n: 30 },
    refusals: { invalid_input: 16, rate_limited: 2 },
  },
  judge: null,
  at: "2026-10-22T20:00:00.000Z",
};

/** What `GET /v1/ask/map?locale=en` answers for the fixture content (visitor plan V15). */
const MAP_EN = {
  v: 1,
  locale: "en",
  pages: [
    { id: "profile@en", kind: "profile", title: "Alireza", url: "/en", related: [] },
    {
      id: "experience:senior@en",
      kind: "experience",
      title: "Senior AI Engineer — Example GmbH",
      url: "/en#experience",
      updated: "2026-10-22",
      related: ["project:project-one@en"],
    },
    {
      id: "project:project-one@en",
      kind: "project",
      title: "Atlas",
      url: "/en/work/project-one",
      updated: "2026-10-01",
      related: ["experience:senior@en", "project:project-two@en"],
    },
    {
      id: "project:project-two@en",
      kind: "project",
      title: "Supplier catalogue ingestion",
      url: "/en/work/project-two",
      updated: "2026-09-01",
      related: ["project:project-one@en"],
    },
    {
      id: "post:shipping-rag-to-production@en",
      kind: "post",
      title: "Shipping RAG to production",
      url: "/en/writing/shipping-rag-to-production",
      updated: "2026-09-02",
      related: ["project:project-one@en"],
    },
    {
      id: "post:notes-on-evals@en",
      kind: "post",
      title: "Notes on evals",
      url: "/en/writing/notes-on-evals",
      updated: "2026-07-03",
      related: [],
    },
  ],
};

/** The map, with each request's language kept. */
async function mockMap(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route(
    (url) => url.pathname.endsWith("/v1/ask/map"),
    async (route) => {
      asked.push(new URL(route.request().url()).searchParams.get("locale") ?? "");
      await route.fulfill({ headers: cors, json: MAP_EN });
    },
  );
  return asked;
}

const SEARCH_STEP: Chunk[] = [
  { type: "tool-input-start", toolCallId: "s1", toolName: "search_portfolio" },
  {
    type: "tool-input-available",
    toolCallId: "s1",
    toolName: "search_portfolio",
    input: { query: "evals" },
  },
  { type: "tool-output-available", toolCallId: "s1", output: { results: [] } },
];

interface AskMock {
  bodies: {
    sessionId: string;
    locale: string;
    page?: string;
    level?: string;
    messages: { role: string }[];
  }[];
}

async function mockAsk(
  page: Page,
  respond: (route: Route, n: number) => Promise<void> | void,
  config: Record<string, unknown> = {},
): Promise<AskMock> {
  const mock: AskMock = { bodies: [] };
  await page.route("**/v1/ask/config", (route) =>
    route.fulfill({
      headers: cors,
      json: {
        state: "ok",
        deep: true,
        suggestions: { en: [], de: [] },
        limits: { maxChars: 600, historyTurns: 8 },
        model: "gemini-3.5-flash-lite",
        ...config,
      },
    }),
  );
  await page.route("**/v1/ask", async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    mock.bodies.push(route.request().postDataJSON());
    await respond(route, mock.bodies.length);
  });
  return mock;
}

function sse(route: Route, chunks: Chunk[]) {
  return route.fulfill({
    status: 200,
    headers: {
      ...cors,
      "content-type": "text/event-stream",
      "x-vercel-ai-ui-message-stream": "v1",
    },
    body: stream(chunks),
  });
}

/**
 * A mocked route delivers its body at once. This streams the answer from the
 * page's own fetch instead, stopping for `pause` ms after chunk `cut`, as a
 * model (or a tool call) does.
 */
async function pausedStream(page: Page, chunks: Chunk[], cut: number, pause: number) {
  await page.addInitScript(
    ({ head, tail, pause }) => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!url.endsWith("/v1/ask") || init?.method !== "POST") return original(input, init);
        const encoder = new TextEncoder();
        const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            // As a real fetch's body: a stop (the signal) ends it with an AbortError.
            let aborted = false;
            init?.signal?.addEventListener("abort", () => {
              aborted = true;
              controller.error(new DOMException("The user aborted a request.", "AbortError"));
            });
            const send = (chunk: unknown) => {
              if (!aborted)
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            };
            for (const chunk of head) {
              send(chunk);
              await wait(50);
            }
            await wait(pause);
            for (const chunk of tail) send(chunk);
            if (aborted) return;
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(body, {
          headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1" },
        });
      };
    },
    { head: chunks.slice(0, cut + 1), tail: chunks.slice(cut + 1), pause },
  );
}

/** A JSON endpoint of the API answering `{ ok: true }`, its preflight included, with each body kept. */
async function recordPosts(page: Page, pattern: string): Promise<Record<string, unknown>[]> {
  const bodies: Record<string, unknown>[] = [];
  await page.route(pattern, async (route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({ headers: cors, json: { ok: true } });
  });
  return bodies;
}

/** The assistant's prompt on home, once its code has loaded. */
/** The panel's prompt, through `/`, which brings it on every page. */
async function openPrompt(page: Page, path = "/en") {
  await page.goto(path);
  await interactive(page);
  await page.keyboard.press("/");
  const prompt = askPanel(page).locator("textarea");
  await expect(prompt).toBeFocused();
  return prompt;
}

async function run(prompt: ReturnType<Page["locator"]>, text: string) {
  await prompt.fill(text);
  await prompt.press("Enter");
}

/**
 * An answer that offers the hand-off, with the confirm and contact calls
 * recorded; returns once the offer is on screen. The model's tool makes the
 * offer, or the server does when the model made none (visitor plan V6): then
 * only the finish's metadata carries it.
 */
async function offerHandoff(page: Page, by: "tool" | "fallback" = "tool") {
  const summary = "Wants to discuss a six-month contract for an AI platform.";
  const tool: Chunk[] = [
    { type: "tool-input-start", toolCallId: "h1", toolName: "handoff_contact" },
    {
      type: "tool-input-available",
      toolCallId: "h1",
      toolName: "handoff_contact",
      input: { summary },
    },
    {
      type: "tool-output-available",
      toolCallId: "h1",
      output: { ok: true, awaitingConfirmation: true },
    },
  ];
  await mockAsk(page, (route) =>
    sse(route, [
      ...answer({ text: "Happy to help you reach him." }).slice(0, -2),
      ...(by === "tool" ? tool : []),
      { type: "finish-step" },
      {
        type: "finish",
        finishReason: by === "tool" ? "tool-calls" : "stop",
        messageMetadata: {
          sig: "s",
          model: "gemini-3.5-flash-lite",
          ...(by === "fallback" ? { handoff: { by, summary } } : {}),
        },
      },
    ]),
  );
  const confirmed: unknown[] = [];
  const sent: unknown[] = [];
  const answerJson = (list: unknown[]) => async (route: Route) => {
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    list.push(route.request().postDataJSON());
    await route.fulfill({ headers: cors, json: { ok: true } });
  };
  await page.route("**/v1/ask/handoff", answerJson(confirmed));
  await page.route("**/contact", answerJson(sent));
  const prompt = await openPrompt(page);
  await run(prompt, "I want to hire him");
  const confirm = page.getByRole("group", {
    name: "Hand this conversation to the contact form?",
  });
  await expect(confirm).toBeVisible();
  return { summary, confirm, confirmed, sent };
}

/** A match's answer as the server streams it: its text, and its rows as data (plan 3 W3). */
function matchChunks(id: string, kind: string, handoff: string): Chunk[] {
  const cite = {
    id: "project:project-two@en",
    title: "Supplier catalogue ingestion",
    url: "/en/work/project-two",
  };
  // The row rests on a timeline entry too: both get a mark (plan 3 W4).
  const entry = {
    id: "experience:11111111-1111-4111-8111-111111111111@en",
    title: "Senior AI Engineer — Example GmbH",
    url: "/en#experience",
  };
  return [
    { type: "data-match-progress", data: { v: 1, step: "plan" }, transient: true },
    { type: "start", messageId: id, messageMetadata: { createdAt: Date.now() } },
    { type: "start-step" },
    { type: "source-url", sourceId: cite.id, url: cite.url, title: cite.title },
    { type: "text-start", id: "match" },
    {
      type: "text-delta",
      id: "match",
      delta: [
        "Published evidence for 1 of 2 requirements; 1 not published.",
        "",
        "- ✓ **Retrieval in production** (must) · evidence: Built a retrieval platform. [^project:project-two@en]",
        "- – **Embedded C** (must) · not published: nothing on his site shows this.",
      ].join("\n"),
    },
    { type: "text-end", id: "match" },
    {
      type: "data-match",
      data: {
        v: 1,
        kind,
        items: [
          {
            n: 1,
            text: "Retrieval in production",
            priorityLabel: "must",
            status: "evidence",
            statusLabel: "evidence",
            summary: "Built a retrieval platform.",
            cites: [cite, entry],
          },
          {
            n: 2,
            text: "Embedded C",
            priorityLabel: "must",
            status: "not-published",
            statusLabel: "not published",
            summary: "nothing on his site shows this.",
            cites: [],
          },
        ],
      },
    },
    { type: "finish-step" },
    {
      type: "finish",
      finishReason: "stop",
      messageMetadata: {
        sig: "signed",
        handoff: { by: "fallback", summary: handoff },
        receipt: { lookups: 2, sources: 1, removed: 0, match: { kind, rows: 2, downgraded: 0 } },
      },
    },
  ];
}

/** The core cases, which the `phone` project runs on a phone too (plan 4 U7). */
const PHONE = { tag: "@phone" };

test.use({ reducedMotion: "reduce" });

test.describe("assistant terminal", () => {
  test("the AI disclosure is in the server-rendered page, under the hero's ask bar (plan 4 U10)", async ({
    page,
    request,
  }) => {
    const html = await (await request.get("/en")).text();
    expect(html).toContain("Answers come from an AI, using this site’s content.");
    // The panel itself (and the AI SDK) loads in the browser only, and About has no terminal.
    expect(html).not.toContain('id="ask-input');
    expect(html).not.toContain("cat philosophy.txt");

    await page.goto("/en");
    await expect(page.locator("#hero")).toContainText(
      "Answers come from an AI, using this site’s content.",
    );
  });

  test("the window's title bar says whether the assistant answers", async ({ page }) => {
    const bar = askPanel(page).locator("header");
    await mockAsk(page, () => undefined);
    await openPrompt(page, "/en/writing");
    await expect(bar).toContainText("online");

    await page.unrouteAll({ behavior: "wait" });
    await mockAsk(page, () => undefined, { state: "resting" });
    await openPrompt(page, "/de/writing");
    await expect(bar).toContainText("pausiert");
  });

  test("the commands are shown, and run without touching what is being typed (plan 4 U11)", async ({
    page,
  }) => {
    await mockAsk(page, () => undefined, { match: true });
    const prompt = await openPrompt(page);
    const panel = askPanel(page);
    const log = panel.locator("[role=log]");
    const commands = panel.getByRole("group", { name: "Commands" }).getByRole("button");
    await expect(commands).toHaveText(["help", "inspect", "evals", "tour", "match"]);

    await prompt.fill("half a question");
    await commands.getByText("help").click();
    await expect(log).toContainText("ls projects");
    await expect(prompt).toHaveValue("half a question");
    await expect(prompt).toBeFocused();

    // help's rows are buttons: one runs, one that needs a word waits in the prompt.
    await log.getByRole("button", { name: "ls skills" }).click();
    await expect(log.getByText("ls skills", { exact: true }).last()).toBeVisible();
    await log.getByRole("button", { name: "cat <project>" }).first().click();
    await expect(prompt).toHaveValue("cat ");
    await expect(prompt).toBeFocused();

    // A usage line offers its choices.
    await run(prompt, "level");
    await log.getByRole("button", { name: "level expert" }).click();
    await expect(log).toContainText("level expert: answers with technical depth");
    await commands.getByText("match").click();
    await log.getByRole("button", { name: "match role", exact: true }).click();
    await expect(panel.getByLabel("Paste the role")).toBeVisible();
  });

  test("the ⋯ menu offers what help lists; Escape closes it, not the panel (plan 4 U11)", async ({
    page,
  }) => {
    await mockAsk(page, () => undefined);
    await openPrompt(page, "/en/writing");
    const panel = askPanel(page);
    const more = panel.getByRole("button", { name: "More" });
    const menu = panel.locator("#ask-menu");

    await more.click();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(panel).toBeVisible();

    await more.click();
    await menu.getByRole("button", { name: "Expert" }).click();
    await expect(menu).toBeHidden();
    await expect(panel.locator("[role=log]")).toContainText("level expert:");
    await more.click();
    await expect(menu.getByRole("button", { name: "Expert" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await menu.getByRole("button", { name: "Delete my conversation" }).click();
    await expect(panel.getByRole("button", { name: "yes" })).toBeVisible();
  });

  test("a new exchange goes to the log's top, which never follows the stream (plan 4 U11)", async ({
    page,
  }) => {
    const long = Array.from({ length: 80 }, (_, i) => `Sentence ${i} of a long answer.`).join(" ");
    await mockAsk(page, (route, n) =>
      sse(route, answer({ id: `m_e2e0000000${n}`, text: long, tools: SEARCH_STEP })),
    );
    const prompt = await openPrompt(page);
    const log = askPanel(page).locator("[role=log]");
    await expect(log).toHaveAttribute("tabindex", "0");

    await run(prompt, "The first question?");
    await expect(log).toContainText("Answered in 1.3 s");
    await run(prompt, "The second question?");
    await expect(log.locator(".latest")).toContainText("Answered in 1.3 s");

    const top = await log.evaluate(
      (el) =>
        el.querySelector(".latest")!.getBoundingClientRect().top - el.getBoundingClientRect().top,
    );
    // The log's own 1rem of air above it.
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(20);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // It overflows, and a keyboard can scroll it.
    expect(await axeViolations(page)).toEqual([]);
  });

  test("only the latest answer keeps its controls; each keeps how it was made (plan 4 U11)", async ({
    page,
  }) => {
    const receipt = { lookups: 1, sources: 0, removed: 0 };
    await mockAsk(page, (route, n) =>
      sse(route, withReceipt(answer({ id: `m_e2e0000000${n}`, text: `Answer ${n}.` }), receipt)),
    );
    const prompt = await openPrompt(page);
    const log = askPanel(page).locator("[role=log]");
    await run(prompt, "One?");
    await expect(log).toContainText("Answer 1.");
    await expect(log.getByRole("button", { name: "Helpful", exact: true })).toHaveCount(1);
    await log.getByRole("button", { name: "Not helpful" }).click();
    await expect(log.getByRole("group", { name: "What was wrong?" })).toBeVisible();

    await run(prompt, "Two?");
    await expect(log).toContainText("Answer 2.");
    await expect(log.getByRole("button", { name: "Helpful", exact: true })).toHaveCount(1);
    await expect(log.getByRole("button", { name: "copy", exact: true })).toHaveCount(1);
    await expect(log.getByRole("group", { name: "What was wrong?" })).toHaveCount(0);
    await expect(log.getByRole("button", { name: "how was this answered?" })).toHaveCount(2);
  });

  test("the admin's suggested questions come first, three at most (plan 4 U11)", async ({
    page,
  }) => {
    await mockAsk(page, () => undefined, {
      suggestions: { en: ["One?", "Two?", "Three?", "Four?"], de: [] },
    });
    await openPrompt(page);
    const starters = askPanel(page).getByRole("group", { name: "Suggested questions" });
    await expect(starters.getByRole("button")).toHaveText(["One?", "Two?", "Three?"]);

    await openPrompt(page, "/de");
    await expect(askPanel(page).getByRole("group").first().getByRole("button")).toHaveCount(3);
    await expect(askPanel(page).getByRole("button", { name: "One?" })).toHaveCount(0);
  });

  test("sending turns into stopping on one button, which keeps the focus (plan 4 U11)", async ({
    page,
  }) => {
    const chunks = answer({ text: "The whole answer.", tools: SEARCH_STEP });
    const cut = chunks.findIndex((c) => c["type"] === "tool-input-available");
    await pausedStream(page, chunks, cut, 3000);
    await mockAsk(page, () => undefined);
    const prompt = await openPrompt(page);
    await prompt.fill("What does he test?");
    const panel = askPanel(page);
    await panel.getByRole("button", { name: "Ask", exact: true }).click();

    const stop = panel.getByRole("button", { name: "Stop" });
    await expect(stop).toBeVisible();
    await stop.click();
    await expect(panel.getByRole("button", { name: "Ask", exact: true })).toBeVisible();
    await expect(panel.locator("[role=log]")).toContainText("(answer interrupted)");
  });

  test("shell commands answer locally, with history and Tab completion", async ({ page }) => {
    const mock = await mockAsk(page, () => undefined);
    const prompt = await openPrompt(page);
    const log = askPanel(page).locator("[role=log]");

    await run(prompt, "help");
    await expect(log).toContainText("ls projects");
    await expect(log).toContainText("Anything else is a question for the AI assistant.");

    await run(prompt, "ls projects");
    await expect(log).toContainText("project-one");

    await prompt.fill("cat project-o");
    await prompt.press("Tab");
    await expect(prompt).toHaveValue("cat project-one");
    await prompt.press("Enter");
    await expect(log.getByRole("link", { name: "case study" })).toHaveAttribute(
      "href",
      "/en/work/project-one",
    );

    await prompt.press("ArrowUp");
    await expect(prompt).toHaveValue("cat project-one");
    await prompt.press("ArrowUp");
    await expect(prompt).toHaveValue("ls projects");

    await prompt.fill("");
    await prompt.press("Control+l");
    await expect(log).not.toContainText("project-one");
    expect(mock.bodies).toHaveLength(0);
  });

  test(
    "a question streams an answer with its tool step, footnote, follow-ups and stats",
    PHONE,
    async ({ page, problems }) => {
      const mock = await mockAsk(page, (route) =>
        sse(
          route,
          answer({
            text: "He runs **evals** before every prompt change [^project:project-one@en].",
            tools: SEARCH_STEP,
            sources: [
              {
                type: "source-url",
                sourceId: "project:project-one@en",
                url: "/en/work/project-one",
                title: "Project one",
              },
            ],
            followups: ["Which stack did he use?"],
          }),
        ),
      );
      const prompt = await openPrompt(page);
      await run(prompt, "stats");
      await run(prompt, "How does he test prompts?");

      const log = askPanel(page).locator("[role=log]");
      await expect(log).toContainText("He runs evals before every prompt change");
      await expect(log).toContainText("Searched “evals”");
      const cite = log.getByRole("link", { name: /sources 1: Project one/ });
      await expect(cite).toHaveAttribute("href", "/en/work/project-one");
      const source = log.getByRole("link", { name: "Project one", exact: true });
      await expect(source).toBeVisible();
      // Pointing at the citation lights up its source.
      const fill = () => source.evaluate((el) => getComputedStyle(el).backgroundColor);
      const resting = await fill();
      await cite.hover();
      await expect.poll(fill).not.toBe(resting);
      await page.mouse.move(0, 0);
      await expect.poll(fill).toBe(resting);
      await expect(log).toContainText("gemini-3.5-flash-lite · 1.3 s · 91% cached");
      // Announced once, in full, without markup or markers.
      await expect(askPanel(page).locator("[aria-live=polite]")).toHaveText(
        "He runs evals before every prompt change.",
      );

      const body = mock.bodies[0]!;
      expect(body.locale).toBe("en");
      expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
      expect(body.messages.map((m) => m.role)).toEqual(["user"]);

      // A follow-up is one click, and carries the signed answer as history.
      await log.getByRole("button", { name: "Which stack did he use?" }).click();
      await expect.poll(() => mock.bodies.length).toBe(2);
      expect(mock.bodies[1]!.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
      expect(problems.cspViolations).toEqual([]);
      expect(problems.pageErrors).toEqual([]);
    },
  );

  test("the browser reports what it saw of an answer, and a thumbs-down says why (visitor plan V2)", async ({
    page,
    context,
    browserName,
  }) => {
    // Only Chromium lets a test grant clipboard access; the others copy without asking.
    if (browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    }
    const FIRST = "m_e2e00000001";
    await mockAsk(page, (route, n) =>
      sse(
        route,
        answer({
          id: `m_e2e0000000${n}`,
          text: "He runs evals before every prompt change [^project:project-one@en].",
          sources: [
            {
              type: "source-url",
              sourceId: "project:project-one@en",
              url: "/en/work/project-one",
              title: "Project one",
            },
          ],
          ...(n === 1 ? { followups: ["Which stack did he use?"] } : {}),
        }),
      ),
    );
    const signals = await recordPosts(page, "**/v1/ask/signal");
    const feedback = await recordPosts(page, "**/v1/ask/feedback");
    const of = (messageId: string) =>
      (signals.filter((s) => s["messageId"] === messageId).at(-1)?.["signals"] ?? {}) as Record<
        string,
        number | boolean
      >;

    const prompt = await openPrompt(page);
    await run(prompt, "How does he test prompts?");
    const log = askPanel(page).locator("[role=log]");
    await expect(log).toContainText("He runs evals before every prompt change");

    // Once the stream is over: when its first word showed, and when it ended.
    await expect.poll(() => typeof of(FIRST)["doneMs"]).toBe("number");
    expect(of(FIRST)["shownMs"]).toBeGreaterThanOrEqual(0);
    expect(of(FIRST)["doneMs"]).toBeGreaterThanOrEqual(of(FIRST)["shownMs"] as number);
    expect(signals[0]).toMatchObject({ sessionId: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/) });

    // A thumbs-down offers three reasons, codes only; the one chosen stays, pressed.
    await log.getByRole("button", { name: "Not helpful" }).first().click();
    const why = page.getByRole("group", { name: "What was wrong?" });
    await expect(why.getByRole("button")).toHaveCount(3);
    await why.getByRole("button", { name: "didn't answer my question" }).click();
    await expect(why.getByRole("button")).toHaveCount(1);
    await expect(why.getByRole("button")).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => feedback.at(-1))
      .toMatchObject({ messageId: FIRST, value: -1, reason: "unanswered" });

    // A copy.
    await log.getByRole("button", { name: "copy", exact: true }).first().click();
    await expect.poll(() => of(FIRST)["copies"]).toBe(1);

    // A follow-up asked from it: counted for this answer, the totals sent whole.
    await log.getByRole("button", { name: "Which stack did he use?" }).click();
    await expect.poll(() => of(FIRST)["followups"]).toBe(1);
    expect(typeof of(FIRST)["doneMs"]).toBe("number");

    // A citation followed counts too, even as it leaves the page.
    await log
      .getByRole("link", { name: /sources 1: Project one/ })
      .first()
      .click();
    await expect.poll(() => of(FIRST)["citations"]).toBe(1);
  });

  test("an answer stopped mid-way says so (visitor plan V2)", async ({ page }) => {
    const chunks = answer({ text: "A long answer that is still being written when it stops." });
    // The stream pauses after its first words, long enough to stop it.
    await pausedStream(page, chunks, 4, 5000);
    await mockAsk(page, () => undefined);
    const signals = await recordPosts(page, "**/v1/ask/signal");

    const prompt = await openPrompt(page);
    await run(prompt, "Tell me everything");
    await expect(askPanel(page).locator("[role=log]")).toContainText("A long");
    await prompt.press("Control+c");

    await expect
      .poll(() => signals.at(-1))
      .toMatchObject({ messageId: "m_e2e00000001", signals: { stopped: true } });
    // Its first words showed while it streamed, well before the stop.
    const { shownMs, doneMs } = signals.at(-1)!["signals"] as { shownMs: number; doneMs: number };
    expect(shownMs).toBeLessThan(doneMs);
  });

  test("an answer shows while it is still streaming", async ({ page }) => {
    // A mocked route delivers its body at once, which hid a bug: the answer
    // showed only after a reload. Here the stream pauses mid-answer, as a
    // model does, and the words so far must already be on screen.
    const chunks = answer({ text: "First words arrive now, the rest a little later." });
    const cut = chunks.findIndex((c) => c["type"] === "text-delta" && c["delta"] === "now, ");
    await pausedStream(page, chunks, cut, 3000);
    await mockAsk(page, () => undefined);
    const prompt = await openPrompt(page);
    await run(prompt, "What is he doing?");

    const log = askPanel(page).locator("[role=log]");
    await expect(log).toContainText("First words arrive now,", { timeout: 2500 });
    await expect(log).not.toContainText("a little later");
    await expect(log).toContainText("First words arrive now, the rest a little later.");
  });

  test("a tool step spins while it runs, then shows its check", async ({ page }) => {
    const chunks = answer({ text: "Found it.", tools: SEARCH_STEP });
    const cut = chunks.findIndex((c) => c["type"] === "tool-input-available");
    await pausedStream(page, chunks, cut, 3000);
    await mockAsk(page, () => undefined);
    const prompt = await openPrompt(page);
    await run(prompt, "What does he test?");

    const step = askPanel(page).locator("[role=log] li", { hasText: "Searched “evals”" });
    const spinner = step.locator(".step-spin");
    await expect(spinner).toBeVisible();
    // Reduced motion: a static ellipsis. Otherwise it spins.
    expect(await spinner.evaluate((el) => getComputedStyle(el, "::after").content)).toBe('"…"');
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await spinner.evaluate((el) => getComputedStyle(el, "::after").animationName)).not.toBe(
      "none",
    );
    // The live trace draws its lines, once: an answer that stands no longer does.
    const drawn = () => step.evaluate((el) => getComputedStyle(el).animationName);
    expect(await drawn()).not.toBe("none");
    await expect(step.locator(".step-done")).toBeVisible();
    await expect(spinner).toHaveCount(0);
    await expect.poll(drawn).toBe("none");
  });

  test(
    "an empty terminal suggests starter questions; one asks at once",
    PHONE,
    async ({ page }) => {
      const mock = await mockAsk(page, (route) =>
        sse(route, answer({ text: "Evals on every prompt change." })),
      );
      const prompt = await openPrompt(page);
      const starters = askPanel(page).getByRole("group", { name: "Suggested questions" });
      await starters.getByRole("button", { name: "How does he test AI features?" }).click();

      const log = askPanel(page).locator("[role=log]");
      await expect(log).toContainText("How does he test AI features?");
      await expect(log).toContainText("Evals on every prompt change.");
      // On a phone the keyboard stays down after a button (plan 4 U9).
      await expect(page.viewportSize()!.width < 1024 ? log : prompt).toBeFocused();
      expect(mock.bodies).toHaveLength(1);
      await expect(starters).toHaveCount(0);

      // Cleared, the terminal is empty again, and suggests them again.
      await prompt.press("Control+l");
      await expect(starters.getByRole("button")).toHaveCount(3);
    },
  );

  test("German pages ask in German", async ({ page }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "Er testet jede Änderung." })),
    );
    const prompt = await openPrompt(page, "/de");
    await run(prompt, "Wie testet er?");
    await expect(askPanel(page).locator("[role=log]")).toContainText("Er testet jede Änderung.");
    expect(mock.bodies[0]!.locale).toBe("de");
  });

  test("while it thinks, the status is read once: its ticking clock is not", async ({ page }) => {
    await pausedStream(page, answer({ text: "Hybrid search." }), 0, 2000);
    await mockAsk(page, () => undefined);
    const prompt = await openPrompt(page);
    await run(prompt, "How does retrieval work?");

    const status = askPanel(page).getByRole("status");
    // Seen: the seconds count up. Heard: no number, so nothing to read again.
    await expect(status).toContainText(/thinking… \d+\.\d s/);
    expect(await status.ariaSnapshot()).not.toMatch(/\d+\.\d s/);
    await expect(askPanel(page).locator("[role=log]")).toContainText("Hybrid search.");
  });

  test("a rate limit shows a countdown, and a failed answer can be retried", async ({ page }) => {
    await mockAsk(page, async (route, n) => {
      if (n === 1) {
        await route.fulfill({
          status: 429,
          headers: cors,
          json: { error: "rate_limited", retryAfter: 42 },
        });
      } else if (n === 2) {
        await sse(route, [
          { type: "start", messageId: "m_e2e00000002" },
          { type: "error", errorText: "timeout" },
        ]);
      } else {
        await sse(route, answer({ id: "m_e2e00000003", text: "Second try worked." }));
      }
    });
    const signals = await recordPosts(page, "**/v1/ask/signal");
    const prompt = await openPrompt(page);
    const log = askPanel(page).locator("[role=log]");

    await run(prompt, "First question");
    await expect(log).toContainText(/try again in 4[0-2]s/);
    // Heard once, from the terminal's live region; the countdown is for the eye
    // (a live region would read it again every second).
    await expect(askPanel(page).locator('[aria-live="polite"]')).toContainText(/try again in 42s/);
    await expect(log.getByRole("status")).toHaveCount(0);

    // Past the limit (the mock does not enforce it; the terminal does).
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    const again = await openPrompt(page, page.url());
    await run(again, "Second question");
    await expect(log).toContainText("That took too long to answer.");
    await log.getByRole("button", { name: /retry/ }).click();
    await expect(log).toContainText("Second try worked.");
    // The answer that came says its question was asked again (visitor plan V2).
    await expect
      .poll(() => signals.filter((s) => s["messageId"] === "m_e2e00000003").at(-1)?.["signals"])
      .toMatchObject({ retries: 1 });
  });

  test("a resting assistant answers from the offline shell and offers contact", async ({
    page,
  }) => {
    const mock = await mockAsk(page, () => undefined, { state: "resting" });
    const prompt = await openPrompt(page);
    await run(prompt, "Which projects has he built?");
    const log = askPanel(page).locator("[role=log]");
    await expect(log).toContainText("The assistant is resting.");
    await expect(log).toContainText("project-one");
    await expect(log).toContainText("type `contact`");
    expect(mock.bodies).toHaveLength(0);
  });

  test("the hand-off to the contact form waits for the visitor's yes", PHONE, async ({ page }) => {
    const { summary, confirm, confirmed, sent } = await offerHandoff(page);
    await expect(page.locator("#contact-message")).toHaveValue("");
    expect(confirmed).toHaveLength(0);

    await confirm.getByRole("button", { name: "yes" }).click();
    await expect(page.locator("#contact-message")).toHaveValue(summary);
    await expect(page.locator("#contact-name")).toBeFocused();
    // The yes is counted; the conversation goes along only if the visitor ticks it.
    await expect.poll(() => confirmed.length).toBe(1);
    expect(confirmed[0]).toEqual({ sessionId: expect.any(String), messageId: expect.any(String) });
    const attach = page.getByLabel("Attach my conversation with the assistant");
    await expect(attach).not.toBeChecked();
    // Never part of the form's WebMCP tool (plan 3 W5): no name, so an agent cannot tick it.
    await expect(attach).not.toHaveAttribute("name");
    await attach.check();
    await page.locator("#contact-name").fill("Ada Lovelace");
    await page.locator("#contact-email").fill("ada@example.com");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ message: summary, origin: "ask", ask: confirmed[0] });
  });

  test("the server's own offer, made when the model made none, is confirmed the same way", async ({
    page,
  }) => {
    const { summary, confirm, confirmed } = await offerHandoff(page, "fallback");
    await expect(askPanel(page).locator("[role=log]")).toContainText(
      "Happy to help you reach him.",
    );
    await confirm.getByRole("button", { name: "yes" }).click();
    await expect(page.locator("#contact-message")).toHaveValue(summary);
    await expect.poll(() => confirmed.length).toBe(1);
    expect(confirmed[0]).toEqual({ sessionId: expect.any(String), messageId: "m_e2e00000001" });
  });

  test("without the tick, the message goes without the conversation", async ({ page }) => {
    const { summary, confirm, sent } = await offerHandoff(page);
    await confirm.getByRole("button", { name: "yes" }).click();
    await expect(page.locator("#contact-message")).toHaveValue(summary);
    await page.locator("#contact-name").fill("Ada Lovelace");
    await page.locator("#contact-email").fill("ada@example.com");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ message: summary, origin: "ask" });
    expect(sent[0]).not.toHaveProperty("ask");
  });

  test("a question asked on home runs on its stage, with its trace, and nothing moves (plan 4 U11b)", async ({
    page,
  }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "He ships evals first.", tools: SEARCH_STEP })),
    );
    await page.goto("/en");
    await interactive(page);
    const stage = page.locator("app-ask-stage section");
    const before = await stage.boundingBox();
    const bar = page.getByRole("textbox", { name: "Ask about my work" });
    await bar.fill("How does he test?");
    await bar.press("Enter");

    const log = stage.locator("[role=log]");
    await expect(log).toContainText("How does he test?");
    await expect(log).toContainText("Searched “evals”");
    await expect(log).toContainText("He ships evals first.");
    await expect(log).toContainText("Answered in 1.3 s");
    await expect(stage.locator("textarea")).toBeFocused();
    expect(mock.bodies).toHaveLength(1);
    expect(await stage.boundingBox()).toEqual(before);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // One prompt and one live region: the light copy is gone, and no panel holds another.
    await expect(page.locator("app-ask-console")).toHaveCount(1);
    await expect(page.locator("#ask-bar")).toHaveCount(0);
    await expect(page.locator("app-ask-console [aria-live=polite]")).toHaveCount(1);
  });

  test("“/” goes to the stage on home, unless typing; a suggestion sends at once (plan 4 U11b)", async ({
    page,
  }) => {
    await mockAsk(page, (route) => sse(route, answer({ text: "Hybrid search." })));
    await page.goto("/en");
    await interactive(page);
    // In the stage's own field, "/" is just a character.
    const bar = page.getByRole("textbox", { name: "Ask about my work" });
    await bar.pressSequentially("a/b");
    await expect(bar).toHaveValue("a/b");
    await expect(askPanel(page)).toBeHidden();
    await bar.blur();

    await page
      .locator("#hero")
      .getByRole("group", { name: "Suggested questions" })
      .getByRole("button", { name: "What has he shipped with RAG?" })
      .click();
    await expect(askPanel(page).locator("[role=log]")).toContainText("Hybrid search.");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(askPanel(page)).toBeVisible();
    await askPanel(page).locator("textarea").blur();
    await page.keyboard.press("/");
    await expect(askPanel(page).locator("textarea")).toBeFocused();
  });

  test("below the stage the button opens the panel, the stage steps back, the page stays (plan 4 U11b)", async ({
    page,
  }) => {
    await mockAsk(page, (route) => sse(route, answer({ text: "Kept in one conversation." })));
    await page.goto("/en");
    await interactive(page);
    const bar = page.getByRole("textbox", { name: "Ask about my work" });
    await bar.fill("One conversation?");
    await bar.press("Enter");
    const stage = page.locator("app-ask-stage");
    await expect(stage).toContainText("Kept in one conversation.");

    await page.locator("#about").scrollIntoViewIfNeeded();
    const fab = page.getByRole("button", { name: "Ask about my work" });
    await expect(fab).toBeVisible();
    const top = await page.evaluate(() => window.scrollY);
    await fab.click();

    const panel = page.getByRole("dialog", { name: "Ask about my work" });
    await expect(panel).toContainText("Kept in one conversation.");
    await expect(panel.locator("textarea")).toBeFocused();
    await expect(stage).toContainText("Continuing in the panel");
    await expect(stage.locator("[role=log]")).toHaveCount(0);
    await expect(page.locator("app-ask-console")).toHaveCount(1);
    await expect(page.locator("app-ask-console [aria-live=polite]")).toHaveCount(1);
    expect(await page.evaluate(() => window.scrollY)).toBe(top);

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    expect(await page.evaluate(() => window.scrollY)).toBe(top);
    await expect(stage).toContainText("Kept in one conversation.");
    await expect(page.locator("app-ask-console")).toHaveCount(1);
  });

  test("leaving home mid-answer continues in the panel; coming back shows it on the stage (plan 4 U11b)", async ({
    page,
  }) => {
    const chunks = answer({ text: "Finished beside the next page.", tools: SEARCH_STEP });
    const cut = chunks.findIndex((c) => c["type"] === "tool-input-available");
    await pausedStream(page, chunks, cut, 1500);
    await mockAsk(page, () => undefined);
    await page.goto("/en");
    await interactive(page);
    const bar = page.getByRole("textbox", { name: "Ask about my work" });
    await bar.fill("Still with me?");
    await bar.press("Enter");
    const stage = page.locator("app-ask-stage");
    await expect(stage).toContainText("Searched “evals”");

    await page.locator('a[href="/en/work/project-one"]').first().click();
    await page.waitForURL("**/en/work/project-one");
    const panel = page.getByRole("dialog", { name: "Ask about my work" });
    await expect(panel).toContainText("Still with me?");
    await expect(panel).toContainText("Finished beside the next page.");

    await page.goBack();
    await expect(page).toHaveURL(/\/en$/);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(stage).toContainText("Finished beside the next page.");
  });

  test("the admin's questions are in the stage's first HTML; the browser asks for nothing (plan 4 U11b)", async ({
    page,
    request,
  }) => {
    expect(await (await request.get("/de")).text()).toContain("Was hat er zuletzt gebaut?");
    const asked: string[] = [];
    page.on("request", (sent) => {
      if (/\/v1\/ask|ask-questions/.test(sent.url())) asked.push(sent.url());
    });
    await page.goto("/de");
    await interactive(page);
    const questions = page
      .locator("#hero")
      .getByRole("group", { name: "Vorgeschlagene Fragen" })
      .getByRole("button");
    await expect(questions).toHaveText([
      "Was hat er zuletzt gebaut?",
      "Wie prüft er KI-Antworten?",
    ]);
    expect(asked).toEqual([]);

    // English has none: the built-in three.
    await page.goto("/en");
    await interactive(page);
    await expect(
      page.locator("#hero").getByRole("group", { name: "Suggested questions" }).getByRole("button"),
    ).toHaveCount(3);
  });

  test("on home the floating button waits until the hero's ask bar has left the screen (plan 4 U10)", async ({
    page,
  }) => {
    await mockAsk(page, () => undefined);
    await page.goto("/en");
    await interactive(page);
    const fab = page.getByRole("button", { name: "Ask about my work" });
    await expect(fab).toBeHidden();
    await page.locator("#about").scrollIntoViewIfNeeded();
    await expect(fab).toBeVisible();
    await fab.click();
    await expect(askPanel(page).locator("textarea")).toBeFocused();
  });

  test("an empty ask bar still goes to the prompt", async ({ page }) => {
    await mockAsk(page, () => undefined);
    await page.goto("/en");
    await interactive(page);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(askPanel(page).locator("textarea")).toBeFocused();
  });

  test("other pages open the same assistant in a sheet", PHONE, async ({ page }) => {
    await mockAsk(page, (route) => sse(route, answer({ text: "From the sheet." })));
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page.getByRole("button", { name: "Ask about my work" }).click();
    const sheet = page.getByRole("dialog", { name: "Ask about my work" });
    const prompt = sheet.locator("textarea");
    // On a phone the prompt waits for a tap: its keyboard would cover the suggestions.
    await expect(page.viewportSize()!.width < 1024 ? sheet : prompt).toBeFocused();
    await run(prompt, "Hello");
    await expect(sheet).toContainText("From the sheet.");
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("“/” opens the sheet on other pages; its empty terminal suggests questions", async ({
    page,
  }) => {
    await mockAsk(page, (route) => sse(route, answer({ text: "From the sheet." })));
    await page.goto("/en/work/project-one");
    await interactive(page);
    // From lg the button is a pill that says what it does; its name stays the same.
    const button = page.getByRole("button", { name: "Ask about my work" });
    await expect(button.getByText("Ask", { exact: true })).toBeVisible();
    await expect(button).toHaveAttribute("aria-keyshortcuts", "/");

    await page.keyboard.press("/");
    const sheet = page.getByRole("dialog", { name: "Ask about my work" });
    const prompt = sheet.locator("textarea");
    await expect(prompt).toBeFocused();
    await expect(sheet.locator("header")).toContainText("online");
    await sheet
      .getByRole("group", { name: "Suggested questions" })
      .getByRole("button", { name: "What has he shipped with RAG?" })
      .click();
    await expect(sheet).toContainText("From the sheet.");
    await expect(sheet.getByRole("group", { name: "Suggested questions" })).toHaveCount(0);
    // In the prompt, "/" is just a character.
    await prompt.pressSequentially("a/b");
    await expect(prompt).toHaveValue("a/b");
    await sheet.getByRole("button", { name: "Close the assistant" }).click();
    await expect(sheet).toBeHidden();
  });

  test(
    "a citation and the hand-off happen beside the open panel, which holds still; a phone's sheet steps aside for them (plan 4 U8)",
    PHONE,
    async ({ page }) => {
      const phone = page.viewportSize()!.width < 1024;
      const summary = "Wants to discuss a six-month contract.";
      await mockAsk(page, (route, n) =>
        sse(
          route,
          n === 1
            ? answer({
                text: "It ranks by meaning [^project:project-two@en].",
                sources: [
                  {
                    type: "source-url",
                    sourceId: "project:project-two@en",
                    url: "/en/work/project-two",
                    title: "Supplier catalogue ingestion",
                  },
                ],
              })
            : [
                ...answer({ id: "m_e2e00000002", text: "Happy to help you reach him." }).slice(
                  0,
                  -2,
                ),
                { type: "tool-input-start", toolCallId: "h1", toolName: "handoff_contact" },
                {
                  type: "tool-input-available",
                  toolCallId: "h1",
                  toolName: "handoff_contact",
                  input: { summary },
                },
                {
                  type: "tool-output-available",
                  toolCallId: "h1",
                  output: { ok: true, awaitingConfirmation: true },
                },
                { type: "finish-step" },
                { type: "finish", finishReason: "tool-calls", messageMetadata: { sig: "s" } },
              ],
        ),
      );
      await recordPosts(page, "**/v1/ask/handoff");
      await page.goto("/en/work/project-one");
      await interactive(page);
      const fab = page.getByRole("button", { name: "Ask about my work" });
      await fab.click();
      const panel = page.getByRole("dialog", { name: "Ask about my work" });
      // Named for page changes, so it holds still while they happen behind it.
      await expect(panel).toHaveCSS("view-transition-name", "ask-panel");
      // A sheet over the whole page on a phone, which is inert behind it; beside it on a desktop.
      const inert = () => page.locator("main").evaluate((main) => !!main.closest("[inert]"));
      expect(await inert()).toBe(phone);

      await run(panel.locator("textarea"), "How does Atlas search?");
      await expect(panel.getByRole("button", { name: "copy", exact: true })).toBeVisible();
      const at = await panel.boundingBox();
      await panel.getByRole("link", { name: /sources 1: Supplier catalogue ingestion/ }).click();
      await expect(page).toHaveURL(/\/en\/work\/project-two$/);
      if (phone) {
        await expect(panel).toBeHidden();
        expect(await inert()).toBe(false);
        // Back returns to the conversation; Back again closes it, on the same page.
        await page.goBack();
        await expect(panel).toBeVisible();
        await expect(page).toHaveURL(/\/en\/work\/project-one$/);
        await page.goBack();
        await expect(panel).toBeHidden();
        await expect(page).toHaveURL(/\/en\/work\/project-one$/);
        await fab.click();
      } else {
        expect(await panel.boundingBox()).toEqual(at);
      }

      await run(panel.locator("textarea"), "I want to hire him");
      const offer = panel.getByRole("group", {
        name: "Hand this conversation to the contact form?",
      });
      await offer.getByRole("button", { name: "yes" }).click();
      await expect(page).toHaveURL(/\/en#contact$/);
      await expect(page.locator("#contact-message")).toHaveValue(summary);
      await expect(page.locator("#contact-name")).toBeFocused();
      await (phone ? expect(panel).toBeHidden() : expect(panel).toBeVisible());
    },
  );

  test("the open panel takes a reader's question from the page beside it", async ({ page }) => {
    await mockAsk(page, (route) => sse(route, answer({ text: "From the page beside it." })));
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page.getByRole("button", { name: "Ask about my work" }).click();
    const panel = page.getByRole("dialog", { name: "Ask about my work" });
    await expect(panel).toBeVisible();
    await page.getByRole("button", { name: "Ask about Atlas" }).focus();
    await page.keyboard.press("Enter");
    await expect(panel).toContainText("What did he build in Atlas, and how?");
    await expect(panel).toContainText("From the page beside it.");
  });

  test("the panel leaves the page usable: the floating button hides behind it, it widens, and Escape on the page closes it where the focus is (plan 4 U8)", async ({
    page,
  }) => {
    await mockAsk(page, () => undefined);
    await page.goto("/en/work/project-one");
    await interactive(page);
    const fab = page.getByRole("button", { name: "Ask about my work" });
    await fab.click();
    const panel = page.getByRole("dialog", { name: "Ask about my work" });
    await expect(panel.locator("textarea")).toBeFocused();
    await expect(fab).toBeHidden();

    // Wider for code and tables, and back.
    const narrow = (await panel.boundingBox())!.width;
    const wider = panel.getByRole("button", { name: "Wider" });
    await wider.click();
    await expect(wider).toHaveAttribute("aria-pressed", "true");
    expect((await panel.boundingBox())!.width).toBeGreaterThan(narrow);
    await wider.click();
    expect((await panel.boundingBox())!.width).toBe(narrow);

    // Turned or zoomed across 1024px while open: the same dialog becomes the sheet and back.
    const behind = () =>
      page.locator("main").evaluate((main) => ({
        inert: !!main.closest("[inert]"),
        locked: document.documentElement.classList.contains("overflow-hidden"),
      }));
    for (const width of [800, 320]) {
      await page.setViewportSize({ width, height: 720 });
      await expect.poll(behind).toEqual({ inert: true, locked: true });
      expect(await panel.boundingBox()).toEqual({ x: 0, y: 0, width, height: 720 });
      expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await expect(wider).toBeHidden();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect.poll(behind).toEqual({ inert: false, locked: false });
    await expect(panel.locator("textarea")).toBeVisible();

    // The page beside it takes the focus; Escape there closes the panel and leaves the focus,
    // so nothing stays hidden behind it (WCAG 2.4.11).
    const link = page.getByRole("navigation", { name: "On this page" }).getByRole("link").first();
    await link.focus();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(link).toBeFocused();
    await expect(fab).toBeVisible();

    // Escape inside it hands the focus back to the button that opened it.
    await fab.click();
    await expect(panel.locator("textarea")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(fab).toBeFocused();
  });

  test(
    "a case study's end block asks the assistant about that project",
    PHONE,
    async ({ page }) => {
      const mock = await mockAsk(page, (route) =>
        sse(route, answer({ text: "A retrieval platform, built in TypeScript." })),
      );
      await page.goto("/en/work/project-one");
      await interactive(page);
      await page.getByRole("button", { name: "Ask about Atlas" }).click();
      const sheet = page.getByRole("dialog", { name: "Ask about my work" });
      await expect(sheet).toContainText("What did he build in Atlas, and how?");
      await expect(sheet).toContainText("A retrieval platform, built in TypeScript.");
      expect(mock.bodies).toHaveLength(1);
      // The page goes with the question (visitor plan V8): the server maps it to the case study.
      expect(mock.bodies[0]!.page).toBe("/en/work/project-one");
    },
  );

  test("a case study's section and code buttons ask about what they point at (visitor plan V9)", async ({
    page,
  }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "Retrieval stays inside the private network." })),
    );
    await page.goto("/en/work/project-one");
    await interactive(page);
    const sheet = page.getByRole("dialog", { name: "Ask about my work" });

    // Shown on hover; the heading keeps its own name.
    const heading = page.getByRole("heading", { name: "Architecture decisions", exact: true });
    const sectionAsk = page.getByRole("button", {
      name: "Ask about this section: Architecture decisions",
    });
    await expect(sectionAsk).toHaveCSS("opacity", "0");
    await heading.hover();
    await expect(sectionAsk).toHaveCSS("opacity", "1");
    await sectionAsk.click();
    await expect(sheet).toContainText("Explain this section");
    await expect(sheet).toContainText("Architecture decisions");
    await expect(sheet).toContainText("Retrieval stays inside the private network.");
    expect(mock.bodies[0]).toMatchObject({
      page: "/en/work/project-one",
      focus: { kind: "section", id: "architecture-decisions" },
    });

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.getByRole("button", { name: "Explain code block 1" }).click();
    await expect(sheet).toContainText("Explain this code");
    await expect(sheet).toContainText("const answer = await retrieve");
    await expect.poll(() => mock.bodies.length).toBe(2);
    expect(mock.bodies[1]).toMatchObject({ focus: { kind: "code", index: 0 } });
    // A question typed after them points at nothing.
    await run(sheet.locator("textarea"), "And the cost?");
    await expect.poll(() => mock.bodies.length).toBe(3);
    expect(mock.bodies[2]).not.toHaveProperty("focus");
  });

  test("the keyboard reaches a section's button after the table of contents, and Enter asks", async ({
    page,
  }) => {
    const mock = await mockAsk(page, (route) => sse(route, answer({ text: "Agents lost hours." })));
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page.getByRole("navigation", { name: "On this page" }).getByRole("link").last().focus();
    await page.keyboard.press("Tab");
    const problem = page.getByRole("button", { name: "Ask about this section: Problem" });
    await expect(problem).toBeFocused();
    // Visible on focus.
    await expect(problem).toHaveCSS("opacity", "1");
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Ask about my work" });
    await expect(sheet).toContainText("Agents lost hours.");
    expect(mock.bodies[0]).toMatchObject({ focus: { kind: "section", id: "problem" } });
  });

  test("selecting text in a post brings a small button that asks about it", async ({ page }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "A demo meets no real load." })),
    );
    await page.goto("/en/writing/shipping-rag-to-production");
    await interactive(page);
    const asks = page.getByRole("button", { name: "Ask about this selected text" });
    await expect(asks).toHaveCount(0);
    await page.locator("app-prose-body p").first().selectText();
    await expect(asks).toBeVisible();
    await asks.click();
    const sheet = page.getByRole("dialog", { name: "Ask about my work" });
    await expect(sheet).toContainText("What does this mean?");
    await expect(sheet).toContainText("“A demo has one user and no traffic.”");
    await expect(sheet).toContainText("A demo meets no real load.");
    expect(mock.bodies[0]).toMatchObject({
      page: "/en/writing/shipping-rag-to-production",
      focus: { kind: "selection", text: "A demo has one user and no traffic." },
    });
    await expect(asks).toBeHidden();
  });

  test("level sets how technical answers are, kept in this browser and sent with each question (visitor plan V10)", async ({
    page,
  }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "Atlas helps agents." })),
    );
    let prompt = await openPrompt(page);
    const about = askPanel(page);
    await run(prompt, "level");
    await expect(about).toContainText("usage: level plain|standard|expert (now: standard)");
    await run(prompt, "level plain");
    await expect(about).toContainText("level plain: answers without jargon");
    // Scanned while the log still fits: a log that overflows with text alone is a known finding.
    expect(await axeViolations(page)).toEqual([]);
    await run(prompt, "help");
    await expect(about).toContainText("level plain|standard|expert");
    await expect(about).toContainText("how technical answers are");
    await run(prompt, "What is Atlas?");
    await expect.poll(() => mock.bodies.length).toBe(1);
    expect(mock.bodies[0]!.level).toBe("plain");

    // Still plain after a reload: the browser keeps it.
    await page.reload();
    prompt = await openPrompt(page);
    await run(prompt, "And Borealis?");
    await expect.poll(() => mock.bodies.length).toBe(2);
    expect(mock.bodies[1]!.level).toBe("plain");

    // Standard sends nothing; a question about a level is a question.
    await run(prompt, "level standard");
    await expect(about).toContainText("level standard: answers as usual.");
    await run(prompt, "level of his German?");
    await expect.poll(() => mock.bodies.length).toBe(3);
    expect(mock.bodies[2]).not.toHaveProperty("level");
  });

  test("an answer's receipt shows by itself on a careful topic, otherwise when asked, and inspect shows what the log keeps (visitor plan V12)", async ({
    page,
    context,
    browserName,
  }) => {
    if (browserName === "chromium") {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    }
    const dated = {
      type: "source-url",
      sourceId: "project:project-one@en",
      url: "/en/work/project-one",
      title: "Project one",
      providerMetadata: { portfolio: { kind: "project", updated: "2026-09-12" } },
    };
    await mockAsk(page, (route, n) =>
      sse(
        route,
        withReceipt(
          answer({
            id: `m_e2e0000000${n}`,
            text:
              n === 1
                ? "He runs evals first [^project:project-one@en]."
                : "Only what is published [^project:project-one@en].",
            tools: n === 1 ? SEARCH_STEP : [],
            sources: [dated],
          }),
          n === 1
            ? { lookups: 1, sources: 1, removed: 0 }
            : {
                lookups: 2,
                sources: 1,
                removed: 1,
                careful: "compensation",
                escalation: "projects-fetched",
              },
        ),
      ),
    );
    const inspected: Record<string, unknown>[] = [];
    await page.route("**/v1/ask/inspect", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      inspected.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ headers: cors, json: INSPECTED });
    });
    const prompt = await openPrompt(page);
    const log = askPanel(page).locator("[role=log]");

    await run(prompt, "How does he test prompts?");
    await expect(log).toContainText("He runs evals first");
    // The chip says what the source is and when it last changed.
    await expect(log.getByRole("link", { name: /Project one.*updated Sep 2026/ })).toBeVisible();
    // An ordinary answer's receipt waits behind the question.
    const receipt = log.locator("[data-receipt]");
    await expect(receipt).toHaveCount(0);
    const how = log.getByRole("button", { name: "how was this answered?" });
    await expect(how).toHaveAttribute("aria-expanded", "false");
    await how.click();
    await expect(how).toHaveAttribute("aria-expanded", "true");
    await expect(receipt.getByRole("listitem")).toContainText([
      "fast model",
      "1 lookup",
      "1 source checked",
    ]);

    // Its "inspect": that answer's timeline, from the log, for this session.
    await receipt.getByRole("button", { name: "inspect" }).click();
    await expect(log).toContainText("lite · reason: default");
    await expect(log).toContainText('↳ search "evals" → ok · 812 chars');
    await expect(log).toContainText("↳ passed over gemini-3.5-flash-lite: timeout after 6.0 s");
    expect(inspected[0]).toEqual({ sessionId: expect.any(String), messageId: "m_e2e00000001" });
    // Its name turns to "copied ✓": the locator takes either, so it stays on the timeline's button.
    const copyButton = log.getByRole("button", { name: /^cop(y|ied)/ }).last();
    await copyButton.click();
    await expect(copyButton).toHaveText(/copied/);
    if (browserName === "chromium") {
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toContain("> inspect");
      expect(copied).toMatch(/route {11}lite · reason: default/);
    }
    expect(await axeViolations(page)).toEqual([]);

    // A careful answer, with a reference removed and a move to the deep model: it shows by itself.
    await run(prompt, "What does he earn?");
    await expect(log).toContainText("Only what is published");
    await expect(receipt.last().getByRole("listitem")).toContainText([
      "moved to the thorough model: it read two projects",
      "2 lookups",
      "1 source checked",
      "1 invented reference removed",
      "careful topic: published facts only",
    ]);
    await expect(log.getByRole("button", { name: "how was this answered?" })).toHaveCount(1);

    // Typed, inspect asks about the newest answer.
    await run(prompt, "inspect");
    await expect.poll(() => inspected.length).toBe(2);
    expect(inspected[1]).toMatchObject({ messageId: "m_e2e00000002" });
  });

  test("a failover before the first words is said once, and never kept (visitor plan V12)", async ({
    page,
  }) => {
    const [start, ...rest] = answer({ text: "From the second model." });
    const chunks = [
      start!,
      { type: "data-status", data: { code: "failover", position: 2, of: 3 }, transient: true },
      ...rest,
    ];
    // The status, then a pause before the first words, as a failover's wait.
    await pausedStream(page, chunks, 1, 2500);
    await mockAsk(page, () => undefined);
    const prompt = await openPrompt(page);
    await run(prompt, "Is he available?");

    const status = askPanel(page).locator("[data-failover]");
    await expect(status).toHaveText("the first model is busy, trying another (2 of 3)");
    await expect(askPanel(page).locator("[aria-live=polite]")).toHaveText(
      "the first model is busy, trying another (2 of 3)",
    );
    await expect(askPanel(page).locator("[role=log]")).toContainText("From the second model.");
    await expect(status).toHaveCount(0);
    // Not part of the message: the tab keeps the answer, never the status.
    const kept = await page.evaluate(() => sessionStorage.getItem("ask:v1") ?? "");
    expect(kept).toContain("From the second model.");
    expect(kept).not.toMatch(/failover|data-status/);
  });

  test("evals prints the published scorecard, and its last line asks how the assistant works (visitor plan V13)", async ({
    page,
  }) => {
    const mock = await mockAsk(
      page,
      (route) => sse(route, answer({ text: "It answers from this site's content." })),
      { scorecard: true },
    );
    const served: string[] = [];
    await page.route("**/v1/ask/scorecard", async (route) => {
      served.push(route.request().method());
      await route.fulfill({ headers: cors, json: SCORECARD });
    });
    const prompt = await openPrompt(page, "/en/writing");
    const log = askPanel(page).locator("[role=log]");
    // The config has come: it says whether the scorecard is published.
    await expect(askPanel(page).locator("header")).toContainText("online");

    await run(prompt, "help");
    await expect(log).toContainText("how well the assistant does: its tests and live checks");
    await run(prompt, "evals");
    await expect(log).toContainText("76 of 84 cases passed (90.5%)");
    await expect(log).toContainText("fact 14/18 · page 5/5");
    await expect(log).toContainText("every reference real in 96% of 40 answers that cite");
    await expect(log).toContainText("figures");
    await expect(log).toContainText("not enough answers yet");
    await expect(log).toContainText("invalid_input 16 · rate_limited 2");
    expect(served).toEqual(["GET"]);
    expect(await axeViolations(page)).toEqual([]);

    // Its last line asks the assistant, which answers from the system card.
    await log.getByRole("button", { name: "how this assistant works ›" }).click();
    await expect(log).toContainText("It answers from this site's content.");
    expect(JSON.stringify(mock.bodies[0]!.messages)).toContain("How does this assistant work?");
  });

  test("unpublished, evals says so without asking, and help leaves it out (visitor plan V13)", async ({
    page,
  }) => {
    await mockAsk(page, () => undefined, { scorecard: false });
    let asked = 0;
    await page.route("**/v1/ask/scorecard", async (route) => {
      asked++;
      await route.fulfill({ status: 404, headers: cors, json: { error: "not_published" } });
    });
    const prompt = await openPrompt(page, "/en/writing");
    const log = askPanel(page).locator("[role=log]");
    await expect(askPanel(page).locator("header")).toContainText("online");
    await run(prompt, "help");
    await expect(log).toContainText("inspect");
    await expect(log).not.toContainText("how well the assistant does");
    await run(prompt, "evals");
    await expect(log).toContainText("The scorecard is not published.");
    expect(asked).toBe(0);
  });

  test("forget deletes this tab's conversation from the log on a yes, clears this browser's level and starts afresh (visitor plan V14)", async ({
    page,
  }) => {
    await mockAsk(page, (route, n) =>
      sse(route, answer({ id: `m_e2e0000000${n}`, text: "He lives in Berlin." })),
    );
    const forgotten: Record<string, unknown>[] = [];
    await page.route("**/v1/ask/forget", async (route) => {
      if (route.request().method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      forgotten.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ headers: cors, json: { ok: true, deleted: 2 } });
    });
    const session = () =>
      page.evaluate(
        () => JSON.parse(sessionStorage.getItem("ask:v1") ?? "{}") as Record<string, unknown>,
      );
    const prompt = await openPrompt(page);
    const log = askPanel(page).locator("[role=log]");

    await run(prompt, "level plain");
    await run(prompt, "Where does he live?");
    await expect(log).toContainText("He lives in Berlin.");
    const first = (await session())["sessionId"];
    // A reset begins a new session; the log keeps the earlier one, which forget still reaches.
    await run(prompt, "reset");
    await expect(log).toContainText("The log keeps it up to 90 days; `forget` deletes it.");
    await run(prompt, "Is he available?");
    await expect(log).toContainText("He lives in Berlin.");
    const second = (await session())["sessionId"];
    expect(second).not.toBe(first);

    // It names what goes and what stays, and a no sends nothing.
    await run(prompt, "forget");
    const confirm = page.getByRole("group", { name: "Delete this conversation from the log?" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toHaveAccessibleDescription(/contact form keeps its copy/);
    expect(await axeViolations(page)).toEqual([]);
    await confirm.getByRole("button", { name: "no", exact: true }).click();
    await expect(log).toContainText("OK, nothing was deleted.");
    await expect(confirm).toHaveCount(0);
    expect(forgotten).toHaveLength(0);

    // A typed yes: both sessions' answers go, then this browser's level, then the session.
    await run(prompt, "forget");
    await run(prompt, "y");
    await expect(log).toContainText("Deleted 2 answers from the log.");
    expect(forgotten).toEqual([{ sessionId: second, earlier: [first] }]);
    expect(await page.evaluate(() => localStorage.getItem("ask:level"))).toBeNull();
    const after = await session();
    expect(after["sessionId"]).not.toBe(second);
    expect(after["earlierSessions"]).toEqual([]);
    await expect(log).not.toContainText("Where does he live?");
  });

  test("read next ends a case study and a post with the pages related to them, and asks how they connect (visitor plan V15)", async ({
    page,
  }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "Both run on the same retrieval stack." })),
    );
    const maps = await mockMap(page);
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page.locator("article > footer").scrollIntoViewIfNeeded();
    const readNext = page.getByRole("navigation", { name: "Read next" });
    await expect(readNext).toBeVisible();
    // Its own related pages, strongest first, then the post that names it.
    await expect(readNext.getByRole("link")).toHaveText([
      /^Senior AI Engineer — Example GmbH/,
      /^Supplier catalogue ingestion/,
      /^Shipping RAG to production/,
    ]);
    await expect(readNext.getByRole("link").nth(1)).toContainText("case study · updated");
    // The article's end, before its footer; fetched once.
    await expect(page.locator("article > nav.read-next + footer")).toHaveCount(1);
    expect(maps).toEqual(["en"]);

    // How two pages connect is a question asked on this page (V8).
    await readNext.getByRole("button", { name: "How do they connect?" }).nth(1).click();
    const sheet = page.getByRole("dialog", { name: "Ask about my work" });
    await expect(sheet).toContainText("How do Atlas and Supplier catalogue ingestion connect?");
    await expect(sheet).toContainText("Both run on the same retrieval stack.");
    expect(mock.bodies[0]).toMatchObject({ page: "/en/work/project-one" });
    await page.keyboard.press("Escape");

    // A post: the project it names, opened through the router.
    await page.goto("/en/writing/shipping-rag-to-production");
    await interactive(page);
    await page.locator("article > footer").scrollIntoViewIfNeeded();
    const postNext = page.getByRole("navigation", { name: "Read next" });
    await expect(postNext.getByRole("link")).toHaveText([/^Atlas/]);
    await postNext.getByRole("link").click();
    await expect(page).toHaveURL(/\/en\/work\/project-one$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Atlas");
  });

  test("news offers what's new, stores nothing before a yes, and lists what changed since the last visit (visitor plan V15)", async ({
    page,
  }) => {
    const mock = await mockAsk(page, (route) => sse(route, answer({ text: "Two pages changed." })));
    const maps = await mockMap(page);
    const kept = () => page.evaluate(() => localStorage.getItem("ask:news"));
    const prompt = await openPrompt(page);
    const log = askPanel(page).locator("[role=log]");

    // Off: offered, with what it would keep; a no stores nothing, and nothing is fetched.
    await run(prompt, "news");
    const offer = page.getByRole("group", { name: "Turn on what's new?" });
    await expect(offer).toBeVisible();
    await expect(offer).toHaveAccessibleDescription(/remember today's date/);
    expect(await axeViolations(page)).toEqual([]);
    await offer.getByRole("button", { name: "no", exact: true }).click();
    await expect(log).toContainText("OK, nothing was stored.");
    expect(await kept()).toBeNull();
    expect(maps).toEqual([]);

    // A yes keeps today's date, and only that.
    await run(prompt, "news");
    await run(prompt, "y");
    await expect(log).toContainText("What's new is on.");
    const today = new Date().toISOString().slice(0, 10);
    expect(JSON.parse((await kept())!)).toEqual({ since: today, last: today });

    // A later visit, the last one on Sep 1: the empty terminal and the palette count what changed.
    await page.evaluate(() => {
      sessionStorage.clear();
      localStorage.setItem("ask:news", JSON.stringify({ since: "2026-09-01", last: "2026-09-01" }));
    });
    const since = new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date("2026-09-01T00:00:00Z"));
    const again = await openPrompt(page);
    const updates = page.getByRole("button", { name: `2 updates since ${since}` });
    await expect(updates).toBeVisible();
    expect(JSON.parse((await kept())!)).toEqual({ since: "2026-09-01", last: today });
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("option", { name: /What's new/ })).toContainText(
      `2 updates since ${since}`,
    );
    await page.keyboard.press("Escape");

    // `news` lists them with no model; one line asks for a summary.
    await updates.click();
    await expect(log).toContainText("Atlas · case study");
    await expect(log).toContainText("Shipping RAG to production · post");
    await expect(log).not.toContainText("Notes on evals");
    expect(mock.bodies).toHaveLength(0);
    await log.getByRole("button", { name: "summarize them ›" }).click();
    await expect(log).toContainText("Two pages changed.");
    expect(JSON.stringify(mock.bodies.at(-1)!.messages.at(-1))).toContain(
      "Summarize what is new on these pages: Atlas, Shipping RAG to production.",
    );

    await run(again, "news off");
    await expect(log).toContainText("What's new is off");
    expect(await kept()).toBeNull();
  });

  test(
    "tour runs the short tour from end to end: one panel from home on, a reload, the last stop's offer (visitor plan V16)",
    PHONE,
    async ({ page }) => {
      const mock = await mockAsk(page, (route) => sse(route, answer({ text: "unused" })));
      const prompt = await openPrompt(page);
      const log = askPanel(page).locator("[role=log]");

      // No model: the short tour comes from the page's own content.
      await run(prompt, "tour");
      await expect(log).toContainText("The short tour, 5 stops:");
      await expect(log).toContainText("Atlas");
      await expect(log).toContainText("Shipping RAG to production");
      const group = page.getByRole("group", { name: "tour · 5 stops" });
      await expect(group).toBeVisible();
      expect(mock.bodies).toHaveLength(0);

      // The first stop is About, on this page; the keyboard reaches the group's next.
      await group.getByRole("button", { name: "next" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("group", { name: "tour · stop 1 of 5 · about" })).toBeVisible();
      await expect(log).toContainText("ask about this ›");

      // Typed, as in any shell. To another page: the panel stays open and carries the tour on.
      await run(prompt, "next");
      await expect(page).toHaveURL(/\/en\/work\/project-one$/);
      const sheet = page.getByRole("dialog", { name: "Ask about my work" });
      await expect(sheet.getByRole("group", { name: "tour · stop 2 of 5 · Atlas" })).toBeVisible();

      // The tab keeps it through a reload.
      await page.reload();
      await interactive(page);
      await page.getByRole("button", { name: "Ask about my work" }).click();
      await expect(sheet.getByRole("group", { name: /stop 2 of 5/ })).toBeVisible();

      await sheet.getByRole("button", { name: "next" }).click();
      await expect(page).toHaveURL(/\/en\/writing\/shipping-rag-to-production$/);
      await sheet.getByRole("button", { name: "back" }).click();
      await expect(page).toHaveURL(/\/en\/work\/project-one$/);
      await run(sheet.locator("textarea"), "next");
      await run(sheet.locator("textarea"), "next");
      await expect(page).toHaveURL(/\/en\/work\/project-two$/);
      await run(sheet.locator("textarea"), "next");
      await expect(page).toHaveURL(/\/en#contact$/);
      await expect(sheet).toContainText("That was the last stop.");

      // The last stop offers contact, as the hand-off does.
      const offer = sheet.getByRole("group", {
        name: "Hand this conversation to the contact form?",
      });
      await expect(offer).toBeVisible();
      await offer.getByRole("button", { name: "yes" }).click();
      await expect(page.locator("#contact-message")).toHaveValue(
        "Hi Alireza, I took the tour of your portfolio and would like to get in touch.",
      );
      expect(mock.bodies).toHaveLength(0);
    },
  );

  test("tour <interest> asks the server once and takes its checked stops; tour stop ends it (visitor plan V16)", async ({
    page,
  }) => {
    const stops = [
      {
        id: "project:project-two@en",
        title: "Supplier catalogue ingestion",
        url: "/en/work/project-two",
        line: "Where the data pipeline lives.",
      },
      {
        id: "post:shipping-rag-to-production@en",
        title: "Shipping RAG to production",
        url: "/en/writing/shipping-rag-to-production",
        line: "What changed with real users.",
      },
      {
        id: "experience:senior@en",
        title: "Senior AI Engineer — Example GmbH",
        url: "/en#experience",
        line: "Where he runs it today.",
      },
    ];
    const mock = await mockAsk(page, (route) =>
      sse(route, [
        { type: "start", messageId: "m_e2etour0001", messageMetadata: { createdAt: Date.now() } },
        { type: "start-step" },
        {
          type: "source-url",
          sourceId: "project:project-two@en",
          url: "/en/work/project-two",
          title: "Supplier catalogue ingestion",
        },
        { type: "text-start", id: "intro" },
        {
          type: "text-delta",
          id: "intro",
          delta:
            "Three stops on data platforms, from Supplier catalogue ingestion [^project:project-two@en].",
        },
        { type: "text-end", id: "intro" },
        {
          type: "data-tour",
          data: {
            v: 1,
            kind: "plan",
            interest: "data platforms",
            stops,
            replanned: false,
            sig: "s",
          },
        },
        { type: "finish-step" },
        { type: "finish", finishReason: "stop", messageMetadata: { sig: "signed" } },
      ]),
    );
    const prompt = await openPrompt(page);
    const log = askPanel(page).locator("[role=log]");
    await run(prompt, "tour data platforms");
    await expect(log).toContainText("Three stops on data platforms");
    const list = log.getByRole("list", { name: "Stops" });
    await expect(list.getByRole("link")).toHaveText([
      "Supplier catalogue ingestion",
      "Shipping RAG to production",
      "Senior AI Engineer — Example GmbH",
    ]);
    expect(mock.bodies).toHaveLength(1);
    expect(mock.bodies[0]).toMatchObject({ mode: "tour", tour: { interest: "data platforms" } });

    const group = page.getByRole("group", { name: "tour · 3 stops" });
    await expect(group).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await group.getByRole("button", { name: "next" }).click();
    await expect(page).toHaveURL(/\/en\/work\/project-two$/);
    const sheet = page.getByRole("dialog", { name: "Ask about my work" });
    await expect(sheet.getByRole("button", { name: "more like this" })).toBeVisible();
    await run(sheet.locator("textarea"), "tour stop");
    await expect(sheet).toContainText("Tour ended.");
    await expect(sheet.getByRole("group", { name: /^tour/ })).toHaveCount(0);
  });

  test("match role, project and problem: the paste box, the rows with their sources, the hand-off (visitor plan V20)", async ({
    page,
  }) => {
    const kinds = {
      role: {
        label: "Paste the role",
        prefix: "Role",
        brief: "Senior AI engineer: retrieval in production, embedded C.",
      },
      project: {
        label: "Describe your project",
        prefix: "Project",
        brief: "A retrieval platform for our support team.",
      },
      problem: {
        label: "Describe the problem",
        prefix: "Question",
        brief: "How do we evaluate retrieval before each release?",
      },
    } as const;
    const order = ["role", "project", "problem"] as const;
    const mock = await mockAsk(
      page,
      (route, n) => {
        const kind = order[n - 1]!;
        const { prefix, brief } = kinds[kind];
        return sse(route, [
          { type: "data-match-progress", data: { v: 1, step: "plan" }, transient: true },
          {
            type: "start",
            messageId: `m_e2ematch000${n}`,
            messageMetadata: { createdAt: Date.now() },
          },
          { type: "start-step" },
          {
            type: "source-url",
            sourceId: "project:project-two@en",
            url: "/en/work/project-two",
            title: "Supplier catalogue ingestion",
          },
          { type: "text-start", id: "match" },
          {
            type: "text-delta",
            id: "match",
            delta: [
              "Published evidence for 1 of 2 requirements; 1 not published.",
              "",
              "- ✓ **Retrieval in production** (must) · evidence: Built a retrieval platform. [^project:project-two@en]",
              "- – **Embedded C** (must) · not published: nothing on his site shows this.",
            ].join("\n"),
          },
          { type: "text-end", id: "match" },
          { type: "finish-step" },
          {
            type: "finish",
            finishReason: "stop",
            messageMetadata: {
              sig: "signed",
              handoff: { by: "fallback", summary: `${prefix}: ${brief}` },
              receipt: {
                lookups: 2,
                sources: 1,
                removed: 0,
                match: { kind, rows: 2, downgraded: 0 },
              },
            },
          },
        ]);
      },
      { match: true },
    );
    await page.route("**/v1/ask/handoff", (route) =>
      route.fulfill(
        route.request().method() === "OPTIONS"
          ? { status: 204, headers: cors }
          : { headers: cors, json: { ok: true } },
      ),
    );
    await openPrompt(page);
    // With the paste box open, the log holds a second textarea: the prompt is the terminal's own.
    const prompt = askPanel(page).locator("textarea");
    const log = askPanel(page).locator("[role=log]");
    const offer = page.getByRole("group", { name: "Hand this conversation to the contact form?" });

    await run(prompt, "help");
    await expect(log).toContainText("match role|project|problem");
    for (const [i, kind] of order.entries()) {
      const { label, prefix, brief } = kinds[kind];
      await run(prompt, `match ${kind}`);
      const box = log.getByLabel(label);
      await expect(box).toBeFocused();
      await expect(log).toContainText(
        "Don't paste confidential details: the text goes to the model provider.",
      );
      if (i === 0) {
        await settled(page);
        expect(await axeViolations(page)).toEqual([]);
      }
      await box.fill(brief);
      await log.getByRole("button", { name: "check it" }).click();
      await expect(box).toHaveCount(0);
      await expect(log.getByText("nothing on his site shows this.")).toHaveCount(i + 1);
      // The source's chip under each answer (its citation in the text links to it too).
      await expect(log.locator("a.note", { hasText: "Supplier catalogue ingestion" })).toHaveCount(
        i + 1,
      );
      expect(mock.bodies[i]).toMatchObject({ mode: "match", match: { kind, brief } });
      await expect(offer).toBeVisible();
      if (kind !== "problem") {
        await offer.getByRole("button", { name: "no" }).click();
        continue;
      }
      expect(await axeViolations(page)).toEqual([]);
      await offer.getByRole("button", { name: "yes" }).click();
      await expect(page.locator("#contact-message")).toHaveValue(`${prefix}: ${brief}`);
    }
  });

  test("a match shows its step while it runs, said only as it starts and with its rows (visitor plan V20)", async ({
    page,
  }) => {
    const rows =
      "- ✓ **Retrieval** · evidence: Built a retrieval platform. [^project:project-two@en]";
    const chunks: Chunk[] = [
      { type: "data-match-progress", data: { v: 1, step: "plan" }, transient: true },
      { type: "data-match-progress", data: { v: 1, step: "search", items: 3 }, transient: true },
      { type: "start", messageId: "m_e2ematchstep", messageMetadata: { createdAt: Date.now() } },
      { type: "start-step" },
      { type: "text-start", id: "match" },
      { type: "text-delta", id: "match", delta: rows },
      { type: "text-end", id: "match" },
      { type: "finish-step" },
      { type: "finish", finishReason: "stop", messageMetadata: { sig: "signed" } },
    ];
    // The stream stops for a while after its second step, as the rows' call does.
    await pausedStream(page, chunks, 1, 3000);
    await mockAsk(page, () => undefined, { match: true });
    await openPrompt(page);
    const prompt = askPanel(page).locator("textarea");
    const log = askPanel(page).locator("[role=log]");
    const live = askPanel(page).locator("[aria-live=polite]");
    await run(prompt, "fit");
    await log.getByLabel("Paste the role").fill("Senior AI engineer: retrieval in production.");
    await log.getByRole("button", { name: "check it" }).click();
    await expect(live).toHaveText("Checking the brief against his published work…");
    await expect(log.locator("[data-match-progress]")).toHaveText(
      "searching his work for 3 items…",
    );
    await expect(log).toContainText("Built a retrieval platform.");
    await expect(log.locator("[data-match-progress]")).toHaveCount(0);
    await expect(live).toContainText("Built a retrieval platform.");
  });

  test("the match page: each kind's brief, its rows with their evidence, kept through a reload, and the hand-off (plan 3 W3)", async ({
    page,
  }) => {
    const kinds = {
      role: { radio: "A role", label: "Paste the role", item: "Requirement", prefix: "Role" },
      project: {
        radio: "A project",
        label: "Describe your project",
        item: "Need",
        prefix: "Project",
      },
      problem: {
        radio: "A problem",
        label: "Describe the problem",
        item: "Aspect",
        prefix: "Question",
      },
    } as const;
    const order = ["role", "project", "problem"] as const;
    const brief = (kind: string) => `A ${kind} about retrieval in production and embedded C.`;
    const mock = await mockAsk(
      page,
      (route, n) => {
        const kind = order[n - 1]!;
        const handoff = `${kinds[kind].prefix}: ${brief(kind)}`;
        return sse(route, matchChunks(`m_e2epage000${n}`, kind, handoff));
      },
      { match: true },
    );
    const confirmed = await recordPosts(page, "**/v1/ask/handoff");
    await page.goto("/en/match");
    await interactive(page);
    const table = page.getByRole("table", {
      name: "Each point of the brief, with what his work shows",
    });
    for (const [i, kind] of order.entries()) {
      const { radio, label, item } = kinds[kind];
      await page.getByRole("radio", { name: radio }).check();
      // The page's box stays where it is and takes no focus.
      const box = page.getByLabel(label);
      await expect(box).not.toBeFocused();
      await box.fill(brief(kind));
      await page.getByRole("button", { name: "check it" }).click();
      await expect(table.getByRole("columnheader", { name: item })).toBeVisible();
      expect(mock.bodies[i]).toMatchObject({ mode: "match", match: { kind, brief: brief(kind) } });
    }
    // The server's words in each row, and the page each rests on.
    const rows = table.getByRole("row");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(1)).toContainText("✓ evidence");
    await expect(rows.nth(1).getByRole("rowheader")).toHaveText("Retrieval in production (must)");
    await expect(
      rows.nth(1).getByRole("link", { name: "Supplier catalogue ingestion" }),
    ).toHaveAttribute("href", "/en/work/project-two");
    await expect(rows.nth(2)).toContainText("nothing on his site shows this.");
    const lead = "Published evidence for 1 of 2 requirements; 1 not published.";
    await expect(page.getByText(lead, { exact: true })).toBeVisible();
    await expect(page.locator("[data-receipt]")).toContainText("2 rows");

    // A reload keeps the match and its offer: the hand-off is read from the answer itself.
    await page.reload();
    await interactive(page);
    await expect(table.getByRole("columnheader", { name: "Aspect" })).toBeVisible();
    await page.getByRole("button", { name: "Hand this to the contact form" }).click();
    await expect(page).toHaveURL(/\/en#contact$/);
    await expect(page.locator("#contact-message")).toHaveValue(`Question: ${brief("problem")}`);
    await expect.poll(() => confirmed.length).toBe(1);
    expect(confirmed[0]).toMatchObject({ messageId: "m_e2epage0003" });
  });

  test("the match page's server HTML says what it does and offers the kinds, with nothing of the store (plan 3 W3)", async ({
    request,
  }) => {
    const html = await (await request.get("/en/match")).text();
    expect(html).toMatch(/<h1[^>]*>\s*Check the fit\s*<\/h1>/);
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html).toMatch(/hreflang="de" href="[^"]*\/de\/match"/);
    // The paste box and the table come with the store, after hydration.
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("app-match-panel");
  });

  test("the match page shows the step while it runs, and says only its start and its rows (plan 3 W3)", async ({
    page,
  }) => {
    const chunks = matchChunks("m_e2epagestep", "role", "Role: Senior AI engineer.");
    const search = { type: "data-match-progress", data: { v: 1, step: "search", items: 3 } };
    // The stream stops for a while after its second step, as the rows' call does.
    chunks.splice(1, 0, { ...search, transient: true });
    await pausedStream(page, chunks, 1, 3000);
    await mockAsk(page, () => undefined, { match: true });
    await page.goto("/en/match");
    await interactive(page);
    // The sheet is closed: the page's own live region speaks.
    const live = page.locator("main [role=status]");
    await page.getByLabel("Paste the role").fill("Senior AI engineer: retrieval in production.");
    await page.getByRole("button", { name: "check it" }).click();
    await expect(live).toHaveText("Checking the brief against his published work…");
    await expect(page.locator("[data-match-progress]")).toHaveText(
      "searching his work for 3 items…",
    );
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.locator("[data-match-progress]")).toHaveCount(0);
    await expect(live).toContainText("Built a retrieval platform.");
  });

  test("a match made in the terminal opens as a page: one conversation (plan 3 W3)", async ({
    page,
  }) => {
    await mockAsk(page, (route) => sse(route, matchChunks("m_e2epageterm", "role", "Role: x.")), {
      match: true,
    });
    await openPrompt(page);
    const log = askPanel(page).locator("[role=log]");
    await run(askPanel(page).locator("textarea"), "match role");
    await log.getByLabel("Paste the role").fill("Senior AI engineer: retrieval in production.");
    await log.getByRole("button", { name: "check it" }).click();
    await log.getByRole("link", { name: "open as a page" }).click();
    await expect(page).toHaveURL(/\/en\/match$/);
    await expect(page.getByRole("rowheader").first()).toHaveText("Retrieval in production (must)");
  });

  test("a match marks the work its evidence rests on; Clear takes the rows and the marks away (plan 3 W4)", async ({
    page,
  }) => {
    await mockAsk(page, (route) => sse(route, matchChunks("m_e2emarks001", "role", "Role: x.")), {
      match: true,
    });
    await page.goto("/en/match");
    await interactive(page);
    await page.getByLabel("Paste the role").fill("Senior AI engineer: retrieval in production.");
    await page.getByRole("button", { name: "check it" }).click();
    const mark = { name: "Evidence for 1 point of your brief" };
    // Through the router: the store keeps the marks in step, no reload needed.
    await page
      .getByRole("table")
      .getByRole("link", { name: "Supplier catalogue ingestion" })
      .click();
    await expect(page).toHaveURL(/\/en\/work\/project-two$/);
    await expect(page.locator("article > header").getByRole("link", mark)).toHaveAttribute(
      "href",
      "/en/match",
    );

    // A new load reads the tab's conversation once hydrated: the card, and the timeline's entry.
    await page.goto("/en");
    await interactive(page);
    const card = page.locator("#projects").getByRole("link", mark);
    await expect(card).toHaveCount(1);
    await page.locator("#experience").scrollIntoViewIfNeeded();
    await expect(page.locator("#experience").getByRole("link", mark)).toHaveCount(1);

    await card.click();
    await expect(page).toHaveURL(/\/en\/match$/);
    await page.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.locator("main [role=status]")).toHaveText(
      "Cleared: the rows and the marks on his pages are gone.",
    );
    // The answer's text stays; its rows are gone from the tab.
    const lead = "Published evidence for 1 of 2 requirements; 1 not published.";
    await expect(page.getByText(lead, { exact: true })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("ask:v1"))).not.toContain("data-match");
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Supplier catalogue ingestion" })).toBeVisible();
    await expect(page.getByRole("link", mark)).toHaveCount(0);
  });

  test("with match off, the match page says so and points to contact; home and the palette lead there (plan 3 W3)", async ({
    page,
  }) => {
    await mockAsk(page, () => undefined, { match: false });
    await page.goto("/en/match");
    await interactive(page);
    await expect(page.getByText("Matching is not offered just now.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Write to him instead" })).toHaveAttribute(
      "href",
      "/en#contact",
    );
    await expect(page.getByRole("button", { name: "check it" })).toHaveCount(0);

    await page.goto("/en");
    await interactive(page);
    const contact = page.locator("#contact");
    await expect(contact).toContainText("Hiring, or have a project?");
    await contact.getByRole("link", { name: "Check the fit first" }).click();
    await expect(page).toHaveURL(/\/en\/match$/);

    await page.goto("/en/writing");
    await interactive(page);
    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("fit");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/en\/match$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check the fit");
  });

  test("the contact form is a WebMCP tool only once it works: the server's HTML names nothing, the honeypot never (plan 3 W5)", async ({
    page,
    request,
  }) => {
    // With no `action`, a submit before hydration is a GET: named fields would put the message in the URL.
    const html = await (await request.get("/en")).text();
    const form = /<form[^>]*>[\s\S]*?<\/form>/.exec(html.slice(html.indexOf('id="contact"')))?.[0];
    expect(form).toContain('id="contact-message"');
    expect(form).not.toMatch(/\sname=|toolname|tooldescription/);

    await page.goto("/en");
    await interactive(page);
    const ready = page.locator("#contact form[data-ready]");
    await expect(ready).toHaveAttribute("toolname", "contact_alireza");
    await expect(ready).toHaveAttribute("tooldescription", /^Prepares a message to Alireza/);
    await expect(ready).not.toHaveAttribute("toolautosubmit");
    for (const field of ["name", "email", "message"]) {
      await expect(page.locator(`#contact-${field}`)).toHaveAttribute("name", field);
    }
    await expect(page.locator("#contact-website")).not.toHaveAttribute("name");
  });

  test("the visitor's own agent: with document.modelContext the four tools register once the page is idle; without it their code never loads (plan 3 W6)", async ({
    page,
  }) => {
    await mockAsk(page, () => undefined, { match: true });
    const loaded: string[] = [];
    page.on("request", (r) => {
      if (/\/agent-tools-[^/]*\.js$/.test(r.url())) loaded.push(r.url());
    });
    await page.goto("/en");
    await interactive(page);
    await page.waitForLoadState("networkidle");
    expect(loaded).toEqual([]);

    await page.addInitScript(() => {
      const names: string[] = [];
      Object.assign(window, { __agentTools: names });
      Object.defineProperty(document, "modelContext", {
        value: { registerTool: (tool: { name: string }) => void names.push(tool.name) },
      });
    });
    await page.reload();
    await interactive(page);
    await expect
      .poll(() => page.evaluate(() => (window as { __agentTools?: string[] }).__agentTools))
      .toEqual(["list_pages", "open_page", "ask_portfolio", "match_brief"]);
    expect(loaded).toHaveLength(1);
  });

  test(
    "a shared link puts its question in the prompt and sends nothing until Enter; share copies one (visitor plan V17)",
    PHONE,
    async ({ page, context, browserName, baseURL }) => {
      // Only Chromium lets a test grant clipboard access and read it back.
      const readable = browserName === "chromium";
      if (readable) await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      const mock = await mockAsk(page, (route) =>
        sse(route, answer({ text: "A retrieval platform, built in TypeScript." })),
      );
      const question = "What did he build here?";

      // Off home: the sheet opens with the question in its prompt, focused, and the address
      // keeps everything but the question.
      await page.goto(`/en/work/project-one?utm_source=news&ask=${encodeURIComponent(question)}`);
      await interactive(page);
      const sheet = page.getByRole("dialog", { name: "Ask about my work" });
      const prompt = sheet.locator("textarea");
      await expect(prompt).toHaveValue(question);
      await expect(prompt).toBeFocused();
      expect(new URL(page.url()).search).toBe("?utm_source=news");
      // A link proposes; only the visitor sends.
      expect(mock.bodies).toHaveLength(0);
      // Analytics never sees it: the hook strips it from any address the tracker would send.
      expect(
        await page.evaluate(
          () =>
            (
              window as unknown as {
                umamiBeforeSend: (t: string, p: { url: string }) => { url: string };
              }
            ).umamiBeforeSend("event", { url: "/en?ask=x&utm_source=news" }).url,
        ),
      ).toBe("/en?utm_source=news");
      expect(await axeViolations(page)).toEqual([]);

      await prompt.press("Enter");
      await expect(sheet).toContainText("A retrieval platform, built in TypeScript.");
      expect(mock.bodies).toHaveLength(1);
      expect(JSON.stringify(mock.bodies[0]!.messages.at(-1))).toContain(question);

      // share: the link carries the question, said once.
      await sheet
        .getByRole("button", { name: "share: copy a link that carries this question" })
        .click();
      await expect(sheet.getByRole("button", { name: "Link copied" })).toBeVisible();
      await expect(sheet.locator("[aria-live=polite]")).toHaveText("Link copied");
      if (readable) {
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
          `${new URL(baseURL!).origin}/en/work/project-one?ask=${encodeURIComponent(question)}`,
        );
      }

      // On home too, the panel opens with it.
      await page.goto(`/en?ask=${encodeURIComponent("Is he available?")}`);
      await interactive(page);
      await expect(askPanel(page).locator("textarea")).toHaveValue("Is he available?");
      expect(new URL(page.url()).search).toBe("");
      expect(mock.bodies).toHaveLength(1);
    },
  );

  test("the reader pages' server HTML has none of the ask buttons: the browser adds them", async ({
    request,
  }) => {
    for (const [path, heading] of [
      ["/en/work/project-one", 'id="architecture-decisions"'],
      ["/en/writing/shipping-rag-to-production", 'id="caching"'],
    ] as const) {
      const html = await (await request.get(path)).text();
      // The headings and their anchors are there; nothing the browser adds is (V9, V15).
      expect(html, path).toContain(heading);
      expect(html, path).not.toMatch(/reader-ask|code-explain|code-frame|read-next/);
      expect(html, path).not.toMatch(/<h2[^>]*aria-label/);
    }
  });
});

async function axeViolations(page: Page) {
  await settled(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  return violations.map((v) => ({
    rule: v.id,
    help: v.help,
    targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
  }));
}

// The terminal's states appear only after typing, which the page-level axe runs never do.
for (const colorScheme of ["dark", "light"] as const) {
  test.describe(`assistant accessibility (${colorScheme})`, () => {
    test.use({ colorScheme });

    test("home's stage, at rest and running (plan 4 U11b)", async ({ page }) => {
      await mockAsk(page, (route) =>
        sse(route, answer({ text: "On the stage.", tools: SEARCH_STEP, followups: ["And then?"] })),
      );
      await page.goto("/en");
      await interactive(page);
      expect(await axeViolations(page)).toEqual([]);
      await run(page.getByRole("textbox", { name: "Ask about my work" }), "How does he test?");
      await expect(askPanel(page).locator("[role=log]")).toContainText("On the stage.");
      expect(await axeViolations(page)).toEqual([]);
    });

    test("an answer, its footnotes, follow-ups, feedback and a hand-off prompt", async ({
      page,
    }) => {
      await mockAsk(page, (route) =>
        sse(route, [
          ...answer({
            text: "He runs **evals** first [^project:project-one@en].",
            tools: SEARCH_STEP,
            sources: [
              {
                type: "source-url",
                sourceId: "project:project-one@en",
                url: "/en/work/project-one",
                title: "Project one",
              },
            ],
            followups: ["Which stack?"],
          }).slice(0, -2),
          { type: "tool-input-start", toolCallId: "h1", toolName: "handoff_contact" },
          {
            type: "tool-input-available",
            toolCallId: "h1",
            toolName: "handoff_contact",
            input: { summary: "Hiring enquiry." },
          },
          { type: "tool-output-available", toolCallId: "h1", output: { ok: true } },
          { type: "finish-step" },
          {
            type: "finish",
            finishReason: "tool-calls",
            messageMetadata: { sig: "s", model: "gemini-3.5-flash-lite" },
          },
        ]),
      );
      const prompt = await openPrompt(page);
      await run(prompt, "help");
      await run(prompt, "stats");
      await run(prompt, "How does he test?");
      await expect(page.getByRole("group", { name: /Hand this conversation/ })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });

    test("the sheet on another page", async ({ page }) => {
      await mockAsk(page, (route) => sse(route, answer({ text: "From the sheet." })));
      await page.goto("/en/work/project-one");
      await interactive(page);
      await page.getByRole("button", { name: "Ask about my work" }).click();
      const sheet = page.getByRole("dialog", { name: "Ask about my work" });
      await run(sheet.locator("textarea"), "Hello");
      await expect(sheet).toContainText("From the sheet.");
      expect(await axeViolations(page)).toEqual([]);
    });

    test("a reader page's ask buttons as they show, and the question they asked (visitor plan V9)", async ({
      page,
    }) => {
      await mockAsk(page, (route) => sse(route, answer({ text: "It ranks by meaning." })));
      await page.goto("/en/work/project-one");
      await interactive(page);
      // A section's button on focus, and a selection's.
      await page.getByRole("button", { name: "Ask about this section: Problem" }).focus();
      await page.locator("app-prose-body p").first().selectText();
      const selectionAsk = page.getByRole("button", { name: "Ask about this selected text" });
      await expect(selectionAsk).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);

      await selectionAsk.click();
      const sheet = page.getByRole("dialog", { name: "Ask about my work" });
      await expect(sheet).toContainText("It ranks by meaning.");
      expect(await axeViolations(page)).toEqual([]);
    });

    test("the tour's list and its moves (visitor plan V16)", async ({ page }) => {
      await mockAsk(page, (route) => sse(route, answer({ text: "unused" })));
      const prompt = await openPrompt(page);
      await run(prompt, "tour");
      await run(prompt, "next");
      await expect(page.getByRole("group", { name: "tour · stop 1 of 5 · about" })).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });

    test("read next at a case study's end (visitor plan V15)", async ({ page }) => {
      await mockMap(page);
      await page.goto("/en/work/project-one");
      await interactive(page);
      await page.locator("article > footer").scrollIntoViewIfNeeded();
      const readNext = page.getByRole("navigation", { name: "Read next" });
      await expect(readNext.getByRole("listitem")).toHaveCount(3);
      await readNext.getByRole("button", { name: "How do they connect?" }).first().focus();
      expect(await axeViolations(page)).toEqual([]);
    });

    test("the match page with its rows (plan 3 W3)", async ({ page }) => {
      await mockAsk(page, (route) => sse(route, matchChunks("m_e2epageaxe0", "role", "Role: x.")), {
        match: true,
      });
      await page.goto("/en/match");
      await interactive(page);
      await page.getByLabel("Paste the role").fill("Senior AI engineer: retrieval in production.");
      await page.getByRole("button", { name: "check it" }).click();
      await expect(page.getByRole("table")).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });

    test("matched work's marks on home (plan 3 W4)", async ({ page }) => {
      await mockAsk(page, (route) => sse(route, matchChunks("m_e2emarksaxe", "role", "Role: x.")), {
        match: true,
      });
      await page.goto("/en/match");
      await interactive(page);
      await page.getByLabel("Paste the role").fill("Senior AI engineer: retrieval in production.");
      await page.getByRole("button", { name: "check it" }).click();
      await expect(page.getByRole("table")).toBeVisible();
      await page.goto("/en");
      await interactive(page);
      await page.locator("#experience").scrollIntoViewIfNeeded();
      const marks = page.getByRole("link", { name: "Evidence for 1 point of your brief" });
      await expect(marks).toHaveCount(2);
      expect(await axeViolations(page)).toEqual([]);
    });
  });
}

test.describe("assistant on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

  test("the stage is the sheet's door, and shows the last question afterwards (plan 4 U11b)", async ({
    page,
  }) => {
    await mockAsk(page, (route) => sse(route, answer({ text: "From the sheet." })));
    await page.goto("/en");
    await interactive(page);
    const sheet = page.getByRole("dialog", { name: "Ask about my work" });
    const close = sheet.getByRole("button", { name: "Close the assistant" });
    const stage = page.locator("app-ask-stage");

    // The field opens the sheet: no keyboard over the page.
    await stage.getByRole("textbox", { name: "Ask about my work" }).tap();
    await expect(sheet.locator("textarea")).toBeFocused();
    await close.tap();
    await expect(sheet).toBeHidden();

    await stage.getByRole("button", { name: "How does he test AI features?" }).tap();
    await expect(sheet).toContainText("From the sheet.");
    await expect(stage.locator("app-ask-console")).toHaveCount(0);
    await close.tap();
    await expect(sheet).toBeHidden();

    await stage.getByRole("button", { name: /^Continue your conversation/ }).tap();
    await expect(sheet).toContainText("From the sheet.");
  });

  /** An open sheet on a page off home; the prompt is not focused, so no keyboard shows. */
  async function openSheet(page: Page) {
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page.getByRole("button", { name: "Ask about my work" }).click();
    const sheet = page.getByRole("dialog", { name: "Ask about my work" });
    await expect(sheet).toBeFocused();
    return sheet;
  }

  test(
    "the sheet fills the screen, with no zoom on focus, a sentence keyboard and a 44px close (plan 4 U9)",
    PHONE,
    async ({ page }) => {
      await mockAsk(page, () => undefined);
      const sheet = await openSheet(page);
      const { width, height } = page.viewportSize()!;
      expect(await sheet.boundingBox()).toEqual({ x: 0, y: 0, width, height });

      const prompt = sheet.locator("textarea");
      await expect(prompt).toHaveCSS("font-size", "16px");
      await expect(prompt).toHaveAttribute("autocapitalize", "sentences");
      await expect(prompt).toHaveAttribute("spellcheck", "true");
      await expect(prompt).toHaveAttribute("enterkeyhint", "send");

      const close = sheet.getByRole("button", { name: "Close the assistant", exact: true });
      const target = await close.boundingBox();
      expect(target?.width).toBeGreaterThanOrEqual(44);
      expect(target?.height).toBeGreaterThanOrEqual(44);
      await close.click();
      await expect(sheet).toBeHidden();
    },
  );

  test(
    "a suggestion sends with the keyboard down; the log alone scrolls, with the prompt in view (plan 4 U9)",
    PHONE,
    async ({ page, browserName }) => {
      await mockAsk(page, (route) => sse(route, answer({ text: "A long answer. ".repeat(400) })));
      const sheet = await openSheet(page);
      const prompt = sheet.locator("textarea");
      const log = sheet.locator("[role=log]");
      await sheet
        .getByRole("group", { name: "Suggested questions" })
        .getByRole("button", { name: "What has he shipped with RAG?" })
        .click();
      await expect(sheet.getByRole("button", { name: "copy", exact: true })).toBeVisible();
      await expect(prompt).not.toBeFocused();
      await expect(log).toBeFocused();

      await expect(prompt).toBeInViewport({ ratio: 1 });
      // Windows WebKit computes no value for it.
      if (browserName === "chromium") {
        await expect(log).toHaveCSS("overscroll-behavior-y", "contain");
      }
      const overflow = (selector: string) =>
        page
          .locator(selector)
          .evaluate((box) => box.scrollHeight > Math.ceil(box.getBoundingClientRect().height));
      expect(await overflow("dialog.ask-sheet [role=log]")).toBe(true);
      expect(await overflow("dialog.ask-sheet")).toBe(false);
    },
  );

  test("“/” brings the prompt, for whoever has a keyboard", PHONE, async ({ page }) => {
    await mockAsk(page, () => undefined);
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page.keyboard.press("/");
    await expect(askPanel(page).locator("textarea")).toBeFocused();
  });

  test(
    "Back closes the sheet and leaves the page as it was; closing it by hand leaves no step behind (plan 4 U9)",
    PHONE,
    async ({ page }) => {
      await mockAsk(page, () => undefined);
      await page.goto("/en/writing");
      await page.goto("/en/work/project-one#problem");
      await interactive(page);
      await page.evaluate(() => window.scrollBy({ top: 400, behavior: "instant" }));
      const scrolled = () => page.evaluate(() => Math.round(window.scrollY));
      await expect.poll(scrolled).toBeGreaterThan(0);
      const top = await scrolled();
      // Firefox keeps half pixels and snaps them back: a pixel either way is the same place.
      const off = async () => Math.abs((await scrolled()) - top);
      const fab = page.getByRole("button", { name: "Ask about my work" });
      const sheet = page.getByRole("dialog", { name: "Ask about my work" });
      // Long enough for the router's scroll, which runs a frame after a navigation it skips.
      const settled = () => page.evaluate(() => new Promise((done) => setTimeout(done, 200)));

      await fab.click();
      await expect(sheet).toBeVisible();
      await page.goBack();
      await expect(sheet).toBeHidden();
      await expect(page).toHaveURL(/\/en\/work\/project-one#problem$/);
      await settled();
      await expect.poll(off).toBeLessThanOrEqual(1);

      await fab.click();
      await sheet.getByRole("button", { name: "Close the assistant", exact: true }).click();
      await expect(sheet).toBeHidden();
      await settled();
      await expect.poll(off).toBeLessThanOrEqual(1);

      // One Back leaves the page: the sheet's step went with it. (Firefox, told it is a phone,
      // keeps an extra "/" before the case study, so the page before is not always /en/writing.)
      await page.goBack();
      await expect(page).not.toHaveURL(/project-one/);
    },
  );

  test(
    "the sheet sits above the keyboard, and a stale offset after it closes does not move it (plan 4 U9)",
    PHONE,
    async ({ page }) => {
      await mockAsk(page, () => undefined);
      const sheet = await openSheet(page);
      const prompt = sheet.locator("textarea");
      const viewport = (height: number, offsetTop: number) =>
        page.evaluate(
          ([h, top]) => {
            const vv = window.visualViewport!;
            Object.defineProperty(vv, "height", { configurable: true, get: () => h });
            Object.defineProperty(vv, "offsetTop", { configurable: true, get: () => top });
            vv.dispatchEvent(new Event("resize"));
          },
          [height, offsetTop],
        );

      await prompt.focus();
      await viewport(400, 120);
      await expect.poll(() => sheet.boundingBox()).toMatchObject({ y: 120, height: 400 });
      const box = (await prompt.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(520);

      // Keyboard gone, focus gone, and iOS 26 still reporting the offset.
      await prompt.blur();
      await viewport(780, 24);
      await expect.poll(() => sheet.boundingBox()).toMatchObject({ y: 0, height: 780 });
    },
  );
});
