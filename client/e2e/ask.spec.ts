import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";

import { expect, interactive, settled, test } from "./fixtures";

/**
 * The About terminal as the portfolio assistant. The API is cross-origin in
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
      title: "TODO: Project One",
      url: "/en/work/project-one",
      updated: "2026-10-01",
      related: ["experience:senior@en", "project:project-two@en"],
    },
    {
      id: "project:project-two@en",
      kind: "project",
      title: "TODO: Project Two",
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

/** The About section's prompt, once its code has loaded. */
async function openPrompt(page: Page, path = "/en") {
  await page.goto(path);
  await interactive(page);
  await page.locator("#about").scrollIntoViewIfNeeded();
  const prompt = page.locator("#about textarea");
  await expect(prompt).toBeVisible();
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

test.use({ reducedMotion: "reduce" });

test.describe("assistant terminal", () => {
  test("the intro, prompt and AI disclosure are in the server-rendered page", async ({
    request,
  }) => {
    const html = await (await request.get("/en")).text();
    expect(html).toContain("cat philosophy.txt");
    expect(html).toContain('type a question, or "help"');
    expect(html).toContain("Answers are generated by an AI from the content of this site.");
    // The shell itself (and the AI SDK) loads in the browser only.
    expect(html).not.toContain('id="ask-input');
  });

  test("the window's title bar says whether the assistant answers", async ({ page }) => {
    const bar = page.locator("#about app-terminal-window header").first();
    await mockAsk(page, () => undefined);
    await openPrompt(page);
    await expect(bar).toContainText("online");

    await page.unrouteAll({ behavior: "wait" });
    await mockAsk(page, () => undefined, { state: "resting" });
    await openPrompt(page, "/de");
    await expect(bar).toContainText("pausiert");
  });

  test("shell commands answer locally, with history and Tab completion", async ({ page }) => {
    const mock = await mockAsk(page, () => undefined);
    const prompt = await openPrompt(page);
    const log = page.locator("#about [role=log]");

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

  test("a question streams an answer with its tool step, footnote, follow-ups and stats", async ({
    page,
    problems,
  }) => {
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

    const log = page.locator("#about [role=log]");
    await expect(log).toContainText("He runs evals before every prompt change");
    await expect(log).toContainText('› search "evals" ✓');
    const cite = log.getByRole("link", { name: /sources 1: Project one/ });
    await expect(cite).toHaveAttribute("href", "/en/work/project-one");
    const source = log.getByRole("link", { name: "Project one", exact: true });
    await expect(source).toBeVisible();
    // Pointing at the citation lights up its source.
    const border = () => source.evaluate((el) => getComputedStyle(el).borderColor);
    const resting = await border();
    await cite.hover();
    await expect.poll(border).not.toBe(resting);
    await page.mouse.move(0, 0);
    await expect.poll(border).toBe(resting);
    await expect(log).toContainText("gemini-3.5-flash-lite · 1.3 s · 91% cached");
    // Announced once, in full, without markup or markers.
    await expect(page.locator("#about [aria-live=polite]")).toHaveText(
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
  });

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
    const log = page.locator("#about [role=log]");
    await expect(log).toContainText("He runs evals before every prompt change");

    // Once the stream is over: when its first word showed, and when it ended.
    await expect.poll(() => typeof of(FIRST)["doneMs"]).toBe("number");
    expect(of(FIRST)["shownMs"]).toBeGreaterThanOrEqual(0);
    expect(of(FIRST)["doneMs"]).toBeGreaterThanOrEqual(of(FIRST)["shownMs"] as number);
    expect(signals[0]).toMatchObject({ sessionId: expect.stringMatching(/^[A-Za-z0-9_-]{16,}$/) });

    // A follow-up asked from it: counted for this answer, the totals sent whole.
    await log.getByRole("button", { name: "Which stack did he use?" }).click();
    await expect.poll(() => of(FIRST)["followups"]).toBe(1);
    expect(typeof of(FIRST)["doneMs"]).toBe("number");

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
    await expect(page.locator("#about [role=log]")).toContainText("A long");
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

    const log = page.locator("#about [role=log]");
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

    const step = page.locator("#about [role=log] p", { hasText: 'search "evals"' });
    const spinner = step.locator(".step-spin");
    await expect(spinner).toBeVisible();
    // Reduced motion: a static ellipsis. Otherwise it spins.
    expect(await spinner.evaluate((el) => getComputedStyle(el, "::after").content)).toBe('"…"');
    await page.emulateMedia({ reducedMotion: "no-preference" });
    expect(await spinner.evaluate((el) => getComputedStyle(el, "::after").animationName)).not.toBe(
      "none",
    );
    await expect(step).toContainText("✓");
    await expect(spinner).toHaveCount(0);
  });

  test("an empty terminal suggests starter questions; one asks at once", async ({ page }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "Evals on every prompt change." })),
    );
    await page.goto("/en");
    await interactive(page);
    // Before the prompt's code loads, About's placeholder draws the same row.
    const starters = page.locator("#about").getByRole("group", { name: "Suggested questions" });
    await starters.getByRole("button", { name: "How does he test AI features?" }).click();

    const log = page.locator("#about [role=log]");
    await expect(log).toContainText("How does he test AI features?");
    await expect(log).toContainText("Evals on every prompt change.");
    const prompt = page.locator("#about textarea");
    await expect(prompt).toBeFocused();
    expect(mock.bodies).toHaveLength(1);
    await expect(starters).toHaveCount(0);

    // Cleared, the terminal is empty again, and suggests them again.
    await prompt.press("Control+l");
    await expect(starters.getByRole("button")).toHaveCount(3);
  });

  test("German pages ask in German", async ({ page }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "Er testet jede Änderung." })),
    );
    const prompt = await openPrompt(page, "/de");
    await run(prompt, "Wie testet er?");
    await expect(page.locator("#about [role=log]")).toContainText("Er testet jede Änderung.");
    expect(mock.bodies[0]!.locale).toBe("de");
  });

  test("while it thinks, the status is read once: its ticking clock is not", async ({ page }) => {
    await pausedStream(page, answer({ text: "Hybrid search." }), 0, 2000);
    await mockAsk(page, () => undefined);
    const prompt = await openPrompt(page);
    await run(prompt, "How does retrieval work?");

    const status = page.locator("#about").getByRole("status");
    // Seen: the seconds count up. Heard: no number, so nothing to read again.
    await expect(status).toContainText(/thinking… \d+\.\d s/);
    expect(await status.ariaSnapshot()).not.toMatch(/\d+\.\d s/);
    await expect(page.locator("#about [role=log]")).toContainText("Hybrid search.");
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
    const log = page.locator("#about [role=log]");

    await run(prompt, "First question");
    await expect(log).toContainText(/try again in 4[0-2]s/);
    // Heard once, from the terminal's live region; the countdown is for the eye
    // (a live region would read it again every second).
    await expect(page.locator('#about [aria-live="polite"]')).toContainText(/try again in 42s/);
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
    const log = page.locator("#about [role=log]");
    await expect(log).toContainText("The assistant is resting.");
    await expect(log).toContainText("project-one");
    await expect(log).toContainText("type `contact`");
    expect(mock.bodies).toHaveLength(0);
  });

  test("the hand-off to the contact form waits for the visitor's yes", async ({ page }) => {
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
    await attach.check();
    await page.locator("#contact-name").fill("Ada Lovelace");
    await page.locator("#contact-email").fill("ada@example.com");
    await page.getByRole("button", { name: "> send_message()" }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ message: summary, origin: "ask", ask: confirmed[0] });
  });

  test("the server's own offer, made when the model made none, is confirmed the same way", async ({
    page,
  }) => {
    const { summary, confirm, confirmed } = await offerHandoff(page, "fallback");
    await expect(page.locator("#about [role=log]")).toContainText("Happy to help you reach him.");
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
    await page.getByRole("button", { name: "> send_message()" }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toMatchObject({ message: summary, origin: "ask" });
    expect(sent[0]).not.toHaveProperty("ask");
  });

  test("a question asked in the hero is answered in the About terminal, and traced", async ({
    page,
  }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "He ships evals first.", tools: SEARCH_STEP })),
    );
    await page.goto("/en");
    await interactive(page);
    const bar = page.getByRole("textbox", { name: "ask my portfolio" });
    await bar.fill("How does he test?");
    await bar.press("Enter");

    const log = page.locator("#about [role=log]");
    await expect(log).toContainText("How does he test?");
    await expect(log).toContainText("He ships evals first.");
    await expect(page.locator("#about textarea")).toBeFocused();
    expect(mock.bodies).toHaveLength(1);
    // The hero's trace panel replays that answer instead of the example.
    const trace = page.locator("#hero figure");
    await expect(trace).toContainText("your last question · 1.3 s");
    await expect(trace).toContainText("search_portfolio · 1 lookup");
    await expect(trace).not.toContainText("example trace");
  });

  test("“/” focuses the ask bar, unless typing; a starter question sends at once", async ({
    page,
  }) => {
    await mockAsk(page, (route) => sse(route, answer({ text: "Hybrid search." })));
    await page.goto("/en");
    await interactive(page);
    const bar = page.getByRole("textbox", { name: "ask my portfolio" });
    await page.keyboard.press("/");
    await expect(bar).toBeFocused();
    await bar.pressSequentially("a/b");
    await expect(bar).toHaveValue("a/b");

    await page
      .locator("#hero")
      .getByRole("group", { name: "Suggested questions" })
      .getByRole("button", { name: "What has he shipped with RAG?" })
      .click();
    await expect(page.locator("#about [role=log]")).toContainText("Hybrid search.");
  });

  test("an empty ask bar still goes to the prompt", async ({ page }) => {
    await mockAsk(page, () => undefined);
    await page.goto("/en");
    await interactive(page);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.locator("#about textarea")).toBeFocused();
  });

  test("other pages open the same assistant in a sheet", async ({ page }) => {
    await mockAsk(page, (route) => sse(route, answer({ text: "From the sheet." })));
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page.getByRole("button", { name: "ask my portfolio" }).click();
    const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
    const prompt = sheet.locator("textarea");
    await expect(prompt).toBeFocused();
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
    const button = page.getByRole("button", { name: "ask my portfolio" });
    await expect(button.getByText("ask", { exact: true })).toBeVisible();
    await expect(button).toHaveAttribute("aria-keyshortcuts", "/");

    await page.keyboard.press("/");
    const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
    const prompt = sheet.locator("textarea");
    await expect(prompt).toBeFocused();
    await expect(sheet.locator("app-terminal-window header")).toContainText("online");
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

  test("a case study's end block asks the assistant about that project", async ({ page }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "A retrieval platform, built in TypeScript." })),
    );
    await page.goto("/en/work/project-one");
    await interactive(page);
    await page.getByRole("button", { name: "Ask about TODO: Project One" }).click();
    const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
    await expect(sheet).toContainText("What did he build in TODO: Project One, and how?");
    await expect(sheet).toContainText("A retrieval platform, built in TypeScript.");
    expect(mock.bodies).toHaveLength(1);
    // The page goes with the question (visitor plan V8): the server maps it to the case study.
    expect(mock.bodies[0]!.page).toBe("/en/work/project-one");
  });

  test("a case study's section and code buttons ask about what they point at (visitor plan V9)", async ({
    page,
  }) => {
    const mock = await mockAsk(page, (route) =>
      sse(route, answer({ text: "Retrieval stays inside the private network." })),
    );
    await page.goto("/en/work/project-one");
    await interactive(page);
    const sheet = page.getByRole("dialog", { name: "ask my portfolio" });

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
    await expect(sheet).toContainText("· Architecture decisions");
    await expect(sheet).toContainText("Retrieval stays inside the private network.");
    expect(mock.bodies[0]).toMatchObject({
      page: "/en/work/project-one",
      focus: { kind: "section", id: "architecture-decisions" },
    });

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await page.getByRole("button", { name: "Explain code block 1" }).click();
    await expect(sheet).toContainText("Explain this code");
    await expect(sheet).toContainText("· const answer = await retrieve");
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
    const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
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
    const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
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
    const about = page.locator("#about");
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
    const log = page.locator("#about [role=log]");

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
    await expect(receipt).toHaveText(/fast model · 1 lookup · 1 source checked/);

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
      expect(copied).toContain("user@portfolio:~$ inspect");
      expect(copied).toMatch(/route {11}lite · reason: default/);
    }
    expect(await axeViolations(page)).toEqual([]);

    // A careful answer, with a reference removed and a move to the deep model: it shows by itself.
    await run(prompt, "What does he earn?");
    await expect(log).toContainText("Only what is published");
    await expect(receipt.last()).toHaveText(
      /moved to the thorough model: it read two projects · 2 lookups · 1 source checked · 1 invented reference removed · careful topic: published facts only/,
    );
    await expect(log.getByRole("button", { name: "how was this answered?" })).toHaveCount(1);
    // The hero's panel replays that answer's real steps.
    const trace = page.locator("#hero figure");
    await expect(trace).toContainText("lite → deep · two projects read");
    await expect(trace).toContainText("1 verified · 1 removed");

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

    const status = page.locator("#about [data-failover]");
    await expect(status).toHaveText("the first model is busy, trying another (2 of 3)");
    await expect(page.locator("#about [aria-live=polite]")).toHaveText(
      "the first model is busy, trying another (2 of 3)",
    );
    await expect(page.locator("#about [role=log]")).toContainText("From the second model.");
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
    const prompt = await openPrompt(page);
    const log = page.locator("#about [role=log]");
    // The config has come: it says whether the scorecard is published.
    await expect(page.locator("#about app-terminal-window header").first()).toContainText("online");

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
    const prompt = await openPrompt(page);
    const log = page.locator("#about [role=log]");
    await expect(page.locator("#about app-terminal-window header").first()).toContainText("online");
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
    const log = page.locator("#about [role=log]");

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
      /^TODO: Project Two/,
      /^Shipping RAG to production/,
    ]);
    await expect(readNext.getByRole("link").nth(1)).toContainText("case study · updated");
    // The article's end, before its footer; fetched once.
    await expect(page.locator("article > nav.read-next + footer")).toHaveCount(1);
    expect(maps).toEqual(["en"]);

    // How two pages connect is a question asked on this page (V8).
    await readNext.getByRole("button", { name: "How do they connect?" }).nth(1).click();
    const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
    await expect(sheet).toContainText("How do TODO: Project One and TODO: Project Two connect?");
    await expect(sheet).toContainText("Both run on the same retrieval stack.");
    expect(mock.bodies[0]).toMatchObject({ page: "/en/work/project-one" });
    await page.keyboard.press("Escape");

    // A post: the project it names, opened through the router.
    await page.goto("/en/writing/shipping-rag-to-production");
    await interactive(page);
    await page.locator("article > footer").scrollIntoViewIfNeeded();
    const postNext = page.getByRole("navigation", { name: "Read next" });
    await expect(postNext.getByRole("link")).toHaveText([/^TODO: Project One/]);
    await postNext.getByRole("link").click();
    await expect(page).toHaveURL(/\/en\/work\/project-one$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("TODO: Project One");
  });

  test("news offers what's new, stores nothing before a yes, and lists what changed since the last visit (visitor plan V15)", async ({
    page,
  }) => {
    const mock = await mockAsk(page, (route) => sse(route, answer({ text: "Two pages changed." })));
    const maps = await mockMap(page);
    const kept = () => page.evaluate(() => localStorage.getItem("ask:news"));
    const prompt = await openPrompt(page);
    const log = page.locator("#about [role=log]");

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
    await expect(log).toContainText("TODO: Project One · case study");
    await expect(log).toContainText("Shipping RAG to production · post");
    await expect(log).not.toContainText("Notes on evals");
    expect(mock.bodies).toHaveLength(0);
    await log.getByRole("button", { name: "summarize them ›" }).click();
    await expect(log).toContainText("Two pages changed.");
    expect(JSON.stringify(mock.bodies.at(-1)!.messages.at(-1))).toContain(
      "Summarize what is new on these pages: TODO: Project One, Shipping RAG to production.",
    );

    await run(again, "news off");
    await expect(log).toContainText("What's new is off");
    expect(await kept()).toBeNull();
  });

  test("tour runs the short tour from end to end: the About terminal, the sheet elsewhere, a reload, the last stop's offer (visitor plan V16)", async ({
    page,
  }) => {
    const mock = await mockAsk(page, (route) => sse(route, answer({ text: "unused" })));
    const prompt = await openPrompt(page);
    const log = page.locator("#about [role=log]");

    // No model: the short tour comes from the page's own content.
    await run(prompt, "tour");
    await expect(log).toContainText("The short tour, 5 stops:");
    await expect(log).toContainText("TODO: Project One");
    await expect(log).toContainText("Shipping RAG to production");
    const group = page.getByRole("group", { name: "tour · 5 stops" });
    await expect(group).toBeVisible();
    expect(mock.bodies).toHaveLength(0);

    // The first stop is About, on this page; the keyboard reaches the group's next.
    await group.getByRole("button", { name: "next" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "tour · stop 1 of 5 · about" })).toBeVisible();
    await expect(log).toContainText("ask about this ›");

    // Typed, as in any shell. To another page: the sheet carries the tour on.
    await run(prompt, "next");
    await expect(page).toHaveURL(/\/en\/work\/project-one$/);
    const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
    await expect(
      sheet.getByRole("group", { name: "tour · stop 2 of 5 · TODO: Project One" }),
    ).toBeVisible();

    // The tab keeps it through a reload.
    await page.reload();
    await interactive(page);
    await page.getByRole("button", { name: "ask my portfolio" }).click();
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
    const offer = sheet.getByRole("group", { name: "Hand this conversation to the contact form?" });
    await expect(offer).toBeVisible();
    await offer.getByRole("button", { name: "yes" }).click();
    await expect(page.locator("#contact-message")).toHaveValue(
      "Hi Alireza, I took the tour of your portfolio and would like to get in touch.",
    );
    expect(mock.bodies).toHaveLength(0);
  });

  test("tour <interest> asks the server once and takes its checked stops; tour stop ends it (visitor plan V16)", async ({
    page,
  }) => {
    const stops = [
      {
        id: "project:project-two@en",
        title: "TODO: Project Two",
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
          title: "TODO: Project Two",
        },
        { type: "text-start", id: "intro" },
        {
          type: "text-delta",
          id: "intro",
          delta: "Three stops on data platforms, from Project Two [^project:project-two@en].",
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
    const log = page.locator("#about [role=log]");
    await run(prompt, "tour data platforms");
    await expect(log).toContainText("Three stops on data platforms");
    const list = log.getByRole("list", { name: "Stops" });
    await expect(list.getByRole("link")).toHaveText([
      "TODO: Project Two",
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
    const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
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
            title: "TODO: Project Two",
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
    const prompt = page.locator("#about textarea.terminal-input");
    const log = page.locator("#about [role=log]");
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
      await expect(log.locator("a.note", { hasText: "TODO: Project Two" })).toHaveCount(i + 1);
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
    const prompt = page.locator("#about textarea.terminal-input");
    const log = page.locator("#about [role=log]");
    const live = page.locator("#about [aria-live=polite]");
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

  test("a shared link puts its question in the prompt and sends nothing until Enter; share copies one (visitor plan V17)", async ({
    page,
    context,
    browserName,
    baseURL,
  }) => {
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
    const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
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

    // On home, the About terminal waits with it.
    await page.goto(`/en?ask=${encodeURIComponent("Is he available?")}`);
    await interactive(page);
    await expect(page.locator("#about textarea")).toHaveValue("Is he available?");
    expect(new URL(page.url()).search).toBe("");
    expect(mock.bodies).toHaveLength(1);
  });

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
      await page.getByRole("button", { name: "ask my portfolio" }).click();
      const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
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
      const sheet = page.getByRole("dialog", { name: "ask my portfolio" });
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
  });
}

test.describe("assistant on a phone", () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

  test("focusing the prompt opens the terminal full screen; Esc closes it", async ({ page }) => {
    await mockAsk(page, () => undefined);
    const prompt = await openPrompt(page);
    await prompt.focus();
    const frame = page.locator("#about .ask-expanded");
    await expect(frame).toBeVisible();
    const box = await frame.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(389);
    await expect(prompt).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(frame).toHaveCount(0);

    // Or its close button, a 44px target.
    await prompt.focus();
    const close = frame.getByRole("button", { name: "Close the assistant" });
    const target = await close.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
    await close.click();
    await expect(frame).toHaveCount(0);
  });

  test("tabbing out of the full-screen terminal closes it, so focus never hides behind it", async ({
    page,
  }) => {
    await mockAsk(page, () => undefined);
    const prompt = await openPrompt(page);
    await prompt.focus();
    const frame = page.locator("#about .ask-expanded");
    await expect(frame).toBeVisible();

    // Through its own controls, then on to the page.
    for (let i = 0; i < 12 && (await frame.count()) > 0; i++) await page.keyboard.press("Tab");
    await expect(frame).toHaveCount(0);
    await expect(page.locator(":focus")).toBeInViewport();
  });
});
