// The plan's nine tasks ("Who uses it"), walked by script on the fixture build at 1280×800, dark, each from Today:
// per task the actions a person takes and the pixels the page scrolls on the way.
// - An action is one click, one key press or chord, or one text typed into a field. A search typed and the Enter
//   on its first match are two (the plan's "4 actions" for task 1 counts them as one).
// - Scroll is every pixel any scroll container moves meanwhile: a click's or a focus's own scrolling included,
//   and, where a task is reading (8), the scroll to the end of what is read. Scrolling is no action. Task 7 (since
//   Part M2) checks its target instead: no scroll at 1280×800, Now's four parts inside the window.
// - The time is the script's, not a person's: the user times the tasks once by hand.
// Every /admin and /auth call is answered in the browser (lib.mjs): never the real API or a paid model.
// Usage: node tasks.mjs [task number]. Writes tasks.json beside the other tools' output.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { answersFor, realReview } from "./data.mjs";
import * as fx from "./fixtures.generated.mjs";
import { chromium, inTurn, loaded, open, SPECS, startServer } from "./lib.mjs";

const only = process.argv[2] ? Number(process.argv[2]) : null;
const NOW = new Date().toISOString();
const OK = { ok: true, updatedAt: NOW };

/** Sums every scroll container's movement, the window's included, from the first paint on. */
function scrollMeter() {
  const last = new WeakMap();
  const at = (t) => (t === document ? [scrollX, scrollY] : [t.scrollLeft, t.scrollTop]);
  globalThis.__scrolled = 0;
  document.addEventListener(
    "scroll",
    (event) => {
      const [x, y] = at(event.target);
      const [px, py] = last.get(event.target) ?? [0, 0];
      globalThis.__scrolled += Math.abs(x - px) + Math.abs(y - py);
      last.set(event.target, [x, y]);
    },
    { capture: true, passive: true },
  );
}

/** Keeps every mail link followed instead of opening a mail app. */
function catchMail() {
  globalThis.__mailto = [];
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target?.closest?.("a[href^='mailto:']");
      if (!link) {
        return;
      }
      event.preventDefault();
      globalThis.__mailto.push(link.getAttribute("href"));
    },
    true,
  );
}

function actor(page) {
  let count = 0;
  const steps = [];
  const note = (what) => {
    steps.push(what);
    count += 1;
  };
  return {
    get count() {
      return count;
    },
    steps,
    click: async (locator, what) => {
      note(`click ${what}`);
      await locator.click();
    },
    press: async (key) => {
      note(key);
      await page.keyboard.press(key);
    },
    type: async (text) => {
      note(`type "${text}"`);
      await page.keyboard.type(text, { delay: 5 });
    },
  };
}

const rail = (page, name) =>
  page.locator("[data-slot=sidebar]").getByRole("link", { name: new RegExp(`^${name}`) }).first();
const headerState = (page) => page.locator("app-editor-header [role=status]").first();
/** Reads a locator's id every 100 ms until two reads agree, `reads` times at most. */
async function steadyId(page, locator, id, reads) {
  if (reads === 0) {
    return id;
  }
  await page.waitForTimeout(100);
  const again = await locator.getAttribute("id");
  return again === id ? id : steadyId(page, locator, again, reads - 1);
}

/** Task 6's week (plan 5, U20): five answers still to review, each PUT marking its answer reviewed. */
const TO_REVIEW = [
  "Where is Alireza based?",
  "Which stack does he use?",
  "How does he test prompts?",
  "Is he open to relocating?",
  "What did he build with RAG?",
];
function fiveToReview() {
  const ids = TO_REVIEW.map((_, i) => `m_task6_000${i + 1}`);
  const reviewed = new Map();
  const week = () => ({
    week: "2026-W45",
    previous: "2026-W44",
    next: null,
    queue: ids.map((id, i) => ({
      message: fx.answerRow(id, TO_REVIEW[i]),
      reasons: i === 0 ? ["thumbs down"] : [],
      sampled: i > 0,
      review: reviewed.get(id) ?? null,
    })),
    stats: { answers: 42, queued: ids.length, reviewed: reviewed.size, labels: fx.noVerdicts() },
  });
  const saves = ids.map((id) => [
    `PUT /admin/assistant/reviews/${id}`,
    (_n, request) => {
      reviewed.set(id, { ...request.postDataJSON(), reviewedAt: NOW });
      return { status: 200, body: { ok: true, reviewedAt: NOW } };
    },
  ]);
  return { "GET /admin/assistant/reviews": () => ({ status: 200, body: week() }), ...Object.fromEntries(saves) };
}

