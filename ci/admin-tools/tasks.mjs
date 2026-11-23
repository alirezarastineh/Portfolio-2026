// The plan's nine tasks ("Who uses it"), walked by script on the fixture build at 1280×800, dark, each from Today:
// per task the actions a person takes and the pixels the page scrolls on the way.
// - An action is one click, one key press or chord, or one text typed into a field. A search typed and the Enter
//   on its first match are two (the plan's "4 actions" for task 1 counts them as one).
// - Scroll is every pixel any scroll container moves meanwhile: a click's or a focus's own scrolling included,
//   and, where a task is reading (8), the scroll to the end of what is read. Scrolling is no action. Task 7 (since
//   Part M2) checks its target instead: no scroll at 1280×800, Now's four parts inside the window.
// - The time is the script's, not a person's: the user times the tasks once by hand.
// Then the phone's triage tasks (plan 5, U23: 1, 4, 5, 6, 7 and 8) at 390×844 with touch: taps and typing
// only, the rail a sheet behind the top bar's menu, a field tapped before typing (a phone opens its keyboard
// on a tap, not on a focus the page moves), Now read to the end of what waits.
// Every /admin and /auth call is answered in the browser (lib.mjs): never the real API or a paid model.
// Usage: node tasks.mjs [task number]. Writes tasks.json beside the other tools' output.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { answersFor, realReview } from "./data.mjs";
import * as fx from "./fixtures.generated.mjs";
import { chromium, inTurn, loaded, open, SIZES, SPECS, startServer } from "./lib.mjs";

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
    tap: async (locator, what) => {
      note(`tap ${what}`);
      await locator.tap();
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
/** On a phone the rail is a sheet: the top bar's menu, then the page. */
async function railTap(page, act, name) {
  await act.tap(page.getByRole("banner").getByRole("button", { name: "Navigation" }), "the menu");
  await act.tap(rail(page, name), `${name} in the menu`);
}
/** A decision queue's item (plan 5, U21) by its heading's id, and its A or X button. */
const decide = (page, headingId, key) =>
  page
    .locator("[data-decide]")
    .filter({ has: page.locator(`[id="${headingId}"]`) })
    .locator(`[data-key="${key}"]`);
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

/** Task 6's verdicts on a phone, row after row: the key walk's 1 1 1 2 3 (plan 5, U23). */
const VERDICTS = [
  ["Correct", "Good"],
  ["Grounded in the cited documents", "Good"],
  ["Helpful", "Good"],
  ["Tone", "Not good"],
  ["Language", "Does not apply"],
];
/** Now's four parts (plan 5, U18). */
const NOW_PARTS = ["State", "Waits for you", "Spent today", "Models"];

/** Task 8's queues (plan 5, U21): each one's row on Today, by its words. */
const QUEUES = [
  ["the content agent's drafts", /drafts? from the content agent/],
  ["FAQ proposals", /FAQ proposals?/],
  ["journal entries", /journal entr(?:y|ies) proposed/],
  ["lessons", /lessons? proposed/],
];
/** An FAQ proposal no new lesson can measure, so A accepts it as drafted. */
const FAQ = fx.faqProposalRow({ newLesson: "its insight run is gone" });
/** Task 8's writes: one decision in each queue, answered as the server does. */
function queueWrites() {
  const [pr1] = answersFor("/admin")["GET /admin/assistant/proposals"].proposals;
  return {
    "GET /admin/assistant/faq-proposals": { proposals: [FAQ] },
    "POST /admin/assistant/proposals/pr1/apply": { proposal: { ...pr1, status: "applied" } },
    [`POST /admin/assistant/faq-proposals/${FAQ.id}/accept`]: {
      proposal: { ...FAQ, status: "accepted" },
      linked: { journal: false, lesson: null },
    },
    [`PATCH /admin/assistant/lessons/${fx.LESSON_ID}`]: { lesson: fx.lessonRow({ status: "retired" }) },
    [`PATCH /admin/assistant/journal/${fx.JOURNAL_ID}`]: { entry: fx.journalEntry({ status: "retired" }) },
  };
}
/** Waits until the element with this id holds the focus. */
const focused = (page, id) => page.waitForFunction((want) => document.activeElement?.id === want, id);

/** Each task: its words, the plan's "today" and target, extra answers, and the walk from Today. */
const TASKS = [
  {
    n: 1,
    name: "Change one label in German (the form's Send button)",
    target: "Ctrl K, type, Enter, edit, Ctrl S: 4 actions, under 15 s",
    answers: { "PATCH /admin/sections/ui": () => ({ status: 200, body: OK }) },
    walk: async (page, act) => {
      await act.press("Control+k");
      // Typed once the combobox has the focus: under load the first letter lands in the page behind it.
      await page.getByRole("dialog").getByRole("combobox").and(page.locator(":focus")).waitFor();
      await act.type("send");
      // Enter once Words' row leads, as the e2e's task 1 waits: Find's content groups arrive after its pages.
      await page.getByRole("option", { name: "Contact › Send message", exact: true, selected: true }).waitFor();
      await act.press("Enter");
      await page.waitForURL(/\/admin\/words/);
      await page.locator("#contact-submit-de:focus").waitFor();
      await act.type("Absenden");
      await act.press("Control+s");
      await headerState(page).filter({ hasText: /^Saved/ }).waitFor();
      return "Words saved the German Send";
    },
    phone: async (page, act) => {
      await act.tap(page.getByRole("banner").getByRole("button", { name: "Find" }), "Find");
      await act.tap(page.getByRole("dialog").getByRole("combobox"), "the search field");
      await act.type("send");
      await act.tap(page.getByRole("option", { name: "Contact › Send message", exact: true }), "the row Contact › Send message");
      await page.waitForURL(/\/admin\/words/);
      // A phone shows one language, English first, and Find lands in the column shown: German, then its field.
      await act.tap(page.locator("app-locale-toggle").getByRole("button", { name: "DE", exact: true }), "DE");
      await act.tap(page.locator("#contact-submit-de"), "the German field");
      await act.type("Absenden");
      await act.tap(page.locator("app-editor-header").getByRole("button", { name: /^Save/ }), "Save");
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
    phone: async (page, act) => {
      await act.tap(page.getByRole("banner").getByRole("button", { name: /^Publish/ }), "Publish in the top bar");
      const review = page.getByRole("dialog", { name: "Review and publish" });
      const confirm = review.getByRole("button", { name: "Publish", exact: true });
      await confirm.waitFor();
      // The plan puts a screen's primary action in its lower two thirds: is Publish in the window?
      const at = await confirm.evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
      await act.tap(confirm, "Publish");
      await review.getByRole("button", { name: /^Roll back to #/ }).waitFor();
      return `published; Publish ended at ${at} px in ${page.viewportSize()?.height} px; the roll-back offered`;
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
    phone: async (page, act) => {
      await railTap(page, act, "Inbox");
      await page.waitForURL(/\/admin\/inbox/);
      await loaded(page);
      await act.tap(page.locator("[data-message]").first(), "the first message");
      await page.waitForURL(/[?&]m=/);
      await act.tap(page.getByRole("link", { name: "Reply" }), "Reply");
      await page.waitForFunction(() => globalThis.__mailto.length > 0);
      return `mail: ${await page.evaluate(() => decodeURIComponent(globalThis.__mailto[0].split("subject=")[1] ?? ""))}`;
    },
  },
  {
    n: 6,
    name: "Weekly review of answers (five answers)",
    target: "One click from Today; 1 2 3 pick each verdict, row after row; Ctrl Enter saves and opens the next; five answers in under 3 minutes",
    // A function: each pass gets its own week, since the week keeps the reviews it is sent.
    answers: fiveToReview,
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
    phone: async (page, act) => {
      // Below 1024 the queue's list folds away (one answer at a time): each answer's heading is the wait.
      await act.tap(page.getByRole("link", { name: /still to review/ }).first(), "Today's review row");
      await inTurn(TO_REVIEW, async (question) => {
        await page.getByRole("heading", { name: question, exact: true }).waitFor();
        // The key walk's 1 1 1 2 3, row after row, as taps.
        await inTurn(VERDICTS, ([row, verdict]) =>
          act.tap(page.getByRole("group", { name: row, exact: true }).getByRole("button", { name: verdict, exact: true }), `${verdict} (${row})`),
        );
        const saving = page.waitForRequest((r) => r.method() === "PUT" && r.url().includes("/admin/assistant/reviews/"));
        await act.tap(page.getByRole("button", { name: "Save and next" }), "Save and next");
        await saving;
      });
      await page.getByRole("heading", { name: /^Every answer of week \d+ is reviewed\.$/ }).waitFor();
      return `${TO_REVIEW.length} answers reviewed by taps, then the done state`;
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
        NOW_PARTS.map(async (name) => {
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
    // At 390 Now runs one column: where each part ends, then read to the end of what waits.
    phone: async (page, act) => {
      await railTap(page, act, "Assistant");
      await page.waitForURL(/\/admin\/assistant/);
      await loaded(page);
      const ends = await Promise.all(
        NOW_PARTS.map(async (name) => {
          const box = await page.getByRole("region", { name, exact: true }).boundingBox();
          return box ? `${name} ${Math.round(box.y + box.height)}` : `${name} missing`;
        }),
      );
      const tall = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.getByRole("region", { name: "Waits for you", exact: true }).evaluate((el) => el.scrollIntoView({ block: "end" }));
      return `the page ${tall} px tall in ${page.viewportSize()?.height} px; ends at ${ends.join(", ")} px`;
    },
  },
  {
    n: 8,
    name: "Decide what waits",
    target: "Today lists every queue with its count and a link; each queue works from the keyboard",
    answers: queueWrites(),
    walk: async (page, act) => {
      const needs = page.getByRole("region", { name: "Needs you" });
      await needs.waitFor();
      const row = (name) => needs.getByRole("link", { name });
      const missing = [];
      await inTurn(QUEUES, async ([what, name]) => {
        if (!(await row(name).count())) {
          missing.push(what);
        }
      });
      if (missing.length) {
        throw new Error(`no row on Today for ${missing.join(", ")}`);
      }
      // Plan 5, U21: one click into each queue, then keys only; each decision moves the focus on.
      await act.click(row(QUEUES[0][1]), "Today's content agent row");
      await page.locator("#proposal-pr1").waitFor();
      await act.press("j");
      await focused(page, "proposal-pr1");
      const applied = page.waitForRequest((r) => r.url().endsWith("/proposals/pr1/apply"));
      await act.press("a");
      await applied;
      await focused(page, "proposal-pr2");

      await act.click(rail(page, "Today"), "Today in the rail");
      await act.click(row(QUEUES[1][1]), "Today's FAQ row");
      await page.locator(`[id="faq-proposal-${FAQ.id}"]`).waitFor();
      await act.press("j");
      await focused(page, `faq-proposal-${FAQ.id}`);
      const accepted = page.waitForRequest((r) => r.url().endsWith(`/faq-proposals/${FAQ.id}/accept`));
      await act.press("a");
      await accepted;
      await focused(page, "faq-proposals-done");

      // The Journal view holds two queues, lessons then entries: J walks both in page order.
      await act.click(rail(page, "Today"), "Today in the rail");
      await act.click(row(QUEUES[3][1]), "Today's lessons row");
      await page.locator(`[id="lesson-${fx.LESSON_ID}"]`).waitFor();
      await act.press("j");
      await focused(page, `lesson-${fx.LESSON_ID}`);
      const retired = page.waitForRequest((r) => r.url().endsWith(`/lessons/${fx.LESSON_ID}`));
      await act.press("x");
      await retired;
      await focused(page, "lessons-waiting");
      const entry = `journal-${fx.JOURNAL_ID}`;
      const toEntry = async (left) => {
        await act.press("j");
        const at = await page.evaluate(() => document.activeElement?.id);
        if (at !== entry && left > 1) {
          await toEntry(left - 1);
        }
      };
      await toEntry(5);
      await focused(page, entry);
      const closed = page.waitForRequest((r) => r.url().endsWith(`/journal/${fx.JOURNAL_ID}`));
      await act.press("x");
      await closed;
      await focused(page, "journal-waiting");
      return `${QUEUES.length} queues on Today with counts and links; 4 decided by keys, the focus on the next item or the done line`;
    },
    // The same four decisions by taps: a row on Today, then the item's own A or X button.
    phone: async (page, act) => {
      const needs = page.getByRole("region", { name: "Needs you" });
      await needs.waitFor();
      const row = (name) => needs.getByRole("link", { name });
      const decideBy = async (headingId, key, what, request) => {
        const sent = page.waitForRequest((r) => r.url().endsWith(request));
        await act.tap(decide(page, headingId, key), what);
        await sent;
      };
      await act.tap(row(QUEUES[0][1]), "Today's content agent row");
      await decideBy("proposal-pr1", "a", "Apply", "/proposals/pr1/apply");
      await railTap(page, act, "Today");
      await act.tap(row(QUEUES[1][1]), "Today's FAQ row");
      await decideBy(`faq-proposal-${FAQ.id}`, "a", "Accept", `/faq-proposals/${FAQ.id}/accept`);
      await railTap(page, act, "Today");
      await act.tap(row(QUEUES[3][1]), "Today's lessons row");
      await decideBy(`lesson-${fx.LESSON_ID}`, "x", "Retire the lesson", `/lessons/${fx.LESSON_ID}`);
      await decideBy(`journal-${fx.JOURNAL_ID}`, "x", "Retire the journal entry", `/journal/${fx.JOURNAL_ID}`);
      return `${QUEUES.length} queues on Today; 4 decided by taps`;
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
/** The laptop's keys for all nine, then the phone's taps for the triage tasks (plan 5, U23). */
const PASSES = [
  { name: "laptop", size: SIZES.laptop, walkOf: (task) => task.walk },
  { name: "phone", size: SIZES.phone, walkOf: (task) => task.phone },
];
/** One task, walked from the dashboard in one pass: its actions, scrolling, time and outcome. */
async function runTask(task, pass) {
  const own = typeof task.answers === "function" ? task.answers() : task.answers;
  const answers = { ...answersFor("/admin"), ...own };
  const s = await open(browser, origin, answers, {
    path: "/admin",
    size: pass.size,
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
    outcome = await pass.walkOf(task)(page, act);
  } catch (error) {
    outcome = `FAILED: ${String(error).split("\n")[0].slice(0, 160)}`;
  }
  const ms = Date.now() - started;
  const scrolled = Math.round(await page.evaluate(() => globalThis.__scrolled));
  const row = {
    n: task.n,
    pass: pass.name,
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
  const where = pass.name === "phone" ? " (phone, 390)" : "";
  console.log(
    `${task.n}. ${task.name}${where}: ${act.count} actions, ${scrolled} px scrolled, ${ms} ms (script) — ${outcome}`,
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

const chosen = TASKS.filter((t) => only === null || t.n === only);
const runs = PASSES.flatMap((pass) => chosen.filter((task) => pass.walkOf(task)).map((task) => [task, pass]));
try {
  await inTurn(runs, ([task, pass]) => runTask(task, pass));
} finally {
  await browser.close();
  server.kill();
}
writeFileSync(join(SPECS, "tasks.json"), JSON.stringify(results, null, 2));
const walked = (name) => results.filter((r) => r.pass === name);
const tally = (name) =>
  `${walked(name).filter((r) => !r.outcome.startsWith("FAILED")).length} of ${walked(name).length}`;
console.log(`\n${tally("laptop")} tasks walked at 1280; ${tally("phone")} at 390 by taps`);
