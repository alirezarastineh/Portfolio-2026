import { readFileSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import type { Page, Route } from "@playwright/test";

import { expect, interactive, test } from "./fixtures";

/**
 * The admin against the production build, with its API faked in the browser:
 * the page header, the dashboard's tiles, the sidebar's counts and Publish,
 * the load states and the login. No database, no real API: every call the
 * admin makes is answered below, and anything else is recorded as unmocked.
 */

const content = (locale: "en" | "de") =>
  JSON.parse(
    readFileSync(new URL(`../src/app/content/fallback.${locale}.json`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;

const USER = { id: "u1", email: "admin@example.com", totpEnrolled: true };
/** A 1×1 GIF: an image the fake media library can show without a server. */
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=";
const NOW = new Date().toISOString();
const HOUR_AGO = new Date(Date.now() - 3600_000).toISOString();

function message(id: string, name: string, status: string) {
  return {
    id,
    createdAt: HOUR_AGO,
    locale: "en",
    name,
    email: `${id}@example.com`,
    message: `A message from ${name}.`,
    status,
    mailStatus: "sent",
    mailError: null,
  };
}

/** What each admin endpoint answers; a function may vary its answer per call. */
type Answer = unknown | ((call: number) => { status: number; body: unknown });

interface FixtureProject {
  slug: string;
  name: string;
  descriptor: string;
  hook: string;
  problem: string;
  aiArchitecture: string;
  fullStackInfra: string;
  outcomes: string[];
  role: string;
  stack: string[];
  tags: string[];
  featured: boolean;
  metrics: unknown[];
}

/** A fixture project as the editor loads it. */
function projectRow(en: FixtureProject, de: FixtureProject, i: number) {
  const text = (p: FixtureProject) => ({
    name: p.name,
    descriptor: p.descriptor,
    hook: p.hook,
    problem: p.problem,
    aiArchitecture: p.aiArchitecture,
    fullStackInfra: p.fullStackInfra,
    outcomes: p.outcomes,
    role: p.role,
    categoryLabel: "",
    metrics: p.metrics,
    body: "",
    seoDescription: "",
  });
  return {
    id: `p${i}`,
    slug: en.slug,
    position: i,
    coverId: null,
    coverPath: null,
    stack: en.stack,
    linkLive: "",
    linkRepo: "",
    linkCaseStudy: "",
    isVisible: true,
    featured: en.featured,
    periodStart: null,
    periodEnd: null,
    category: "",
    tags: en.tags,
    gallery: [],
    createdAt: NOW,
    updatedAt: NOW,
    translations: { en: text(en), de: text(de) },
  };
}

function mediaAsset(id: string, name: string, change: Record<string, unknown> = {}) {
  return {
    id,
    filename: `${id}.png`,
    originalName: name,
    mime: "image/png",
    kind: "image",
    byteSize: 120_000,
    width: 1200,
    height: 800,
    blurDataUri: null,
    altEn: "A diagram",
    altDe: null,
    createdAt: HOUR_AGO,
    url: PIXEL,
    path: `/media/${id}.png`,
    variants: [],
    usage: { draft: [], live: false, recent: false },
    ...change,
  };
}

const VERDICT_LABELS = ["correct", "grounded", "helpful", "tone", "language"] as const;

/** `GET /admin/assistant/outcomes`: a month of answers, the primary metric's weekly reviews. */
function outcomesView(metric: string, rotate: boolean) {
  return {
    days: 30,
    outcomes: {
      answers: 40,
      answered: 38,
      helpful: 30,
      funnel: { offered: 4, confirmed: 2, sent: 1 },
      rated: { up: 3, down: 1 },
      helpfulRate: 30 / 38,
      thumbsUpRate: 0.75,
      unknownRate: 0.1,
      rephraseRate: 0.05,
      usd: 0.1,
      costPerAnswered: 0.0026,
      costPerHelpful: 0.0033,
    },
    primary: {
      metric,
      weeks: [
        { week: "2026-W36", value: 0.7 },
        { week: "2026-W37", value: 0.79 },
        { week: "2026-W38", value: 0.795 },
        { week: "2026-W39", value: 0.8 },
      ],
      rotate,
    },
    metrics: ["helpfulRate", "thumbsUpRate", "unknownRate", "rephraseRate"],
  };
}

/** A review week's label shares before anyone gave a verdict. */
function noVerdicts() {
  return Object.fromEntries(VERDICT_LABELS.map((l) => [l, { good: 0, bad: 0 }]));
}

/** An answer as the assistant's Conversations and Reviews tabs list it. */
function answerRow(id: string, question: string, change: Record<string, unknown> = {}) {
  return {
    id,
    createdAt: NOW,
    session: "a1b2c3d4e5",
    locale: "en",
    route: "lite",
    question,
    answer: `An answer to “${question}”`,
    citedIds: [],
    droppedCitations: [],
    toolCalls: [],
    model: "gemini-flash",
    attempts: [],
    ttftMs: 800,
    totalMs: 2_000,
    tokens: { input: 1_000, cached: 0, output: 50, thoughts: 0 },
    usd: 0.001,
    finishReason: "stop",
    promptVersion: "ask-test",
    corpusKey: "en:1",
    checks: null,
    feedback: null,
    trace: null,
    ...change,
  };
}

/** The assistant's settings as the Settings tab loads them. */
function assistantSettings(change: Record<string, unknown> = {}) {
  return {
    enabled: true,
    dailyBudgetUsd: null,
    deepEnabled: true,
    suggestedQuestions: { en: [], de: [] },
    systemCard: { en: "", de: "" },
    publicReserve: 0.5,
    featureCaps: {
      playground: null,
      copilot: null,
      insights: null,
      eval: null,
      pairwise: null,
      judge: null,
      autoInsights: null,
      agent: null,
      embeddings: null,
    },
    featureSwitches: {
      copilot: true,
      judge: true,
      autoInsights: false,
      agent: false,
      embeddings: false,
    },
    updatedAt: HOUR_AGO,
    ...change,
  };
}

/** The Trust tab's view: who may do what, and whatever waits for a person. */
function trustView(change: Record<string, unknown> = {}) {
  return {
    registry: [
      {
        action: "navigate",
        actor: "assistant",
        level: "L1",
        approver: "none",
        enforcement: "tools.ts allowedPath",
        reversible: true,
        built: true,
      },
      {
        action: "agent.apply",
        actor: "agent",
        level: "L1",
        approver: "admin",
        enforcement: "Plan phase 30",
        reversible: true,
        built: false,
      },
      {
        action: "publish",
        actor: "admin",
        level: "human",
        approver: "admin",
        enforcement: "routes/admin.ts",
        reversible: true,
        built: true,
      },
    ],
    rules: {
      faithfulnessFloor: 0.8,
      judgedWindow: 50,
      judgedMinimum: 20,
      deepErrorCeiling: 0.2,
      deepWindow: 30,
    },
    demoted: [],
    alerts: [],
    audit: [],
    lastCheck: null,
    ...change,
  };
}

/** What the deploy configured, read-only under the settings. */
const ASSISTANT_ENV = {
  enabled: true,
  unavailableReason: null,
  defaultBudgetUsd: 2,
  keys: { gemini: true, openrouter: false },
  chains: { lite: [], deep: [], copilot: [], insight: [] },
  limits: {
    ratePerHour: 20,
    ratePerDay: 60,
    maxConcurrent: 4,
    maxOutputTokens: 1024,
    historyTurns: 6,
  },
  prompt: "ask-test+000000000000",
};

function defaults(): Record<string, Answer> {
  const en = content("en");
  const de = content("de");
  const projects = (en["projects"] as FixtureProject[]).map((p, i) =>
    projectRow(p, (de["projects"] as FixtureProject[])[i]!, i),
  );
  const identity = en["identity"] as Record<string, string>;
  return {
    "GET /auth/me": { user: USER, pendingTotp: false, csrfToken: "x" },
    "GET /admin/status": {
      user: USER,
      pointers: [
        { locale: "en", versionId: 12, publishedAt: HOUR_AGO },
        { locale: "de", versionId: 12, publishedAt: HOUR_AGO },
      ],
      lastEdit: NOW,
      lastPublish: HOUR_AGO,
      hasUnpublishedChanges: true,
    },
    "GET /admin/publish/review": {
      canPublish: true,
      locales: [
        {
          locale: "en",
          issues: [],
          changed: true,
          draft: { ui: { a: "2", b: "new" } },
          live: { ui: { a: "1" } },
          liveVersionId: 12,
          docs: [],
        },
        {
          locale: "de",
          issues: [],
          changed: true,
          draft: { ui: { a: "2" } },
          live: { ui: { a: "1" } },
          liveVersionId: 12,
          docs: [],
        },
      ],
    },
    "GET /admin/messages": {
      messages: [
        message("m1", "Ada Lovelace", "new"),
        message("m2", "Grace Hopper", "new"),
        message("m3", "Spam Bot", "spam"),
        message("m4", "Alan Turing", "read"),
      ],
    },
    "GET /admin/i18n": {
      items: [
        {
          kind: "project",
          id: "p1",
          label: "Project One",
          missingDe: ["hook"],
          missingEn: [],
          stale: false,
          absent: null,
        },
      ],
    },
    "GET /admin/assistant/health": {
      state: { state: "ok", deepAllowed: true, spentUsd: 0.42, budgetUsd: 2 },
      spend: {
        totalUsd: 0.42,
        budgetUsd: 2,
        publicReserve: 0.5,
        reserveLineUsd: 1,
        features: [
          { feature: "terminal", spentUsd: 0.12, capUsd: null, switchedOn: null, state: "ok" },
          { feature: "eval", spentUsd: 0.3, capUsd: 0.3, switchedOn: null, state: "cap" },
          { feature: "copilot", spentUsd: 0, capUsd: null, switchedOn: true, state: "ok" },
          { feature: "agent", spentUsd: 0, capUsd: null, switchedOn: false, state: "off" },
        ],
      },
      inFlight: 0,
      breakers: [
        {
          model: "gemini-flash",
          state: "open",
          openUntil: NOW,
          consecutiveFailures: 3,
          lastSuccessAt: HOUR_AGO,
          lastFailureAt: NOW,
          lastError: "quota",
          p50TtftMs: 420,
        },
      ],
      last24h: { answers: 12, failures: 3, fallbackRate: 0.1, models: [] },
      corpus: null,
    },
    "GET /admin/publications": {
      publications: [
        {
          id: 12,
          kind: "publish",
          label: "New case study",
          schemaVersion: 2,
          restoredFrom: null,
          createdAt: HOUR_AGO,
          versions: [
            { id: 23, locale: "en", live: true },
            { id: 24, locale: "de", live: true },
          ],
          live: true,
        },
      ],
    },
    "GET /admin/media-reconcile": {
      missingFiles: [],
      orphanFiles: [],
      totalAssets: 0,
      totalBytes: 0,
    },
    "GET /admin/content/preview/en": en,
    "GET /admin/content/preview/de": de,
    "GET /admin/sections/ui": {
      section: "ui",
      updatedAt: HOUR_AGO,
      data: { en: en["ui"], de: de["ui"] },
    },
    "GET /admin/assistant/usage": {
      days: 30,
      primaryModel: "gemini-flash",
      models: [],
      answers: [],
      guardEvents: [],
      checks: [],
      features: [],
    },
    "GET /admin/assistant/settings": { settings: assistantSettings(), env: ASSISTANT_ENV },
    "GET /admin/assistant/trust": trustView(),
    "GET /admin/assistant/runs": { runs: [] },
    "GET /admin/assistant/outcomes": outcomesView("helpfulRate", false),
    "GET /admin/assistant/judge": {
      fixtureJudge: "gemini-flash-lite",
      visitorJudge: "gemini-flash-lite",
      calibration: {
        pairs: 0,
        agree: 0,
        agreement: null,
        calibrated: null,
        judgeLenient: 0,
        judgeStrict: 0,
      },
      unjudged: 0,
      answerers: ["lite", "deep", "gemini-flash-lite", "gemini-flash"],
    },
    "GET /admin/assistant/eval-cases": { cases: [] },
    "GET /admin/assistant/reviews": {
      week: "2026-W40",
      previous: "2026-W39",
      next: null,
      queue: [],
      stats: { answers: 0, queued: 0, reviewed: 0, labels: noVerdicts() },
    },
    "GET /admin/profile": {
      profile: {
        name: identity["name"],
        handle: identity["handle"],
        contactEmail: identity["contactEmail"],
        primaryCtaHref: "#projects",
        secondaryCtaHref: "#contact",
        siteUrl: "",
        availability: "open",
        locationCity: "Berlin",
        locationCountry: "DE",
        timezone: "Europe/Berlin",
        avatarId: null,
        avatarPath: null,
        updatedAt: HOUR_AGO,
      },
    },
    "GET /admin/resumes": { resumes: { en: null, de: null } },
    "GET /admin/projects": { projects },
    "GET /admin/projects/p0": { project: projects[0] },
    "GET /admin/media": {
      media: [
        mediaAsset("a1", "architecture.png", {
          usage: { draft: ["project:project-one"], live: true, recent: true },
        }),
        mediaAsset("a2", "old-screenshot.png"),
      ],
    },
  };
}

const CORS = {
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "content-type, x-csrf-token",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE",
};

/** Answers the admin API wherever the build points it; returns what went unanswered. */
async function fakeApi(
  page: Page,
  baseURL: string | undefined,
  overrides: Record<string, Answer> = {},
): Promise<string[]> {
  const answers = { ...defaults(), ...overrides };
  const calls = new Map<string, number>();
  const unmocked: string[] = [];
  const origin = new URL(baseURL ?? "http://127.0.0.1").origin;

  const handle = async (route: Route) => {
    const request = route.request();
    const headers = { ...CORS, "access-control-allow-origin": request.headers()["origin"] ?? "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });

    const key = `${request.method()} ${new URL(request.url()).pathname}`;
    const call = (calls.get(key) ?? 0) + 1;
    calls.set(key, call);
    const answer = answers[key];
    if (answer === undefined) {
      unmocked.push(key);
      return route.fulfill({ status: 404, headers, json: { error: "not_found" } });
    }
    const { status, body } =
      typeof answer === "function"
        ? (answer as (n: number) => { status: number; body: unknown })(call)
        : { status: 200, body: answer };
    return route.fulfill({ status, headers, json: body });
  };

  // Registered after the fixture's catch-all, so these win for the API's calls.
  await page.route(
    (url) => /^\/(?:admin|auth)\//.test(url.pathname) && url.origin !== origin,
    handle,
  );
  // An empty VITE_API_BASE_URL sends them to this origin instead: only the data calls.
  await page.route(
    (url) => /^\/(?:admin|auth)\//.test(url.pathname) && url.origin === origin,
    (route) =>
      ["fetch", "xhr"].includes(route.request().resourceType()) ? handle(route) : route.fallback(),
  );
  return unmocked;
}

/** The admin renders in the browser only: wait for its sidebar, not just hydration. */
async function openAdmin(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await interactive(page);
  await page.locator("[data-slot=sidebar-inset]").waitFor();
}

test.describe("admin", () => {
  test("the dashboard's tiles and the sidebar agree on what needs a look", async ({
    page,
    baseURL,
  }) => {
    const unmocked = await fakeApi(page, baseURL);
    await openAdmin(page, "/admin");

    const glance = page.getByRole("region", { name: "At a glance" });
    await expect(glance.getByText("3 changes")).toBeVisible();
    await expect(glance.getByText("EN 2 · DE 1")).toBeVisible();
    await expect(glance.getByText("2 new")).toBeVisible();
    await expect(glance.getByText("12 answers")).toBeVisible();
    await expect(glance.getByText("$0.42 of $2.00 today")).toBeVisible();
    await expect(glance.getByText("A model is failing: its breaker is open")).toBeVisible();
    await expect(glance.getByText("1 to check")).toBeVisible();

    // Spam stays out of the latest messages.
    const latest = page.getByRole("region", { name: "Latest messages" });
    await expect(latest.getByText("Ada Lovelace", { exact: true })).toBeVisible();
    await expect(latest.getByText("Spam Bot", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Recent publications" }).getByText("New case study"),
    ).toBeVisible();

    const sidebar = page.locator("[data-slot=sidebar-inner]");
    await expect(sidebar.getByRole("link", { name: "Inbox, 2 new" })).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Dashboard, 1 translation to check" }),
    ).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: /^Assistant, A model is failing/ }),
    ).toBeVisible();

    // Publish is in reach from the sidebar, and opens the one review.
    const publish = sidebar.getByRole("button", { name: "Publish: 3 changes unpublished" });
    await expect(publish).toBeEnabled();
    await publish.click();
    const review = page.getByRole("dialog", { name: "Review and publish" });
    await expect(review).toBeVisible();
    await expect(review.getByText("2 changes")).toBeVisible();

    expect(unmocked).toEqual([]);
  });

  test("the page header sticks to the top of a long editor, on a surface", async ({
    page,
    baseURL,
  }) => {
    await fakeApi(page, baseURL);
    await page.setViewportSize({ width: 1280, height: 720 });
    await openAdmin(page, "/admin/about");

    const title = page.getByRole("heading", { level: 1, name: "About" });
    await expect(title).toBeVisible();
    const row = page.locator(".sticky", { has: title });
    await expect(row).not.toHaveAttribute("data-stuck");
    await expect(page.getByRole("link", { name: "Preview (opens in a new tab)" })).toHaveAttribute(
      "target",
      "_blank",
    );

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect(row).toHaveAttribute("data-stuck", "");
    const box = await title.boundingBox();
    expect(box?.y ?? 999).toBeLessThan(40);
  });

  test("a section that did not load says so, and loads on Try again", async ({ page, baseURL }) => {
    await fakeApi(page, baseURL, {
      "GET /admin/sections/seo": (call: number) =>
        call === 1
          ? { status: 502, body: { error: "upstream_down" } }
          : {
              status: 200,
              body: {
                section: "seo",
                updatedAt: HOUR_AGO,
                data: { en: content("en")["seo"], de: content("de")["seo"] },
              },
            },
    });
    await openAdmin(page, "/admin/seo");

    const failed = page.getByRole("alert").filter({ hasText: "Could not load this section" });
    await expect(failed).toBeVisible();
    await expect(failed).toContainText("upstream_down");

    await failed.getByRole("button", { name: "Try again" }).click();
    await expect(failed).toHaveCount(0);
    await expect(page.getByText("Page title", { exact: true })).toBeVisible();
  });

  test("the sign-in is a terminal window that shakes at a wrong password", async ({
    page,
    baseURL,
  }) => {
    await fakeApi(page, baseURL, {
      "POST /auth/login": () => ({ status: 401, body: { error: "invalid_credentials" } }),
    });
    await page.goto("/admin/login");
    await interactive(page);

    const window = page.locator("app-terminal-window");
    await expect(window.locator("header")).toContainText("admin@portfolio — login");

    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password").fill("wrong-password");
    const shook = page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const frame = document.querySelector("app-terminal-window")!.parentElement!;
          frame.addEventListener("animationstart", () => resolve(true), { once: true });
          setTimeout(() => resolve(false), 3000);
        }),
    );
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
    expect(await shook).toBe(true);
  });

  test("the live preview draws the page with the editor's unsaved edits", async ({
    page,
    baseURL,
    problems,
  }) => {
    const en = content("en") as { ui: { profile: { heroHeadline: string } } };
    const de = content("de") as { ui: { profile: { heroHeadline: string } } };
    const unmocked = await fakeApi(page, baseURL);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAdmin(page, "/admin/hero");

    const toggle = page.getByRole("button", { name: "Live preview" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    const frame = page.locator("iframe[title^='Live preview']");
    const preview = page.frameLocator("iframe[title^='Live preview']");
    const headline = preview.locator("#hero-heading");
    await expect(headline).toContainText(en.ui.profile.heroHeadline);

    // Typed, not saved: the page follows, and the save bar counts it.
    await page.locator("#profile-heroHeadline-en").fill("Ships AI that answers with sources.");
    await expect(headline).toContainText("Ships AI that answers with sources.");
    await expect(page.locator("app-save-bar [role=status]")).toHaveText("1 field changed");

    // A picture, not a second site: nothing in it takes focus or clicks.
    expect(
      await frame.evaluate((el) =>
        (el as HTMLIFrameElement).contentDocument?.body.firstElementChild?.hasAttribute("inert"),
      ),
    ).toBe(true);

    // The phone is the page's own phone layout, not the desktop one squeezed.
    await page
      .getByRole("group", { name: "Preview width" })
      .getByRole("button", { name: "Phone" })
      .click();
    await expect
      .poll(() => frame.evaluate((el) => (el as HTMLIFrameElement).contentWindow?.innerWidth))
      .toBe(390);
    await page
      .getByRole("group", { name: "Preview language" })
      .getByRole("button", { name: "de" })
      .click();
    await expect(headline).toContainText(de.ui.profile.heroHeadline);

    await page.getByRole("button", { name: "Close the preview" }).click();
    await expect(frame).toHaveCount(0);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(problems.consoleErrors).toEqual([]);
    expect(problems.cspViolations).toEqual([]);
    expect(unmocked).toEqual([]);
  });

  test("the outline rail lists a long editor's sections and jumps to one", async ({
    page,
    baseURL,
  }) => {
    await fakeApi(page, baseURL);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openAdmin(page, "/admin/projects/project-one");

    const rail = page.getByRole("navigation", { name: "On this page" });
    await expect(rail.getByRole("link")).toHaveCount(10);
    // The fixture's stack is filled in; its card still says TODO.
    await expect(rail.getByRole("link", { name: /^Stack and tags\W+done/ })).toBeVisible();
    await expect(rail.getByRole("link", { name: /^On the card\W+to do/ })).toBeVisible();

    const metrics = rail.getByRole("link", { name: /^Metrics/ });
    await metrics.click();
    await expect(page.getByRole("heading", { level: 2, name: "Metrics" })).toBeFocused();
    await expect(metrics).toHaveAttribute("aria-current", "location");
  });

  test("the inbox shows a hand-off's attached conversation", async ({ page, baseURL }) => {
    const unmocked = await fakeApi(page, baseURL, {
      "GET /admin/messages": {
        messages: [
          {
            ...message("m9", "Ada Lovelace", "read"),
            message: "Wants to discuss a six-month contract for an AI platform.",
            origin: "ask",
            askTranscript: {
              v: 1,
              turns: [
                {
                  question: "Has he built RAG systems?",
                  answer: "Yes: Atlas cut escalations by 38% [^project:atlas@en].",
                  cited: ["project:atlas@en"],
                  at: HOUR_AGO,
                },
                {
                  question: "I want to hire him",
                  answer: "Happy to connect you.",
                  cited: [],
                  at: NOW,
                },
              ],
            },
          },
        ],
      },
    });
    await openAdmin(page, "/admin/inbox");
    await page.getByRole("region", { name: "Messages" }).getByRole("button").first().click();

    const reader = page.getByRole("region", { name: "Ada Lovelace" });
    await expect(reader.getByText("via the assistant")).toBeVisible();
    await expect(
      reader.getByText("Their conversation with the assistant (2 answers)"),
    ).toBeVisible();
    await expect(reader.getByText("Has he built RAG systems?")).toBeVisible();
    await expect(reader.getByText("cited: project:atlas@en")).toBeVisible();
    expect(unmocked).toEqual([]);
  });

  test("the Overview shows the outcomes and rotates the primary metric", async ({
    page,
    baseURL,
  }) => {
    const chosen: unknown[] = [];
    const unmocked = await fakeApi(page, baseURL, {
      "GET /admin/assistant/outcomes": (call: number) => ({
        status: 200,
        body: call > 1 ? outcomesView("unknownRate", false) : outcomesView("helpfulRate", true),
      }),
      "PUT /admin/assistant/primary-metric": () => ({ status: 200, body: { ok: true } }),
    });
    page.on("request", (r) => {
      if (r.method() === "PUT" && r.url().endsWith("/admin/assistant/primary-metric")) {
        chosen.push(r.postDataJSON());
      }
    });
    await openAdmin(page, "/admin/assistant");

    const outcomes = page.getByRole("region", { name: "Outcomes" });
    await expect(
      outcomes.getByText("4 offered → 2 confirmed (50 %) → 1 sent (50 %)"),
    ).toBeVisible();
    await expect(outcomes.getByText("Flat for two weekly reviews")).toBeVisible();
    await outcomes.getByLabel("Primary metric").selectOption("unknownRate");
    await expect.poll(() => chosen).toEqual([{ metric: "unknownRate" }]);
    await expect(outcomes.getByText("lower is better")).toBeVisible();
    await expect(outcomes.getByText("Flat for two weekly reviews")).toHaveCount(0);
    expect(unmocked).toEqual([]);
  });

  test("the inbox reads in two panes: J opens, E archives and opens the next", async ({
    page,
    baseURL,
  }) => {
    const statuses: string[] = [];
    const recordStatus = (id: string) => () => {
      statuses.push(id);
      return { status: 200, body: { ok: true } };
    };
    await fakeApi(page, baseURL, {
      "PATCH /admin/messages/m1": recordStatus("m1"),
      "PATCH /admin/messages/m2": recordStatus("m2"),
    });
    await openAdmin(page, "/admin/inbox");

    const list = page.getByRole("region", { name: "Messages" });
    // Spam has its own filter.
    await expect(list.getByRole("button")).toHaveCount(3);
    await expect(list).not.toContainText("Spam Bot");

    await page.keyboard.press("j");
    await expect(page.getByRole("region", { name: "Ada Lovelace" })).toBeVisible();
    // Opening a new message marks it read.
    await expect.poll(() => statuses).toEqual(["m1"]);

    await page.keyboard.press("e");
    await expect(page.getByRole("region", { name: "Grace Hopper" })).toBeVisible();
    await expect(list).not.toContainText("Ada Lovelace");
    await expect(list.locator("[aria-current=true]")).toContainText("Grace Hopper");
  });

  test("the palette runs actions, and ? lists the shortcuts", async ({ page, baseURL }) => {
    await fakeApi(page, baseURL);
    await openAdmin(page, "/admin");

    await page.keyboard.press("Control+k");
    const search = page.getByRole("combobox", { name: "Jump to a section or action…" });
    await expect(search).toBeFocused();
    // The first action is the one Enter runs on opening.
    await expect(page.getByRole("option", { selected: true })).toHaveAccessibleName(
      /^Review and publish/,
    );
    await page.keyboard.type("review");
    await expect(page.getByRole("option", { name: /^Review and publish/ })).toBeVisible();
    await page.keyboard.press("Enter");
    const review = page.getByRole("dialog", { name: "Review and publish" });
    await expect(review).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(review).toHaveCount(0);

    // A fresh search each time: the last one is not left behind.
    await page.keyboard.press("Control+k");
    await expect(search).toHaveValue("");
    await page.keyboard.press("Escape");

    await page.locator("main").click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("?");
    const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText("Archive the open message")).toBeVisible();
  });

  test("the assistant's tabs stay on one row on a phone", async ({ page, baseURL }) => {
    await fakeApi(page, baseURL);
    await page.setViewportSize({ width: 390, height: 844 });
    await openAdmin(page, "/admin/assistant");

    const tabs = page.getByRole("tablist", { name: "Assistant sections" });
    await expect(tabs.getByRole("tab")).toHaveCount(9);
    expect((await tabs.boundingBox())?.height ?? 99).toBeLessThan(44);
    await expect(page.getByText("Answering")).toBeVisible();
  });

  test("the assistant shows the day's signals and an answer's timeline", async ({
    page,
    baseURL,
  }) => {
    const today = new Date().toISOString().slice(0, 10);
    const tokens = { input: 12_000, cached: 1_500, output: 60, thoughts: 0 };
    const unmocked = await fakeApi(page, baseURL, {
      "GET /admin/assistant/usage": {
        days: 30,
        primaryModel: "gemini-flash",
        models: [],
        answers: [
          {
            day: today,
            answers: 5,
            up: 0,
            down: 0,
            withDropped: 1,
            flagged: 2,
            primaryInput: 10_000,
            primaryCached: 1_000,
          },
        ],
        guardEvents: [{ day: today, kind: "rate_limited", count: 2 }],
        checks: [{ flag: "uncited", count: 2 }],
      },
      "GET /admin/assistant/conversations": {
        messages: [
          {
            id: "m_trace000001",
            createdAt: new Date().toISOString(),
            session: "a1b2c3d4e5",
            locale: "en",
            route: "lite",
            question: "Which project cut support escalations?",
            answer: "Atlas cut escalations by 38% [^project:atlas@en].",
            citedIds: ["project:atlas@en"],
            droppedCitations: ["project:nebula@en"],
            toolCalls: ["search_portfolio", "get_document"],
            model: "gemini-flash",
            attempts: [],
            ttftMs: 820,
            totalMs: 2_900,
            tokens,
            usd: 0.0079,
            finishReason: "stop",
            promptVersion: "ask-test",
            corpusKey: "en:1",
            checks: { v: 1, flags: ["invented-citation"] },
            feedback: null,
            trace: {
              v: 1,
              steps: [
                {
                  model: "gemini-flash",
                  answerOnly: false,
                  ttftMs: 820,
                  tokens,
                  finishReason: "tool-calls",
                  passedOver: [{ model: "gemini-pro", outcome: "rate-limited", ms: 140 }],
                  tools: [
                    {
                      name: "get_document",
                      input: '{"id":"project:nebula@en"}',
                      outcome: "not_found",
                      resultChars: 48,
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    });
    await openAdmin(page, "/admin/assistant");

    const signals = page.getByRole("region", { name: "Signals" });
    await expect(
      signals.getByText("Under 50 %: the fixed prefix is not being reused."),
    ).toBeVisible();
    await expect(signals.getByText("rate_limited 2")).toBeVisible();
    await expect(signals.getByText(/uncited 2/)).toBeVisible();

    await page.getByRole("tab", { name: "Conversations" }).click();
    await expect(
      page.getByText("dropped (invented, never shown): project:nebula@en"),
    ).toBeVisible();
    await expect(page.getByText("invented citation", { exact: true })).toBeVisible();
    await page.locator("summary", { hasText: "Timeline" }).click();
    await expect(page.getByText("passed over: gemini-pro rate-limited (140 ms)")).toBeVisible();
    await expect(
      page.getByText(/get_document \{"id":"project:nebula@en"\} → not found/),
    ).toBeVisible();
    expect(unmocked).toEqual([]);
  });

  test("the Overview shows spend by feature, and Settings fences what the rest may spend", async ({
    page,
    baseURL,
  }) => {
    const saved: Record<string, unknown>[] = [];
    const unmocked = await fakeApi(page, baseURL, {
      "PUT /admin/assistant/settings": () => ({
        status: 200,
        body: { ok: true, settings: assistantSettings({ publicReserve: 0.6 }) },
      }),
    });
    page.on("request", (r) => {
      if (r.method() === "PUT" && r.url().endsWith("/admin/assistant/settings")) {
        saved.push(r.postDataJSON() as Record<string, unknown>);
      }
    });
    await openAdmin(page, "/admin/assistant");

    await expect(
      page.getByText("All but the terminal stop at $1.00 (50 % kept for visitors)"),
    ).toBeVisible();
    const spend = page.getByRole("region", { name: "Spending by feature" });
    await expect(spend.getByRole("row", { name: /Eval runs/ })).toContainText("stopped at its cap");
    await expect(spend.getByRole("row", { name: /Visitors' terminal/ })).toContainText("$0.12");
    // Work not built yet stays out of the table until it spends.
    await expect(spend.getByText("agent", { exact: true })).toHaveCount(0);

    await page.getByRole("tab", { name: "Settings" }).click();
    await page.getByLabel("Kept for visitors (% of the budget)", { exact: true }).fill("60");
    await page.getByLabel("Eval runs", { exact: true }).fill("0.5");
    // Each switch is named by its own label alone (a Spartan switch without an id takes the first's).
    const named = (name: string) => page.getByRole("switch", { name, exact: true });
    await expect(named("Deep model for comparisons and architecture questions")).toBeChecked();
    await expect(named("Judge runs")).toHaveAccessibleDescription(/agrees with you/);
    await named("Copilot").click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      publicReserve: 0.6,
      featureCaps: { eval: 0.5, copilot: null, pairwise: null },
      featureSwitches: { copilot: false, judge: true },
    });
    expect(unmocked).toEqual([]);
  });

  test("the Overview points to Trust, where an alert is marked seen and a demotion reinstated", async ({
    page,
    baseURL,
  }) => {
    const demotion = {
      subject: "route:deep",
      at: HOUR_AGO,
      reason: "8 of 30 answers failed (27 %; ceiling 20 %)",
    };
    const alert = {
      id: 7,
      at: HOUR_AGO,
      actor: "agent",
      action: "answer",
      target: "m_leak00000001",
      decision: "allowed",
      reason: "leak: the answer repeated a piece of the system prompt",
      alternatives: [],
      alert: true,
      seenAt: null,
    };
    const posted: string[] = [];
    let seen = false;
    let reinstated = false;
    const unmocked = await fakeApi(page, baseURL, {
      "GET /admin/assistant/health": () => ({
        status: 200,
        body: {
          state: { state: "ok", deepAllowed: true, spentUsd: 0.42, budgetUsd: 2 },
          trust: { alerts: seen ? 0 : 1, demoted: reinstated ? [] : [demotion] },
          inFlight: 0,
          breakers: [],
          last24h: { answers: 12, failures: 0, fallbackRate: 0, models: [] },
          corpus: null,
        },
      }),
      // The view follows what was posted: an alert seen, a demotion reinstated.
      "GET /admin/assistant/trust": () => ({
        status: 200,
        body: trustView({
          demoted: reinstated ? [] : [demotion],
          alerts: seen ? [] : [alert],
          audit: [alert],
          lastCheck: {
            ...alert,
            id: 6,
            actor: "system",
            action: "trust.check",
            target: "trust",
            alert: false,
            reason: "4 checked, 1 demoted, 0 refused",
            alternatives: [{ option: "demote route:deep", why: "demote: 8 of 30 answers failed" }],
          },
        }),
      }),
      "POST /admin/assistant/trust/alerts/7/seen": () => {
        seen = true;
        return { status: 200, body: { ok: true } };
      },
      "POST /admin/assistant/trust/reinstate": () => {
        reinstated = true;
        return { status: 200, body: { ok: true } };
      },
      "POST /admin/assistant/trust/check": () => ({
        status: 200,
        body: { checked: 4, demoted: [], refused: [] },
      }),
    });
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes("/admin/assistant/trust/")) {
        posted.push(`${new URL(r.url()).pathname} ${r.postData() ?? ""}`);
      }
    });
    await openAdmin(page, "/admin/assistant");

    await expect(
      page.getByText("1 alert and the deep route is demoted: see the Trust tab", {
        exact: true,
      }),
    ).toBeVisible();
    // The page header says so too, until it is resolved.
    await expect(page.getByText("needs a look")).toBeVisible();
    await page.getByRole("button", { name: "Open Trust", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Trust" })).toHaveAttribute("aria-selected", "true");

    const alerts = page.getByRole("region", { name: "Alerts" });
    await expect(
      alerts.getByText("leak: the answer repeated a piece of the system prompt"),
    ).toBeVisible();
    const check = page.getByRole("region", { name: "Nightly check" });
    await expect(check.getByText(/more than 20 % of its last 30 answers failed/)).toBeVisible();
    await expect(check.getByText("demote route:deep")).toBeVisible();
    const registry = page.getByRole("region", { name: "Who may do what" });
    await expect(registry.getByRole("row", { name: /publish/ })).toContainText("people only");
    await expect(registry.getByRole("row", { name: /agent\.apply/ })).toContainText("not built");

    await alerts.getByRole("button", { name: "Seen", exact: true }).click();
    const demoted = page.getByRole("region", { name: "Demoted" });
    await demoted.getByRole("button", { name: "Reinstate", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Reinstate", exact: true })
      .click();
    await expect(demoted.getByText("Every model and route is in service.")).toBeVisible();
    // Resolved here, cleared there: no reload needed.
    await expect(page.getByText("needs a look")).toHaveCount(0);

    await check.getByRole("button", { name: "Check now", exact: true }).click();
    await expect(page.getByText("4 checked · 0 demoted", { exact: true })).toBeVisible();
    await expect
      .poll(() => posted)
      .toEqual([
        "/admin/assistant/trust/alerts/7/seen {}",
        '/admin/assistant/trust/reinstate {"subject":"route:deep"}',
        "/admin/assistant/trust/check {}",
      ]);
    expect(unmocked).toEqual([]);
  });

  test("the Evals tab follows a background run it did not start, until it ends", async ({
    page,
    baseURL,
  }) => {
    const id = "5d9d0f5e-6f4b-4d2a-9d3e-0c7a2b1e4f10";
    const at = new Date().toISOString();
    const summary = {
      promptVersion: "ask-test",
      corpus: "eval-fixture-1",
      judge: "gemini-flash-lite",
      cases: 3,
      completed: 3,
      passed: 2,
      unavailable: 0,
      remaining: 0,
      incomplete: false,
      passRate: 2 / 3,
      byCategory: { fact: { cases: 3, completed: 3, passed: 2, unavailable: 0 } },
      usd: 0.006,
      p50TtftMs: 900,
      p95TotalMs: 3000,
    };
    const run = (status: string, done: number) => ({
      id,
      kind: "eval",
      status,
      params: {},
      progress: { total: 3, done, failed: 0, unavailable: 0 },
      summary: status === "done" ? summary : null,
      usd: done * 0.002,
      error: null,
      createdAt: at,
      startedAt: at,
      finishedAt: status === "done" ? at : null,
      heartbeatAt: at,
      live: status === "running",
    });
    const item = (key: string, position: number, passed: boolean | null) => ({
      key,
      position,
      status: passed === null ? "pending" : "done",
      attempts: passed === null ? 0 : 1,
      usd: 0.002,
      updatedAt: at,
      result:
        passed === null
          ? null
          : {
              id: key,
              category: "fact",
              status: passed ? "passed" : "failed",
              passed,
              failures: passed ? [] : ["did not cite project:atlas@en"],
              answer: "Atlas cut escalations by 38%.",
              cited: [],
              invented: [],
              tools: [],
              model: "gemini-flash-lite",
              ttftMs: 900,
              totalMs: 3000,
              usd: 0.002,
              judge: null,
              attempts: [],
            },
    });
    const unmocked = await fakeApi(page, baseURL, {
      // Another tab (or before a reload) started it: this page only follows it.
      "GET /admin/assistant/runs": { runs: [run("running", 1)] },
      [`GET /admin/assistant/runs/${id}`]: (call: number) => ({
        status: 200,
        body:
          call === 1
            ? {
                run: run("running", 1),
                items: [item("fact-a", 0, true), item("fact-b", 1, null), item("fact-c", 2, null)],
              }
            : {
                run: run("done", 3),
                items: [item("fact-a", 0, true), item("fact-b", 1, false), item("fact-c", 2, true)],
              },
      }),
    });
    await openAdmin(page, "/admin/assistant");
    await page.getByRole("tab", { name: "Evals" }).click();

    await expect(page.getByText("1 of 3 cases done")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel the run" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run the evals" })).toBeDisabled();

    // It keeps following the run until it ends.
    await expect(page.getByRole("heading", { name: /finished/ })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("3 of 3 cases done")).toBeVisible();
    await expect(page.locator("strong", { hasText: "2/3" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel the run" })).toHaveCount(0);
    expect(unmocked).toEqual([]);
  });

  test("the Evals tab compares two answerers, a verdict counting only when both orders agree", async ({
    page,
    baseURL,
  }) => {
    const id = "3f2a9c1e-8b7d-4e6f-a5b4-c3d2e1f0a9b8";
    const bodies: unknown[] = [];
    const side = (answer: string, failures: string[] = []) => ({
      answer,
      model: "gemini-flash",
      failures,
      usd: 0.001,
    });
    const item = (key: string, outcome: string) => ({
      key,
      position: 0,
      status: "done",
      attempts: 1,
      usd: 0.004,
      updatedAt: NOW,
      result: {
        id: key,
        category: "fact",
        status: "judged",
        a: side("Atlas shipped.", ["did not cite project:atlas@en"]),
        b: side("Atlas cut escalations by 38% [^project:atlas@en]."),
        verdicts: { aFirst: "second", bFirst: "first" },
        outcome,
        reasons: ["B cites its source.", "B cites its source."],
        usd: 0.004,
      },
    });
    const run = {
      id,
      kind: "pairwise",
      status: "done",
      params: { a: "lite", b: "deep", cases: null },
      progress: { total: 2, done: 2, failed: 0, unavailable: 0 },
      summary: {
        a: "lite",
        b: "deep",
        judge: "gemini-flash-lite",
        cases: 2,
        judged: 2,
        unavailable: 0,
        passed: { a: 0, b: 2 },
        tally: { a: 0, b: 1, tie: 0, inconsistent: 1 },
        byCategory: { fact: { a: 0, b: 1, tie: 0, inconsistent: 1 } },
        swapAgreement: 0.5,
        usd: 0.008,
      },
      usd: 0.008,
      error: null,
      createdAt: NOW,
      startedAt: NOW,
      finishedAt: NOW,
      heartbeatAt: NOW,
      live: false,
    };
    const unmocked = await fakeApi(page, baseURL, {
      "POST /admin/assistant/runs": () => ({ status: 202, body: { id } }),
      [`GET /admin/assistant/runs/${id}`]: {
        run,
        items: [item("fact-atlas-impact", "b"), item("fact-atlas-team", "inconsistent")],
      },
    });
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/admin/assistant/runs")) {
        bodies.push(r.postDataJSON());
      }
    });
    await openAdmin(page, "/admin/assistant");
    await page.getByRole("tab", { name: "Evals" }).click();

    const compare = page.getByRole("region", { name: "Compare two answerers" });
    await expect(compare.getByLabel("A")).toHaveValue("lite");
    await compare.getByLabel("B").fill("deep");
    await compare.getByRole("button", { name: "Compare", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Compare" }).click();

    await expect(
      compare.getByText("B (deep) ahead: 0 to 1, 0 ties; the orders disagreed on 1."),
    ).toBeVisible();
    await expect(compare.locator("strong", { hasText: "50 %" })).toBeVisible();
    await expect(compare.getByText("orders disagree", { exact: true })).toBeVisible();
    expect(bodies).toEqual([{ kind: "pairwise", a: "lite", b: "deep" }]);
    expect(unmocked).toEqual([]);
  });

  test("the Reviews tab shows the judge's calibration and judges the reviewed answers", async ({
    page,
    baseURL,
  }) => {
    const id = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";
    const calibration = (calibrated: boolean, agree: number) => ({
      pairs: 12,
      agree,
      agreement: agree / 12,
      calibrated,
      judgeLenient: 12 - agree,
      judgeStrict: 0,
    });
    const status = (after: boolean) => ({
      fixtureJudge: "gemini-flash-lite",
      visitorJudge: "gemini-flash-lite",
      calibration: after ? calibration(true, 10) : calibration(false, 6),
      unjudged: after ? 0 : 3,
      answerers: ["lite", "deep"],
    });
    const judgeRun = (status: string) => ({
      id,
      kind: "judge",
      status,
      params: { judge: "gemini-flash-lite" },
      progress: { total: 3, done: status === "done" ? 3 : 1, failed: 0, unavailable: 0 },
      summary: null,
      usd: 0.001,
      error: null,
      createdAt: NOW,
      startedAt: NOW,
      finishedAt: status === "done" ? NOW : null,
      heartbeatAt: NOW,
      live: status === "running",
    });
    const unmocked = await fakeApi(page, baseURL, {
      "GET /admin/assistant/judge": (call: number) => ({ status: 200, body: status(call > 1) }),
      "POST /admin/assistant/runs": () => ({ status: 202, body: { id } }),
      [`GET /admin/assistant/runs/${id}`]: (call: number) => ({
        status: 200,
        body: { run: judgeRun(call > 1 ? "done" : "running"), items: [] },
      }),
    });
    await openAdmin(page, "/admin/assistant");
    await page.getByRole("tab", { name: "Reviews" }).click();

    const panel = page.getByRole("region", { name: "The judge against reviewers" });
    await expect(
      panel.getByText(
        "Uncalibrated: the judge agrees with reviewers on 50 % of 12 answers (6 passed that reviewers failed, 0 the reverse).",
      ),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Judge 3 reviewed answers" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Judge" }).click();
    await expect(
      panel.getByText(/^Calibrated: the judge agrees with reviewers on 83 %/),
    ).toBeVisible({
      timeout: 10_000,
    });
    await expect(panel.getByRole("button", { name: /^Judge \d/ })).toHaveCount(0);
    expect(unmocked).toEqual([]);
  });

  test("resuming an eval run asks first, since it spends", async ({ page, baseURL }) => {
    const id = "7c1e5b0a-2f4d-4c1b-8e6a-9d3f2a1b0c4e";
    const resumed: number[] = [];
    const run = (status: string) => ({
      id,
      kind: "eval",
      status,
      params: {},
      progress: { total: 3, done: 1, failed: 0, unavailable: 0 },
      summary: null,
      usd: 0.002,
      error: null,
      createdAt: NOW,
      startedAt: NOW,
      finishedAt: status === "running" ? null : NOW,
      heartbeatAt: NOW,
      live: status === "running",
    });
    const unmocked = await fakeApi(page, baseURL, {
      "GET /admin/assistant/runs": { runs: [run("interrupted")] },
      [`GET /admin/assistant/runs/${id}`]: () => ({
        status: 200,
        body: { run: run(resumed.length ? "running" : "interrupted"), items: [] },
      }),
      [`POST /admin/assistant/runs/${id}/resume`]: (call: number) => {
        resumed.push(call);
        return { status: 202, body: { id } };
      },
    });
    await openAdmin(page, "/admin/assistant");
    await page.getByRole("tab", { name: "Evals" }).click();

    const resume = page.getByRole("button", { name: "Resume the run" });
    await resume.click();
    const dialog = page.getByRole("alertdialog");
    await expect(
      dialog.getByText("The 2 cases still to do go to the configured models"),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(resumed).toEqual([]);

    await resume.click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Resume" }).click();
    await expect.poll(() => resumed.length).toBe(1);
    await expect(page.getByRole("button", { name: "Cancel the run" })).toBeVisible();
    expect(unmocked).toEqual([]);
  });

  test("an answer is frozen as an eval case, and the cases list puts stale ones first", async ({
    page,
    baseURL,
  }) => {
    const frozen: unknown[] = [];
    const retired: unknown[] = [];
    const deleted: string[] = [];
    const evalCase = (id: string, question: string, stale: string | null) => ({
      id,
      question,
      locale: "en",
      snapshotKey: "en:12|de:13|a:x",
      mustCite: ["project:atlas@en"],
      mustInclude: [],
      status: "active",
      fromMessageId: null,
      createdAt: NOW,
      stale,
    });
    const unmocked = await fakeApi(page, baseURL, {
      "GET /admin/assistant/conversations": {
        messages: [
          answerRow("m_freeze0001", "Which project cut support escalations?", {
            citedIds: ["project:atlas@en"],
          }),
        ],
      },
      "POST /admin/assistant/eval-cases": () => ({ status: 201, body: { id: "c1" } }),
      "GET /admin/assistant/eval-cases": {
        cases: [
          evalCase("3c1d8a6e-0000-4000-8000-000000000001", "Where does he live?", null),
          evalCase("3c1d8a6e-0000-4000-8000-000000000002", "What did Vesper do?", "gone"),
        ],
      },
      "PATCH /admin/assistant/eval-cases/3c1d8a6e-0000-4000-8000-000000000002": () => ({
        status: 200,
        body: { ok: true },
      }),
      "DELETE /admin/assistant/eval-cases/3c1d8a6e-0000-4000-8000-000000000001": () => ({
        status: 200,
        body: { ok: true },
      }),
    });
    page.on("request", (r) => {
      const url = r.url();
      if (r.method() === "POST" && url.endsWith("/admin/assistant/eval-cases")) {
        frozen.push(r.postDataJSON());
      }
      if (r.method() === "PATCH" && url.includes("/admin/assistant/eval-cases/")) {
        retired.push(r.postDataJSON());
      }
      if (r.method() === "DELETE" && url.includes("/admin/assistant/eval-cases/")) {
        deleted.push(url.split("/").pop()!);
      }
    });
    await openAdmin(page, "/admin/assistant");

    await page.getByRole("tab", { name: "Conversations" }).click();
    await page.getByRole("button", { name: "Freeze as eval case" }).click();
    await expect(page.getByLabel("Must cite (ids, comma-separated)")).toHaveValue(
      "project:atlas@en",
    );
    // The admin rewrites the question to remove anything personal.
    const question = page.getByLabel("Question", { exact: true });
    await expect(question).toHaveValue("Which project cut support escalations?");
    await question.fill("Which project cut escalations?");
    await page.getByLabel("Must include (patterns, comma-separated)").fill("38");
    // Nothing is frozen without the admin's word that nothing personal is left.
    const freezeButton = page.getByRole("button", { name: "Freeze", exact: true });
    await expect(freezeButton).toBeDisabled();
    await page.getByLabel("Nothing personal is left in the question").check();
    await freezeButton.click();
    await expect(page.getByText("frozen as an eval case", { exact: true })).toBeVisible();
    expect(frozen).toEqual([
      {
        messageId: "m_freeze0001",
        question: "Which project cut escalations?",
        mustCite: ["project:atlas@en"],
        mustInclude: ["38"],
        personalChecked: true,
      },
    ]);

    await page.getByRole("tab", { name: "Evals" }).click();
    const cases = page.getByRole("region", { name: "Production eval cases" });
    // The stale one first: what it cites is gone from the live corpus.
    await expect(cases.getByRole("listitem").first()).toContainText("What did Vesper do?");
    await expect(cases.getByText("Stale: a document it cites is gone.")).toBeVisible();
    await cases.getByRole("button", { name: "Retire" }).first().click();
    await expect.poll(() => retired).toEqual([{ status: "retired" }]);

    // Deleting asks first, then removes the question for good.
    await cases.getByRole("button", { name: "Delete" }).last().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete case" }).click();
    await expect.poll(() => deleted).toEqual(["3c1d8a6e-0000-4000-8000-000000000001"]);
    expect(unmocked).toEqual([]);
  });

  test("the Reviews tab labels an answer from the keyboard, then opens the next", async ({
    page,
    baseURL,
  }) => {
    const unset = Object.fromEntries(VERDICT_LABELS.map((l) => [l, null]));
    const verdicts = { ...unset, correct: true, grounded: false };
    const week = (saved: boolean) => ({
      week: "2026-W40",
      previous: "2026-W39",
      next: null,
      queue: [
        {
          message: answerRow("m_review0001", "Where is Alireza based?", { feedback: -1 }),
          reasons: ["thumbs down", "check:uncited"],
          sampled: false,
          review: saved ? { labels: verdicts, note: null, reviewedAt: NOW } : null,
        },
        {
          message: answerRow("m_review0002", "Which stack does he use?"),
          reasons: [],
          sampled: true,
          review: null,
        },
      ],
      stats: { answers: 12, queued: 2, reviewed: saved ? 1 : 0, labels: noVerdicts() },
    });
    const unmocked = await fakeApi(page, baseURL, {
      "GET /admin/assistant/reviews": (call: number) => ({ status: 200, body: week(call > 1) }),
      "PUT /admin/assistant/reviews/m_review0001": { ok: true, reviewedAt: NOW },
    });
    await openAdmin(page, "/admin/assistant");
    await page.getByRole("tab", { name: "Reviews" }).click();

    await expect(page.getByText("0 of 2 reviewed · 12 answers this week")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Where is Alireza based?" })).toBeVisible();
    const queue = page.getByRole("list", { name: "Answers to review" });
    await expect(queue.getByText("thumbs down")).toBeVisible();
    await expect(queue.getByText("sample")).toBeVisible();

    // An answer can be frozen from here too; the form starts over on the next one.
    await page.getByRole("button", { name: "Freeze as eval case" }).click();
    await expect(page.getByLabel("Question", { exact: true })).toHaveValue(
      "Where is Alireza based?",
    );

    // 1 marks "Correct" good; 2 twice marks "Grounded" not good; S saves.
    await page.keyboard.press("1");
    await page.keyboard.press("2");
    await page.keyboard.press("2");
    const correct = page.getByRole("group", { name: "Correct" });
    await expect(correct.getByRole("button", { name: "Good", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const saving = page.waitForRequest((r) => r.method() === "PUT");
    await page.keyboard.press("s");
    expect((await saving).postDataJSON()).toEqual({ labels: verdicts, note: null });

    await expect(page.getByRole("heading", { name: "Which stack does he use?" })).toBeVisible();
    await expect(page.getByText("1 of 2 reviewed · 12 answers this week")).toBeVisible();
    await expect(queue.getByLabel("reviewed")).toHaveCount(1);
    await expect(page.getByLabel("Question", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Freeze as eval case" })).toBeVisible();
    expect(unmocked).toEqual([]);
  });

  test("the media library shows where a file is used, and suggests its alt text", async ({
    page,
    baseURL,
  }) => {
    const cleaned: string[][] = [];
    await fakeApi(page, baseURL, {
      "POST /admin/ai/copilot": {
        text: "Architekturdiagramm der Suchpipeline",
        model: "gemini-flash",
      },
      "POST /admin/media/cleanup": () => {
        cleaned.push(["a2"]);
        return {
          status: 200,
          body: { ok: true, deleted: ["a2"], skipped: [], freedBytes: 120_000 },
        };
      },
    });
    await openAdmin(page, "/admin/media");

    await page.getByRole("button", { name: "Details of architecture.png" }).click();
    const details = page.locator("hlm-sheet-content");
    await expect(details.getByRole("heading", { name: "architecture.png" })).toBeVisible();
    await expect(details.getByRole("link", { name: "Project project-one" })).toHaveAttribute(
      "href",
      "/admin/projects/project-one",
    );
    // Live files cannot be deleted; the reason is given.
    await expect(details.getByRole("button", { name: "Delete" })).toBeDisabled();
    await details.getByRole("button", { name: "Suggest alt text in German with AI" }).click();
    await expect(details.getByLabel("de", { exact: true })).toHaveValue(
      "Architekturdiagramm der Suchpipeline",
    );
    await page.keyboard.press("Escape");

    // What nothing uses can go, several at once.
    await page.getByRole("button", { name: "Select unused (1)" }).click();
    await page.getByRole("button", { name: "Delete 1" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => cleaned).toEqual([["a2"]]);
  });

  test("the sign-in stays still under reduced motion", async ({ page, baseURL }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fakeApi(page, baseURL, {
      "POST /auth/login": () => ({ status: 401, body: { error: "invalid_credentials" } }),
    });
    await page.goto("/admin/login");
    await interactive(page);

    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();

    const animations = await page
      .locator("app-terminal-window")
      .evaluate((el) => el.parentElement!.getAnimations().length);
    expect(animations).toBe(0);
  });
});

test.describe("admin accessibility", () => {
  test.use({ reducedMotion: "reduce" });

  for (const colorScheme of ["dark", "light"] as const) {
    for (const path of [
      "/admin",
      "/admin/about",
      "/admin/projects/project-one",
      "/admin/inbox",
      "/admin/media",
    ]) {
      test(`${path} in the ${colorScheme} theme has no accessibility violations`, async ({
        page,
        baseURL,
      }) => {
        await page.emulateMedia({ colorScheme });
        await fakeApi(page, baseURL);
        await openAdmin(page, path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
        // Loaded: the dashboard's tiles, or the editor's fields.
        await expect(page.locator("[role=status] .sr-only")).toHaveCount(0);

        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
          .analyze();
        expect(
          violations.map((v) => ({
            rule: v.id,
            help: v.help,
            targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
          })),
        ).toEqual([]);
      });
    }

    test(`an editor with its live preview open, in the ${colorScheme} theme, has no accessibility violations`, async ({
      page,
      baseURL,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(() => localStorage.setItem("admin.preview.open", "1"));
      await page.setViewportSize({ width: 1440, height: 900 });
      await fakeApi(page, baseURL);
      // Not `openAdmin`: the preview loads the home page's chunks too, which can keep
      // the network from going quiet under parallel load. Its own content is the mark.
      await page.goto("/admin/hero");
      await page.locator("html[data-hydrated]").waitFor({ state: "attached" });
      const preview = page.frameLocator("iframe[title^='Live preview']");
      await expect(preview.locator("#hero-heading")).toBeVisible({ timeout: 15_000 });
      await expect(preview.locator("#contact")).toBeAttached({ timeout: 15_000 });
      await expect(page.locator("[role=status] .sr-only")).toHaveCount(0);

      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
        .analyze();
      expect(
        violations.map((v) => ({
          rule: v.id,
          help: v.help,
          targets: v.nodes.slice(0, 5).map((n) => n.target.join(" ")),
        })),
      ).toEqual([]);
    });
  }
});