/** Each task: its words, the plan's "today" and target, extra answers, and the walk from Today. */
const TASKS = [
  {
    n: 1,
    name: "Change one label in German (the form's Send button)",
    target: "Ctrl K, type, Enter, edit, Ctrl S: 4 actions, under 15 s",
    answers: { "PATCH /admin/sections/ui": () => ({ status: 200, body: OK }) },
    walk: async (page, act) => {
      await act.press("Control+k");
      await page.getByRole("dialog").getByRole("combobox").waitFor();
      await act.type("send");
      await page.getByRole("option", { selected: true }).waitFor();
      await act.press("Enter");
      await page.waitForURL(/\/admin\/words/);
      await page.locator("#contact-submit-de:focus").waitFor();
      await act.type("Absenden");
      await act.press("Control+s");
      await headerState(page).filter({ hasText: /^Saved/ }).waitFor();
      return "Words saved the German Send";
    },
  },
  {
    n: 2,
    name: "Write a case study, EN and DE",
    target: "Languages side by side, Save always in view, a recovery copy",
    answers: { "PUT /admin/projects/p0": () => ({ status: 200, body: OK }) },
    walk: async (page, act) => {
      await act.click(rail(page, "Work"), "Work in the rail");
      await page.waitForURL(/\/admin\/projects$/);
      await act.click(page.locator("main a[href$='/admin/projects/project-one']").first(), "the project's name");
      await page.waitForURL(/\/admin\/projects\/project-one$/);
      await loaded(page);
      await inTurn(
        [
          ["Case study English", " A paragraph on the evals that gate each change."],
          ["Case study German", " Ein Absatz über die Evals vor jeder Änderung."],
        ],
        async ([name, text]) => {
          await act.click(page.getByRole("textbox", { name }), name);
          await act.press("Control+End");
          await act.type(text);
        },
      );
      await act.press("Control+s");
      await headerState(page).filter({ hasText: /^Saved/ }).waitFor();
      return "the project saved both case studies";
    },
  },
  {
    n: 3,
    name: "Add a project",
    target: "Add opens the new project's editor",
    answers: { "POST /admin/projects": () => ({ status: 200, body: { ok: true, id: "p-new" } }) },
    walk: async (page, act) => {
      await act.click(rail(page, "Work"), "Work in the rail");
      await page.waitForURL(/\/admin\/projects$/);
      await act.click(page.getByRole("button", { name: "Add project" }), "Add project");
      await page.waitForURL(/\/admin\/projects\/project-[a-z0-9]+$/);
      return "the new project's editor is open";
    },
  },
  {
    n: 4,
    name: "Review and publish",
    target: "Changes named in words, grouped by page, each with Open; Publish; a roll-back offer",
    // A realistic review (plan 5, U16): the spec's defaults hold two keys no page names.
    answers: {
      "GET /admin/publish/review": realReview(),
      "POST /admin/publish": () => ({
        status: 200,
        body: { ok: true, unchanged: false, publicationId: 13, published: [{ locale: "en", versionId: 25 }, { locale: "de", versionId: 26 }] },
      }),
    },
    walk: async (page, act) => {
      await act.click(page.getByRole("banner").getByRole("button", { name: /^Publish/ }), "Publish in the top bar");
      const review = page.getByRole("dialog", { name: "Review and publish" });
      const confirm = review.getByRole("button", { name: "Publish", exact: true });
      await confirm.waitFor();
      const pages = await review.getByRole("heading", { level: 3 }).allInnerTexts();
      const changes = await review.getByRole("listitem").allInnerTexts();
      const opens = await review.getByRole("link", { name: /^Open / }).count();
      await act.click(confirm, "Publish");
      const back = review.getByRole("button", { name: /^Roll back to #/ });
      await back.waitFor();
      const said = changes.map((c) => c.split("\n")[0]).join("; ");
      const offer = await back.innerText();
      return `${changes.length} changes in words on ${pages.length} pages (${pages.join(", ")}), ${opens} with Open [${said}]; published; "${offer.trim()}" offered`;
    },
  },
  {
    n: 5,
    name: "Answer a message",
    target: "J/K, R replies in the message's language; works at 390 px",
    answers: { "PATCH /admin/messages/m1": () => ({ status: 200, body: { ok: true } }) },
    walk: async (page, act) => {
      await act.click(rail(page, "Inbox"), "Inbox in the rail");
      await page.waitForURL(/\/admin\/inbox/);
      await loaded(page);
      await act.press("j");
      await page.waitForURL(/[?&]m=/);
      await act.press("r");
      await page.waitForFunction(() => globalThis.__mailto.length > 0);
      return `mail: ${await page.evaluate(() => decodeURIComponent(globalThis.__mailto[0].split("subject=")[1] ?? ""))}`;
    },
  },
  {
    n: 6,
    name: "Weekly review of answers (five answers)",
    target: "One click from Today; 1 2 3 pick each verdict, row after row; Ctrl Enter saves and opens the next; five answers in under 3 minutes",
    answers: fiveToReview(),
    walk: async (page, act) => {
      const row = page.getByRole("link", { name: /still to review/ }).first();
      if (await row.count()) {
        await act.click(row, "Today's review row");
      } else {
        await act.click(rail(page, "Assistant"), "Assistant in the rail");
        await act.click(page.getByRole("navigation", { name: "Assistant views" }).getByRole("link", { name: "Reviews", exact: true }), "the Reviews view");
      }
      await page.getByRole("listbox", { name: "Answers to review" }).waitFor();
      // Plan 5, U20: five verdicts per answer from the keys, then Ctrl Enter saves and opens the next.
      await inTurn(TO_REVIEW, async (question) => {
        await page.getByRole("heading", { name: question, exact: true }).waitFor();
        await inTurn(["1", "1", "1", "2", "3"], (key) => act.press(key));
        const saving = page.waitForRequest((r) => r.method() === "PUT" && r.url().includes("/admin/assistant/reviews/"));
        await act.press("Control+Enter");
        await saving;
      });
      await page.getByRole("heading", { name: /^Every answer of week \d+ is reviewed\.$/ }).waitFor();
      return `${TO_REVIEW.length} answers reviewed, then the done state`;
    },
  },
  {
    n: 7,
    name: "Check the assistant",
    target: "Now fits 1280×800: state, spend against the budget, what fails, what waits",
    answers: {},
    walk: async (page, act) => {
      await act.click(rail(page, "Assistant"), "Assistant in the rail");
      await page.waitForURL(/\/admin\/assistant/);
      await loaded(page);
      // Part M2's target: nothing scrolls at 1280×800, and Now's four parts end inside the window.
      const fit = await page.evaluate(() => ({ tall: document.documentElement.scrollHeight, high: innerHeight }));
      const ends = await Promise.all(
        ["State", "Waits for you", "Spent today", "Models"].map(async (name) => {
          const region = page.getByRole("region", { name, exact: true });
          const box = (await region.count()) ? await region.boundingBox() : null;
          if (!box) {
            return `${name} missing`;
          }
          return box.y + box.height > fit.high ? `${name} ends at ${Math.round(box.y + box.height)} px` : "";
        }),
      );
      const short = ends.filter(Boolean);
      const verdict = fit.tall <= fit.high && !short.length ? "fits" : "does not fit";
      const which = short.length ? `; ${short.join(", ")}` : "";
      return `${verdict}: the page ${fit.tall} px tall in ${fit.high} px${which}`;
    },
  },
  {
    n: 8,
    name: "Decide what waits",
    target: "Today lists every queue with its count and a link",
    answers: {},
    walk: async (page) => {
      const list = page.getByRole("heading", { name: "Needs you" });
      await list.waitFor();
      // Reading the list: its last row in view.
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll("main li")];
        rows.at(-1)?.scrollIntoView({ block: "end" });
      });
      await page.waitForTimeout(300);
      return `${await page.locator("main li").count()} rows on Today`;
    },
  },
  {
    n: 9,
    name: "Close a German gap",
    target: "Words filters Missing in German across the site; editors mark empty fields; Today counts them",
    answers: { "PATCH /admin/sections/ui": () => ({ status: 200, body: OK }) },
    walk: async (page, act) => {
      await act.click(rail(page, "Words"), "Words in the rail");
      await page.waitForURL(/\/admin\/words/);
      await loaded(page);
      await act.click(page.getByRole("button", { name: "Missing in German", exact: true }), "Missing in German");
      // The filter settles through the address (`?missing`), then the rows' `hidden` (Part N1: the walk took a field
      // the filter hid next, two reads of one locator giving two rows): the first German field must hold still.
      await page.waitForURL(/[?&]missing(?:[=&]|$)/);
      const first = page.locator("main input[id$='-de']:visible, main textarea[id$='-de']:visible").first();
      await first.waitFor();
      const id = await steadyId(page, first, await first.getAttribute("id"), 20);
      await act.click(page.locator(`[id="${id}"]`), `#${id}`);
      await act.type("Übersetzt");
      await act.press("Control+s");
      await headerState(page).filter({ hasText: /^Saved/ }).waitFor();
      return `saved #${id}`;
    },
  },
];

