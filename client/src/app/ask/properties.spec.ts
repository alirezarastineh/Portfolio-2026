import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { AppContent } from "../content/schema";
import { answersByQuestion } from "./answers";
import type { AskMessage } from "./ask-types";
import { parseInput } from "./commands";
import { linkPolicyFor } from "./link-policy";
import { forRequest } from "./sent-messages";
import {
  citationOrder,
  footnotesFor,
  renderMarkdown,
  type Block,
  type Inline,
} from "./terminal-markdown";

/**
 * What must hold in the terminal whatever an answer says (visitor plan V4):
 * what it may link to, how its citations are numbered, what the shell takes
 * for a command, and what goes back to the server. Seeded, so CI replays the
 * same cases; the nightly run takes a random FC_SEED (ci/client.sh), and
 * FC_SEED=<seed> repeats it. A failure prints the smallest counterexample
 * fast-check could shrink it to.
 */

const seed = Number(process.env["FC_SEED"] ?? 20261021);
const runs = (numRuns: number) => ({ seed, numRuns });

/** Every inline node of a rendered answer, nested ones included. */
function* inlines(nodes: readonly (Block | Inline)[]): Generator<Inline> {
  for (const node of nodes) {
    switch (node.t) {
      case "p":
        yield* inlines(node.c);
        break;
      case "ul":
      case "ol":
        for (const item of node.items) yield* inlines(item);
        break;
      case "pre":
        break;
      case "strong":
      case "em":
      case "link":
        if (node.t === "link") yield node;
        yield* inlines(node.c);
        break;
      default:
        yield node;
    }
  }
}

/* ---------------------------------------------------------------- links */

const SITE = "https://alirezarastineh.me";
const KNOWN = [
  "https://github.com/alirezarastineh",
  "https://www.linkedin.com/in/alirezarastineh",
  "mailto:hello@alirezarastineh.me",
];
const content = {
  identity: { siteUrl: `${SITE}/`, contactEmail: "hello@alirezarastineh.me" },
  socials: KNOWN.slice(0, 2).map((href) => ({ href })),
} as unknown as Pick<AppContent, "socials" | "identity">;

/** What a browser makes of an href on the answer's page, ctrl-click and new tab included. */
function origin(href: string): string {
  return URL.canParse(href, `${SITE}/en`) ? new URL(href, `${SITE}/en`).origin : "unparseable";
}

// What a link's address may hold in the Markdown subset: no space, no unbalanced parenthesis.
const hrefChars = fc.constantFrom(..."ab09/.:-_%?#=&@~+\\".split(""));
// Where browsers bend an address: a browser reads "\" as "/" in a web address.
const separator = fc.constantFrom("/", "\\");
const href = fc.oneof(
  fc.string({ unit: hrefChars, minLength: 1, maxLength: 16 }),
  fc
    .tuple(separator, separator, fc.constantFrom("evil.example", "x", ""))
    .map(([a, b, host]) => a + b + host),
  fc.constantFrom(
    ...KNOWN,
    "/en/work/atlas",
    "/de",
    `${SITE}/en/writing`,
    "//evil.example",
    "https://evil.example/",
    "javascript:alert(1)",
    "data:text/html,x",
    `${SITE}.evil.example/`,
    "mailto:someone@evil.example",
  ),
  fc
    .tuple(
      fc.constantFrom("/", "/en", `${SITE}/`, "https:"),
      fc.string({ unit: hrefChars, maxLength: 12 }),
    )
    .map(([start, rest]) => start + rest),
);
const word = fc.constantFrom(
  "Atlas",
  "cut",
  "38%",
  "<b>",
  "</b>",
  "<script>alert(1)</script>",
  "**",
  "*",
  "`",
  "#",
  "-",
  "1.",
  "\n",
  "\n\n",
  "```",
);
const link = fc
  .tuple(fc.constantFrom("here", "his GitHub", "**Atlas**", "`code`"), href)
  .map(([text, to]) => `[${text}](${to})`);
const cite = fc.constantFrom("project:atlas@en", "profile@en", "cv@en").map((id) => `[^${id}]`);
const answer = fc
  .array(fc.oneof({ weight: 3, arbitrary: word }, { weight: 2, arbitrary: link }, cite), {
    maxLength: 30,
  })
  .map((parts) => parts.join(" "));

describe("an answer's links", () => {
  it("keep no address but the site's own pages, the socials and the email", () => {
    const policy = linkPolicyFor(content);
    fc.assert(
      fc.property(answer, (text) => {
        for (const node of inlines(renderMarkdown(text, { cite: () => 1, link: policy }))) {
          if (node.t !== "link") continue;
          // Opened by the router, or by a browser in a new tab: this site either way.
          if (node.internal) expect(origin(node.href), node.href).toBe(SITE);
          else expect(KNOWN, node.href).toContain(node.href);
        }
      }),
      runs(400),
    );
  });
});

/* ----------------------------------------------------------- the rest */

describe("an answer's text", () => {
  // HTML and words, without the subset's own syntax ([, *, `, a line's #, - or 1.).
  const htmlWord = fc.constantFrom(
    "Atlas",
    "<b>bold</b>",
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    '<a href="//evil.example">x</a>',
    "&lt;",
    "a<b",
    "x>y",
  );

  it("shows any HTML the model writes as text, character for character", () => {
    fc.assert(
      fc.property(fc.array(htmlWord, { minLength: 1, maxLength: 12 }), (words) => {
        const text = words.join(" ");
        const blocks = renderMarkdown(text, { cite: () => 1, link: () => "internal" });
        expect(blocks).toEqual([{ t: "p", c: [{ t: "text", v: text }] }]);
      }),
      runs(200),
    );
  });

  // Code with the subset's syntax in it, but no backtick and no line break.
  const code = fc.string({ unit: fc.constantFrom(..."ab [](*)/:\\<>^_#-1.".split("")) });

  it("keeps code as written: no link, emphasis or citation inside it", () => {
    const options = { cite: () => 1, link: () => "internal" as const };
    fc.assert(
      fc.property(code, (v) => {
        expect(renderMarkdown(`\`\`\`\n${v}\n\`\`\``, options)).toEqual([{ t: "pre", v }]);
        if (v) {
          expect(renderMarkdown(`\`${v}\``, options)).toEqual([{ t: "p", c: [{ t: "code", v }] }]);
        }
      }),
      runs(200),
    );
  });
});

describe("an answer's citations", () => {
  const IDS = ["project:atlas@en", "profile@en", "cv@en", "post:evals-first@en"];
  const cited = fc
    .array(
      fc.oneof(
        fc.constantFrom("Atlas", "cut", "**escalations**", "`x`", "\n"),
        fc.constantFrom(...IDS).map((id) => `[^${id}]`),
      ),
      { maxLength: 20 },
    )
    .map((parts) => parts.join(" "));

  it("number a source once, the same at every point of the stream, and [n] names chip n", () => {
    fc.assert(
      fc.property(cited, fc.subarray(IDS), fc.nat(), fc.nat(), (text, extra, at, lag) => {
        const order = citationOrder(text);
        // The server sends a source as it is first cited (citationTransform), the rest after.
        const all = [...order, ...extra.filter((id) => !order.includes(id))].map((id) => ({ id }));
        const final = footnotesFor(text, all);
        const prefix = text.slice(0, at % (text.length + 1));
        const shownOrder = citationOrder(prefix);
        expect(order.slice(0, shownOrder.length)).toEqual(shownOrder);
        // A source may still be on its way when its marker has arrived.
        const arrived = shownOrder.slice(0, shownOrder.length - (lag % (shownOrder.length + 1)));
        const chips = footnotesFor(
          prefix,
          arrived.map((id) => ({ id })),
        );
        const numbers = new Map(chips.map((f) => [f.id, f.n]));
        const blocks = renderMarkdown(prefix, {
          cite: (id) => numbers.get(id) ?? null,
          link: () => null,
        });
        for (const node of inlines(blocks)) {
          if (node.t !== "cite") continue;
          expect(chips[node.n - 1]?.id).toBe(node.id);
          expect(final.find((f) => f.id === node.id)?.n).toBe(node.n);
        }
      }),
      runs(400),
    );
  });
});