const { server, origin } = await startServer(4204);
const browser = await chromium.launch({ channel: "chrome" });
const results = [];
/** One task, walked from the dashboard: its actions, scrolling, time and outcome. */
async function runTask(task) {
  const answers = { ...answersFor("/admin"), ...task.answers };
  const s = await open(browser, origin, answers, {
    path: "/admin",
    size: { width: 1280, height: 800 },
    // As source: an init function runs in the page, where this module's functions are not.
    init: `(${scrollMeter})(); (${catchMail})();`,
  });
  const { page } = s;
  await page.locator("[data-slot=sidebar-inset]").waitFor({ timeout: 20_000 });
  await loaded(page);
  await page.evaluate(() => (globalThis.__scrolled = 0));
  const act = actor(page);
  const started = Date.now();
  let outcome;
  try {
    outcome = await task.walk(page, act);
  } catch (error) {
    outcome = `FAILED: ${String(error).split("\n")[0].slice(0, 160)}`;
  }
  const ms = Date.now() - started;
  const scrolled = Math.round(await page.evaluate(() => globalThis.__scrolled));
  const row = {
    n: task.n,
    task: task.name,
    actions: act.count,
    scroll: scrolled,
    scriptMs: ms,
    outcome,
    steps: act.steps,
    target: task.target,
    unmocked: [...s.record.unmocked],
    problems: s.problems,
  };
  results.push(row);
  console.log(
    `${task.n}. ${task.name}: ${act.count} actions, ${scrolled} px scrolled, ${ms} ms (script) — ${outcome}`,
  );
  console.log(`   ${act.steps.join(" › ") || "(no action)"}`);
  if (row.unmocked.length) {
    console.log(`   unmocked: ${row.unmocked.join(", ")}`);
  }
  if (row.problems.length) {
    console.log(`   console: ${row.problems.join(" | ").slice(0, 300)}`);
  }
  await s.context.close();
}

try {
  await inTurn(TASKS.filter((t) => only === null || t.n === only), (task) => runTask(task));
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(join(SPECS, "tasks.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => !r.outcome.startsWith("FAILED")).length} of ${results.length} tasks walked`);