describe("the shell", () => {
  const prose = fc.constantFrom("me", "find", "his", "projects", "of", "German?", "the", "please");
  const space = fc.constantFrom(" ", "  ", "\t");

  it("runs a command only when the whole input is one", () => {
    // A command word followed by more words than it takes: a question, as typed.
    const tooMany = fc.oneof(
      fc.tuple(
        fc.constantFrom(
          "help",
          "whoami",
          "cv",
          "contact",
          "stats",
          "inspect",
          "evals",
          "history",
          "clear",
        ),
        fc.array(prose, { minLength: 1, maxLength: 5 }),
      ),
      fc.tuple(fc.constant("cat"), fc.array(prose, { minLength: 2, maxLength: 5 })),
      fc.tuple(fc.constantFrom("open", "cd"), fc.array(prose, { minLength: 4, maxLength: 6 })),
      fc.tuple(
        fc.constantFrom("lang", "level", "news"),
        fc.array(prose, { minLength: 2, maxLength: 5 }),
      ),
    );
    fc.assert(
      fc.property(tooMany, ([command, words]) => {
        const text = [command, ...words].join(" ");
        expect(parseInput(text)).toEqual({ kind: "ask", text, deep: false });
      }),
      runs(200),
    );
    for (const question of ["help me find his projects", "level of his German?"]) {
      expect(parseInput(question)).toEqual({ kind: "ask", text: question, deep: false });
    }
  });

  it("reads a command the same in any case and spacing", () => {
    const command = fc.constantFrom(
      "help",
      "whoami",
      "ls projects",
      "ls skills",
      "cv",
      "contact",
      "stats",
      "inspect",
      "evals",
      "forget",
      "history",
      "clear",
      "reset",
      "cat atlas",
      "open writing",
      "lang de",
      "level expert",
      "news",
      "news off",
    );
    fc.assert(
      fc.property(
        command,
        fc.array(space, { minLength: 3, maxLength: 3 }),
        fc.boolean(),
        (cmd, gaps, upper) => {
          const [head, ...rest] = cmd.split(" ");
          const typed = `${gaps[0]}${upper ? head!.toUpperCase() : head}${rest.map((r) => gaps[1] + r).join("")}${gaps[2]}`;
          expect(parseInput(typed)).toEqual(parseInput(cmd));
          expect(parseInput(typed).kind).toBe("local");
        },
      ),
      runs(200),
    );
  });

  it("asks a question that starts with no command word as it was typed", () => {
    // Not "level", which is one now (visitor plan V10): the property above has it.
    const first = fc.constantFrom("What", "Which", "Levels", "Is", "Wie", "Where");
    fc.assert(
      fc.property(first, fc.array(fc.tuple(space, prose), { maxLength: 6 }), (start, more) => {
        const text = start + more.map(([gap, w]) => gap + w).join("");
        expect(parseInput(`  ${text} `)).toEqual({ kind: "ask", text, deep: false });
      }),
      runs(200),
    );
  });
});

describe("what goes back to the server", () => {
  const part = fc.oneof(
    fc.string({ maxLength: 8 }).map((text) => ({ type: "text", text })),
    fc.constant({ type: "step-start" }),
    fc.constant({ type: "source-url", sourceId: "profile@en", url: "/en" }),
    fc.constant({
      type: "tool-navigate",
      toolCallId: "c1",
      state: "output-available",
      input: { to: "/en" },
      output: { ok: true },
    }),
  );
  const conversation = fc
    .array(
      fc.record({
        role: fc.constantFrom("user", "assistant"),
        parts: fc.array(part, { maxLength: 3 }),
        sig: fc.option(fc.string({ minLength: 1, maxLength: 6 }), { nil: undefined }),
      }),
      { maxLength: 60 },
    )
    .map((list) =>
      list.map(
        ({ role, parts, sig }, i) =>
          ({ id: `m${i}`, role, parts, ...(sig ? { metadata: { sig } } : {}) }) as AskMessage,
      ),
    );

  it("is text alone, an answer's own signature, the newest 16 whole and only questions before", () => {
    fc.assert(
      fc.property(conversation, (messages) => {
        const sent = forRequest(messages);
        const byId = new Map(messages.map((m) => [m.id, m]));
        for (const m of sent) {
          const original = byId.get(m.id)!;
          expect(m.parts.every((p) => p.type === "text")).toBe(true);
          expect(m.parts.map((p) => p.text)).toEqual(
            original.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])),
          );
          const sig = "metadata" in m ? m.metadata?.sig : undefined;
          expect(sig).toBe(original.role === "assistant" ? original.metadata?.sig : undefined);
        }
        const ids = sent.map((m) => m.id);
        expect(ids.slice(-16)).toEqual(messages.slice(-16).map((m) => m.id));
        expect(sent.slice(0, -16).every((m) => m.role === "user")).toBe(true);
        expect(sent.length).toBeLessThanOrEqual(16 + 12);
        // In the order they were asked and answered.
        const at = ids.map((id) => messages.findIndex((m) => m.id === id));
        expect(at).toEqual([...at].sort((a, b) => a - b));
      }),
      runs(300),
    );
  });

  it("pairs each answer with the question right before it, whatever the order of roles", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("user", "assistant"), { maxLength: 30 }), (roles) => {
        const messages = roles.map(
          (role, i) =>
            ({ id: `m${i}`, role, parts: [{ type: "text", text: `${i}` }] }) as AskMessage,
        );
        const map = answersByQuestion(messages);
        let pairs = 0;
        messages.forEach((m, i) => {
          const next = messages[i + 1];
          if (m.role !== "user" || next?.role !== "assistant") {
            if (m.role === "user") expect(map.has(m.id)).toBe(false);
            return;
          }
          pairs++;
          const answer = map.get(m.id)!;
          expect(answer.id).toBe(next.id);
          expect(answer.parts).toEqual(next.parts);
          // The newest answer, the one that may still stream, as a fresh copy; the rest as they are.
          if (i + 1 === messages.length - 1) expect(answer).not.toBe(next);
          else expect(answer).toBe(next);
        });
        expect(map.size).toBe(pairs);
      }),
      runs(200),
    );
  });
});
