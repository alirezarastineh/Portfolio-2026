import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { targetsProdTunnel } from "../db/migrate.js";
import { fixtureConfig, fixtureCorpus } from "../test/ask-fixtures.js";
import { mockEntry, scripted } from "../test/ask-models.js";
import { buildTools, TOOL_NAMES } from "./tools.js";
import { nextCheckAt, startTrustMonitor, stopTrustMonitor } from "./trust-monitor.js";
import {
  errorRateVerdict,
  faithfulnessVerdict,
  modelSubject,
  TRUST_REGISTRY,
  TRUST_RULES,
  withoutDemoted,
} from "./trust.js";

describe("the trust registry (plan phase 14)", () => {
  it("gives every tool the agent gets a level, and every action one entry", () => {
    const actions = TRUST_REGISTRY.map((e) => e.action);
    expect(new Set(actions).size).toBe(actions.length);
    // The tools the agent is actually given, not only the list kept by hand.
    const given = Object.keys(buildTools(fixtureCorpus(), "en"));
    expect([...given].sort()).toEqual([...TOOL_NAMES].sort());
    for (const tool of given) {
      expect(TRUST_REGISTRY.find((e) => e.action === tool)?.actor, tool).toBe("assistant");
    }
  });

  it("names an approver for every suggest-only action, and leaves publish to a human", () => {
    for (const entry of TRUST_REGISTRY.filter((e) => e.level === "L0")) {
      expect(entry.approver, entry.action).not.toBe("none");
    }
    expect(TRUST_REGISTRY.filter((e) => e.level === "human").map((e) => e.action)).toEqual([
      "publish",
    ]);
    expect(TRUST_REGISTRY.some((e) => e.level === "L3")).toBe(false);
  });

  it("lets Diagnose only propose, and its replay only run when the admin starts it (plan phase 24)", () => {
    expect(TRUST_REGISTRY.find((e) => e.action === "journal.diagnose")).toMatchObject({
      actor: "system",
      level: "L0",
      approver: "admin",
      built: true,
    });
    expect(TRUST_REGISTRY.find((e) => e.action === "journal.replay")).toMatchObject({
      actor: "run",
      level: "L2",
      approver: "admin",
      built: true,
    });
  });

  it("lets the copilot's skills only draft: the admin keeps or discards each one (plan phase 27)", () => {
    const entry = TRUST_REGISTRY.find((e) => e.action === "copilot.suggest");
    expect(entry).toMatchObject({
      actor: "copilot",
      level: "L0",
      approver: "admin",
      reversible: true,
      built: true,
    });
    expect(entry?.enforcement).toMatch(/skills\/registry\.ts/);
    expect(entry?.enforcement).toMatch(/ai_skill_uses: ids and word counts, no text/);
  });

  it("lets the content agent only propose, and the admin apply each proposal (plan phases 29–30)", () => {
    // Proposing never writes the content: proved below ("the content agent proposes…").
    expect(TRUST_REGISTRY.find((e) => e.action === "agent.propose")).toMatchObject({
      actor: "agent",
      level: "L0",
      approver: "admin",
      built: true,
    });
    // Applying writes the drafts on the admin's decision only, reversibly, and never publishes.
    const apply = TRUST_REGISTRY.find((e) => e.action === "agent.apply");
    expect(apply).toMatchObject({
      actor: "agent",
      level: "L1",
      approver: "admin",
      reversible: true,
      built: true,
    });
    expect(apply?.enforcement).toMatch(/agent\/apply\.ts/);
    expect(apply?.enforcement).toMatch(/loaded only by the proposals' routes/);
    expect(apply?.enforcement).toMatch(/never publishes/);
  });

  it("lets the FAQ pipeline only propose: the admin's accept writes the FAQ (plan phase 31)", () => {
    // Proved below ("the FAQ pipeline proposes…").
    const propose = TRUST_REGISTRY.find((e) => e.action === "faq.propose");
    expect(propose).toMatchObject({
      actor: "agent",
      level: "L0",
      approver: "admin",
      reversible: true,
      built: true,
    });
    expect(propose?.enforcement).toMatch(/agent\/faq-chain\.ts/);
    expect(propose?.enforcement).toMatch(/only by the admin's accept/);
  });

  it("lets the nightly judge run only within its own fence (plan phase 26)", () => {
    const entry = TRUST_REGISTRY.find((e) => e.action === "judge.nightly");
    expect(entry).toMatchObject({ actor: "system", level: "L2", built: true });
    expect(entry?.enforcement).toMatch(/nightlyJudge/);
  });

  it("lets the learning check run insights and retire a lesson, and only the admin propose one (plan phase 25)", () => {
    const entry = (action: string) => TRUST_REGISTRY.find((e) => e.action === action);
    expect(entry("insights.auto")).toMatchObject({ actor: "system", level: "L2", built: true });
    expect(entry("insights.auto")?.enforcement).toMatch(/autoInsights/);
    expect(entry("lesson.retire")).toMatchObject({
      actor: "system",
      level: "L2",
      reversible: true,
      built: true,
    });
    expect(entry("lesson.propose")).toMatchObject({
      actor: "admin",
      level: "L0",
      approver: "admin",
      built: true,
    });
  });
});

describe("the nightly schedule", () => {
  afterEach(() => {
    stopTrustMonitor();
    vi.useRealTimers();
  });

  it("checks at 03:00 UTC and every 24 hours after, not while the deploy has the assistant off", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => null);
    let config = fixtureConfig();
    startTrustMonitor({ now: new Date("2026-10-01T02:00:00Z"), check, config: () => config });
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
    config = fixtureConfig({ enabled: false });
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(check).toHaveBeenCalledTimes(1);
    config = fixtureConfig();
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(check).toHaveBeenCalledTimes(2);
  });

  it("logs a failed check and tries again the next night", async () => {
    vi.useFakeTimers();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const check = vi.fn(async () => {
      throw new Error("the database is down");
    });
    startTrustMonitor({
      now: new Date("2026-10-01T02:59:00Z"),
      check,
      config: () => fixtureConfig(),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(logged).toHaveBeenCalledWith("[trust] check failed", expect.any(Error));
    await vi.advanceTimersByTimeAsync(24 * 3_600_000);
    expect(check).toHaveBeenCalledTimes(2);
    logged.mockRestore();
  });
});

describe("the demotion rules", () => {
  const scores = (n: number, score: number) => Array.from({ length: n }, () => score);

  it("demotes a model below the faithfulness floor, given enough judged answers", () => {
    const m = modelSubject("gemini-x");
    expect(faithfulnessVerdict(m, scores(TRUST_RULES.judgedMinimum - 1, 0)).verdict).toBe(
      "too-little",
    );
    expect(faithfulnessVerdict(m, scores(TRUST_RULES.judgedMinimum, 0.79)).verdict).toBe("demote");
    expect(faithfulnessVerdict(m, scores(TRUST_RULES.judgedMinimum, 0.8)).verdict).toBe("keep");
    // Only the latest 50 count: older, poorer answers do not.
    const recentGood = [...scores(TRUST_RULES.judgedWindow, 0.9), ...scores(50, 0)];
    expect(faithfulnessVerdict(m, recentGood)).toMatchObject({ verdict: "keep", n: 50 });
  });

  it("demotes the deep route above the failure ceiling, leaving aborted answers out", () => {
    const answers = (failed: number, aborted = 0) => [
      ...Array.from({ length: failed }, () => "error:timeout"),
      ...Array.from({ length: aborted }, () => "aborted"),
      ...Array.from({ length: TRUST_RULES.deepWindow - failed }, () => "stop"),
    ];
    expect(errorRateVerdict("route:deep", answers(6)).verdict).toBe("keep");
    expect(errorRateVerdict("route:deep", answers(7))).toMatchObject({
      verdict: "demote",
      n: 30,
    });
    expect(errorRateVerdict("route:deep", answers(7, 5)).verdict).toBe("demote");
    expect(errorRateVerdict("route:deep", answers(7).slice(1)).verdict).toBe("too-little");
  });

  it("checks nightly at 03:00 UTC", () => {
    expect(nextCheckAt(new Date("2026-10-01T02:59:00Z")).toISOString()).toBe(
      "2026-10-01T03:00:00.000Z",
    );
    expect(nextCheckAt(new Date("2026-10-01T03:00:00Z")).toISOString()).toBe(
      "2026-10-02T03:00:00.000Z",
    );
  });

  it("skips demoted models, but never leaves a chain empty", () => {
    const a = mockEntry("a", scripted([]).model);
    const b = mockEntry("b", scripted([]).model);
    expect(withoutDemoted([a, b], new Set([modelSubject("a")])).map((e) => e.id)).toEqual(["b"]);
    expect(
      withoutDemoted([a, b], new Set([modelSubject("a"), modelSubject("b")])).map((e) => e.id),
    ).toEqual(["a", "b"]);
  });
});

/* ------------------------------------------------- publish is human only */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/**
 * What agent code may take from the publish module: a read-only build, an error
 * class, and the pure `canonicalJson` (the sections' save compares documents with
 * it, and the content agent's apply saves a section through it: plan phase 30).
 */
const READ_ONLY_PUBLISH = new Set(["buildAll", "PublicationError", "canonicalJson"]);
const PUBLISH = "content/publish.ts";

// An import's clause never crosses a `;`, so an `export type X = …;` before an
// import cannot swallow it.
const IMPORT = /^\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/gm;
const SIDE_EFFECT = /^\s*import\s+["']([^"']+)["']/gm;
const DYNAMIC = /\bimport\s*\(\s*[`"']([^`"'$]+)[`"']\s*\)/g;
/** A dynamic import of a computed path, or a CommonJS require: neither can be followed. */
const UNFOLLOWABLE = /\bimport\s*\(\s*(?![`"'][^`"'$]*[`"']\s*\))|require\s*\(/i;
/**
 * A Drizzle column's table, read or destructured: a column passed around
 * could write the table it came from. A computed key is beyond a static scan.
 */
const COLUMN_TABLE = /\.\s*table\b|\[\s*[`"']table[`"']\s*\]|\{[^{}]*\btable\b[^{}]*\}\s*[=):]/;
/** What publishing writes: written anywhere else, it would publish around the publish module. */
const PUBLICATION_TABLES = [
  "contentPointers",
  "contentVersions",
  "contentPublications",
  "contentVersionDocs",
  "versionMediaRefs",
];
const PUBLICATION_TABLE_NAMES =
  "content_pointers|content_versions|content_publications|content_version_docs|version_media_refs";
const NAMES_A_TABLE = new RegExp(
  String.raw`\b(${[...PUBLICATION_TABLES, PUBLICATION_TABLE_NAMES].join("|")})\b`,
  "gi",
);
/** Where the tables are defined: it names them everywhere, and must never write them. */
const SCHEMA = "db/schema.ts";
/** The one agent module that reads them (the published corpus): it may only read. */
const PUBLICATION_READERS = new Set(["ask/corpus/build.ts"]);
/** A SQL write, the table named outright (quoted or not, `public.` or not) or in a template. */
const SQL_WRITE = new RegExp(
  String.raw`\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?|alter\s+table|drop\s+table)\s+(?:"?public"?\s*\.\s*)?(?:"|\$\{\s*(?:\w+\.)?)?(${[...PUBLICATION_TABLES, PUBLICATION_TABLE_NAMES].join("|")})\b`,
  "i",
);

/** The first mention of a publication table, or null. */
function firstMention(text: string): RegExpExecArray | null {
  NAMES_A_TABLE.lastIndex = 0;
  return NAMES_A_TABLE.exec(text);
}

/** Where the tables are defined: a write there, in Drizzle or in SQL. */
function schemaWrite(text: string): RegExpExecArray | null {
  const drizzle = new RegExp(
    String.raw`\.(?:insert|update|delete)\(\s*(?:\w+\.)?(${PUBLICATION_TABLES.join("|")})\b`,
  );
  return drizzle.exec(text) ?? SQL_WRITE.exec(text);
}

/**
 * In a reader, a table may be imported under its own name, have one column
 * read (`contentPointers.locale`), or be what a query reads from (`.from(x)`,
 * `.innerJoin(x, …)`). Any other mention is not a read: a write, a rename, a
 * table passed to a helper or kept in a variable, raw SQL, `sql.identifier`.
 * Nor may a column lead back to its table, anywhere (`COLUMN_TABLE`).
 */
function notARead(text: string): RegExpExecArray | null {
  const clauses = [...text.matchAll(/^\s*import\s*\{[^}]*\}\s*from\s*["'][^"']+["']/gm)];
  for (const m of text.matchAll(NAMES_A_TABLE)) {
    const end = m.index + m[0].length;
    const after = text.slice(end, end + 40);
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const imported =
      clauses.some((c) => m.index > c.index && end < c.index + c[0].length) &&
      !/^\s+as\b/.test(after);
    const column = /^\s*\.\s*[\w$]+(?![\w$])(?!\s*[.[(])/.test(after);
    const readFrom = /\.(?:from|innerJoin|leftJoin|rightJoin|fullJoin)\(\s*$/.test(before);
    if (!imported && !column && !readFrom) return m;
  }
  return null;
}

interface Import {
  from: string;
  to: string;
  /** The named bindings, or `*` for a namespace, a default, a side effect or a dynamic import. */
  names: string[];
}

/** A module's relative imports (type-only ones are erased and do not count). */
function importsOf(file: string, text: string, root: string): Import[] {
  const resolveSpec = (spec: string) => {
    const path = resolve(dirname(join(root, file)), spec).replace(/\.js$/, ".ts");
    return relative(root, path).replaceAll("\\", "/");
  };
  const found: Import[] = [];
  for (const [, typeOnly, clause, spec] of text.matchAll(IMPORT)) {
    if (typeOnly || !spec!.startsWith(".")) continue;
    const named = /^\{([\s\S]*)\}$/.exec(clause!.trim());
    const names = named
      ? named[1]!
          .split(",")
          .map((n) => n.trim())
          .filter((n) => n && !n.startsWith("type "))
          .map((n) => n.split(/\s+as\s+/)[0]!.trim())
      : ["*"];
    found.push({ from: file, to: resolveSpec(spec!), names });
  }
  for (const pattern of [SIDE_EFFECT, DYNAMIC]) {
    for (const [, spec] of text.matchAll(pattern)) {
      if (spec!.startsWith(".")) found.push({ from: file, to: resolveSpec(spec!), names: ["*"] });
    }
  }
  return found;
}

/**
 * Every way agent code could publish: an import of a publish write (or of
 * the whole module), of a route module, an import it cannot follow, or the
 * publication tables named where only the schema and the corpus reader may.
 * A static tripwire for the code we write, not a sandbox: the boundary itself
 * is the read-only tools and the admin session publish needs. `read` returns
 * a module's source, or null when it does not exist.
 */
function publishReach(
  entries: string[],
  read: (file: string) => string | null,
  root: string,
): Import[] {
  const seen = new Set<string>();
  const queue = [...entries];
  const offending: Import[] = [];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    if (text === null) continue;
    // The publish module writes the tables itself, behind the exports checked
    // below. Elsewhere only the schema and the one reader may name them at all.
    if (file !== PUBLISH) {
      const write =
        file === SCHEMA
          ? schemaWrite(text)
          : PUBLICATION_READERS.has(file)
            ? notARead(text)
            : firstMention(text);
      if (write) offending.push({ from: file, to: "(publication tables)", names: [write[1]!] });
      if (COLUMN_TABLE.test(text)) {
        offending.push({ from: file, to: "(a column's table)", names: ["table"] });
      }
    }
    if (UNFOLLOWABLE.test(text)) {
      offending.push({ from: file, to: "(computed import)", names: ["*"] });
    }
    for (const imp of importsOf(file, text, root)) {
      if (imp.to === PUBLISH && imp.names.some((n) => !READ_ONLY_PUBLISH.has(n))) {
        offending.push(imp);
      }
      // The publish route lives there: no agent module may mount or call one.
      if (imp.to.startsWith("routes/")) offending.push(imp);
      queue.push(imp.to);
    }
  }
  return offending;
}

function sources(dir: string): string[] {
  return readdirSync(join(SRC, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(SRC, path)).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.includes(".spec.") ? [path] : [];
  });
}

const readSource = (file: string) =>
  existsSync(join(SRC, file)) ? readFileSync(join(SRC, file), "utf8") : null;

const described = (found: Import[]) =>
  found
    .map(
      (i) => `${i.from}: ${i.to === PUBLISH ? i.names.join(",") : `${i.to} ${i.names.join(",")}`}`,
    )
    .sort();

/** The editors' content tables: the drafts and the live FAQ, which the content agent must never write. */
const CONTENT_TABLES = [
  "projects",
  "projectTranslations",
  "projectGallery",
  "experiences",
  "experienceTranslations",
  "posts",
  "postTranslations",
  "skills",
  "skillTranslations",
  "contentDocuments",
  "mediaAssets",
  "mediaVariants",
  "siteProfile",
  "profileResumes",
  "socials",
  "aiFaq",
  "aiFaqTranslations",
];
/** The tables a proof forbids writing, and how a write to one reads in SQL. */
interface Forbidden {
  tables: readonly string[];
  /** A SQL write to one, named outright (quoted or not, `public.` or not) or in a template. */
  sqlWrite: RegExp;
  /** One named for SQL to use as it likes. */
  identifier: RegExp;
}

function forbidding(tables: readonly string[]): Forbidden {
  const names = tables.map((t) => t.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
  return {
    tables,
    sqlWrite: new RegExp(
      String.raw`\b(?:insert\s+into|update|delete\s+from|merge\s+into|truncate(?:\s+table)?|alter\s+table|drop\s+table)\s+(?:only\s+)?(?:"?public"?\s*\.\s*)?(?:"|\$\{\s*(?:\w+\.)?)?(?:${[...names, ...tables].join("|")})\b`,
      "i",
    ),
    identifier: new RegExp(
      String.raw`sql\s*\.\s*(?:identifier|raw)\(\s*[\`"'][^\`"']*\b(?:${names.join("|")})\b`,
      "i",
    ),
  };
}

/** The content agent's proposing (plan phase 29): never the content. */
const CONTENT = forbidding(CONTENT_TABLES);
/** The FAQ chain's drafting (plan phase 31): nor a lesson or the journal, which the admin's accept links. */
const FAQ_CHAIN = forbidding([...CONTENT_TABLES, "aiLessons", "aiJournal"]);
/** An import from the schema: its clause, and where it comes from. */
const SCHEMA_IMPORT = /^\s*import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gm;

/**
 * A module's text with its comments blanked out, and with `strings` its quoted
 * strings too; template literals are kept (they hold SQL and `${…}`). Every
 * character keeps its place, so a match's index is the same in the source.
 */
function blanked(text: string, strings: boolean): string {
  let out = "";
  let state: "code" | "line" | "block" | "quoted" = "code";
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const next = text[i + 1];
    if (state === "code") {
      if (c === "/" && next === "/") state = "line";
      else if (c === "/" && next === "*") state = "block";
      else if (c === "'" || c === '"') {
        state = "quoted";
        quote = c;
        out += strings ? " " : c;
        continue;
      }
      out += state === "code" ? c : " ";
    } else if (state === "line") {
      if (c === "\n") state = "code";
      out += c === "\n" ? c : " ";
    } else if (state === "block") {
      if (c === "*" && next === "/") {
        state = "code";
        i++;
        out += "  ";
      } else out += c === "\n" ? c : " ";
    } else if (c === "\\") {
      out += strings ? "  " : c + (next ?? "");
      i++;
    } else {
      if (c === quote) state = "code";
      out += strings && c !== "\n" ? " " : c;
    }
  }
  return out;
}

/**
 * How a module could write a content table: a schema binding used for anything
 * but a read (`.from(t)`, a join, a column `t.col`): written, aliased, kept in a
 * variable, passed to a helper. Aliases and namespace imports are followed; a
 * namespace used bare (destructured, passed on) counts. SQL that writes one,
 * `sql.identifier` or `sql.raw` naming one, and an import that cannot be
 * followed count too. Comments say nothing either way.
 */
function contentWriteIn(text: string, forbidden: Forbidden = CONTENT): string | null {
  const prose = blanked(text, false);
  if (UNFOLLOWABLE.test(prose)) return "an import that cannot be followed";
  if (forbidden.sqlWrite.test(prose)) return "SQL that writes a content table";
  if (forbidden.identifier.test(prose)) return "a content table named for SQL";

  const imports = [...prose.matchAll(SCHEMA_IMPORT)];
  const bindings = new Set<string>();
  const namespaces: string[] = [];
  for (const m of imports) {
    if (m[1] || !/(^|\/)db\/schema(\.js)?$/.test(m[3]!)) continue;
    const clause = m[2]!.trim();
    const ns = /^\*\s+as\s+(\w+)$/.exec(clause);
    if (ns) namespaces.push(ns[1]!);
    const named = /\{([\s\S]*)\}/.exec(clause)?.[1] ?? "";
    for (const part of named.split(",")) {
      const [name, alias] = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .map((s) => s.trim());
      if (name && forbidden.tables.includes(name)) bindings.add(alias ?? name);
    }
  }
  const names = [
    ...bindings,
    ...namespaces.flatMap((ns) => [
      ...forbidden.tables.map((t) => String.raw`${ns}\s*\.\s*${t}`),
      // A namespace used bare could hand any table on.
      String.raw`${ns}(?!\s*\.)`,
    ]),
  ];
  if (!names.length) return null;
  const code = blanked(text, true);
  const inImport = (at: number) => imports.some((m) => at >= m.index && at < m.index + m[0].length);
  const mention = new RegExp(String.raw`(?<![\w$.])(?:${names.join("|")})(?![\w$])`, "g");
  for (const m of code.matchAll(mention)) {
    if (inImport(m.index)) continue;
    const end = m.index + m[0].length;
    const after = code.slice(end, end + 40);
    const before = code.slice(Math.max(0, m.index - 40), m.index);
    const column = /^\s*\.\s*[\w$]+(?![\w$])(?!\s*\()/.test(after);
    const readFrom = /\.(?:from|innerJoin|leftJoin|rightJoin|fullJoin)\(\s*$/.test(before);
    // A whole row selected: `.select({ project: projects })`.
    const selected = /\.select(?:Distinct)?\(\s*\{[^(){}]*$/.test(
      code.slice(Math.max(0, m.index - 200), m.index),
    );
    if (!column && !readFrom && !selected) {
      return `${m[0].replace(/\s+/g, "")} used for more than a read`;
    }
  }
  return null;
}

/**
 * Every module `entry` loads (relative imports, type-only ones aside) that
 * could write a forbidden table (the content's, by default), and how.
 */
function contentWrites(
  entry: string,
  read: (file: string) => string | null,
  root: string,
  forbidden: Forbidden = CONTENT,
): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  const writers: string[] = [];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = read(file);
    // The publish module is fenced by the publish proof: an agent module may load only its
    // read-only exports (`READ_ONLY_PUBLISH`), so its own writes are out of the agent's reach.
    if (text === null || file === PUBLISH) continue;
    const how = file === "db/schema.ts" ? null : contentWriteIn(text, forbidden);
    if (how) writers.push(`${file}: ${how}`);
    for (const imp of importsOf(file, text, root)) queue.push(imp.to);
  }
  return writers.sort();
}

describe("the content agent proposes, and never writes the content (plan phase 29)", () => {
  it("loads no module that could write a content table, however it would", () => {
    expect(contentWrites("ask/agent/content-work.ts", readSource, SRC)).toEqual([]);
  });

  it("would catch a write however it is spelled, and wherever it is imported from", () => {
    const schema = (names: string) => `import { ${names} } from "../db/schema.js";\n`;
    const planted: Record<string, string> = {
      "ask/agent/content-work.ts": [
        "plain",
        "alias",
        "namespace",
        "bare",
        "helper",
        "variable",
        "sql",
        "identifier",
        "truncate",
        "merge",
        "computed",
        "reader",
      ]
        .map((name) => `import "../${name}.js";`)
        .join("\n"),
      "ask/plain.ts": `${schema("projectTranslations")}db.update(projectTranslations).set({});`,
      "ask/alias.ts": `${schema("projectTranslations as pt")}db.update(pt).set({});`,
      "ask/namespace.ts": `import * as s from "../db/schema.js";\ndb.insert(s.aiFaq).values({});`,
      "ask/bare.ts": `import * as s from "../db/schema.js";\nconst { contentDocuments: docs } = s;`,
      "ask/helper.ts": `${schema("mediaAssets")}write(tx, mediaAssets);`,
      "ask/variable.ts": `${schema("postTranslations")}const table = postTranslations;`,
      "ask/sql.ts": 'db.execute(sql`update "public"."project_translations" set hook = \'\'`);',
      "ask/identifier.ts": 'db.execute(sql`delete from ${sql.identifier("content_documents")}`);',
      "ask/truncate.ts": "db.execute(sql`truncate table skill_translations`);",
      "ask/merge.ts": "db.execute(sql`merge into ai_faq using x on true`);",
      "ask/computed.ts": "const m = await import(`../${name}.js`);",
      // Reads only: from, joins, columns; and a table named in a comment or a label.
      "ask/reader.ts": `${schema("projects, projectTranslations")}// we update projects elsewhere\nconst label = "the projects";\ndb.select({ id: projects.id }).from(projects).innerJoin(projectTranslations, eq(projectTranslations.projectId, projects.id));`,
    };
    expect(contentWrites("ask/agent/content-work.ts", (f) => planted[f] ?? null, SRC)).toEqual([
      "ask/alias.ts: pt used for more than a read",
      "ask/bare.ts: s used for more than a read",
      "ask/computed.ts: an import that cannot be followed",
      "ask/helper.ts: mediaAssets used for more than a read",
      "ask/identifier.ts: a content table named for SQL",
      "ask/merge.ts: SQL that writes a content table",
      "ask/namespace.ts: s.aiFaq used for more than a read",
      "ask/plain.ts: projectTranslations used for more than a read",
      "ask/sql.ts: SQL that writes a content table",
      "ask/truncate.ts: SQL that writes a content table",
      "ask/variable.ts: postTranslations used for more than a read",
    ]);
  });
});

/** Every module of the API, specs aside. */
const allSources = () =>
  readdirSync(SRC).flatMap((name) => {
    if (statSync(join(SRC, name)).isDirectory()) return sources(name);
    return name.endsWith(".ts") && !name.includes(".spec.") ? [name] : [];
  });

/** The modules among `files` that load `target` (type-only imports aside). */
function importersOf(
  target: string,
  files: readonly string[],
  read: (file: string) => string | null,
): string[] {
  return files
    .filter((file) => importsOf(file, read(file) ?? "", SRC).some((i) => i.to === target))
    .sort();
}

describe("the content agent's apply runs only on the admin's decision (plan phase 30)", () => {
  it("is loaded by the proposals' routes alone, which only the admin router mounts", () => {
    const files = allSources();
    expect(importersOf("ask/agent/apply.ts", files, readSource)).toEqual(["ask/agent/routes.ts"]);
    expect(importersOf("ask/agent/routes.ts", files, readSource)).toEqual(["ask/admin.ts"]);
  });

  it("would see it loaded however the import is spelled", () => {
    const planted: Record<string, string> = {
      "ask/agent.ts": 'const decide = await import("./agent/apply.js");',
      "ask/runs/runner.ts": 'export { applyProposal } from "../agent/apply.js";',
      "ask/agent/content-work.ts": 'import * as decide from "./apply.js";',
      "ask/agent/routes.ts": 'import { applyProposal } from "./apply.js";',
      // Erased at build: it loads nothing.
      "ask/agent/types.ts": 'import type { Decided } from "./apply.js";',
    };
    expect(
      importersOf("ask/agent/apply.ts", Object.keys(planted), (f) => planted[f] ?? null),
    ).toEqual([
      "ask/agent.ts",
      "ask/agent/content-work.ts",
      "ask/agent/routes.ts",
      "ask/runs/runner.ts",
    ]);
  });
});

describe("the FAQ pipeline proposes; only the admin's accept writes the FAQ (plan phase 31)", () => {
  it("drafts with no module that could write the FAQ, a lesson, the journal or the content", () => {
    expect(contentWrites("ask/agent/faq-chain.ts", readSource, SRC, FAQ_CHAIN)).toEqual([]);
  });

  it("would catch the chain writing a lesson or the journal, however it is spelled", () => {
    const schema = (names: string) => `import { ${names} } from "../../db/schema.js";\n`;
    const planted: Record<string, string> = {
      "ask/agent/faq-chain.ts": [
        `${schema("aiJournal, aiFaqProposals")}`,
        // Reads and its own table: fine.
        "db.select({ id: aiJournal.id }).from(aiJournal);",
        "db.insert(aiFaqProposals).values({});",
        'import "./lesson.js";',
        'import "./journal.js";',
      ].join("\n"),
      "ask/agent/lesson.ts": `${schema("aiLessons")}db.update(aiLessons).set({});`,
      "ask/agent/journal.ts": "db.execute(sql`update ai_journal set fix_ref = ${id}`);",
    };
    expect(
      contentWrites("ask/agent/faq-chain.ts", (f) => planted[f] ?? null, SRC, FAQ_CHAIN),
    ).toEqual([
      "ask/agent/journal.ts: SQL that writes a content table",
      "ask/agent/lesson.ts: aiLessons used for more than a read",
    ]);
    // The content agent's proof leaves lessons and the journal to others.
    expect(contentWrites("ask/agent/faq-chain.ts", (f) => planted[f] ?? null, SRC)).toEqual([]);
  });

  it("decides only from its routes, which only the admin router mounts", () => {
    const files = allSources();
    expect(importersOf("ask/agent/faq-decide.ts", files, readSource)).toEqual([
      "ask/agent/faq-routes.ts",
    ]);
    expect(importersOf("ask/agent/faq-routes.ts", files, readSource)).toEqual(["ask/admin.ts"]);
    // The FAQ is written by the form's Save and by an accept, nowhere else.
    expect(importersOf("ask/faq.ts", files, readSource)).toEqual([
      "ask/admin.ts",
      "ask/agent/faq-decide.ts",
    ]);
  });
});

describe("no writes from a laptop on the tunnel", () => {
  it("knows the production tunnel by its address, and nothing else", () => {
    expect(targetsProdTunnel("postgres://app@127.0.0.1:55433/portfolio")).toBe(true);
    expect(targetsProdTunnel("postgres://app@localhost:55433/portfolio")).toBe(true);
    expect(targetsProdTunnel("postgres://app@127.0.0.1:5432/portfolio")).toBe(false);
    expect(targetsProdTunnel("postgres://app@db:55433/portfolio")).toBe(false);
    expect(targetsProdTunnel(undefined)).toBe(false);
    expect(targetsProdTunnel("not a url")).toBe(false);
  });
});

describe("publish stays out of every agent's reach", () => {
  it("no module the assistant, the copilot or a run can load can publish", () => {
    const entries = sources("ask");
    expect(entries).toContain("ask/agent.ts");
    expect(entries).toContain("ask/runs/eval-work.ts");
    expect(publishReach(entries, readSource, SRC)).toEqual([]);
  });

  it("would catch every way around it, however indirect", () => {
    const planted: Record<string, string> = {
      // Through a helper outside the agent's folder, which is not an entry.
      "ask/agent.ts": 'import { helper } from "../lib/helper.js";',
      "lib/helper.ts": 'import { publishAll as go } from "../content/publish.js";',
      // A type declared before the import must not hide it.
      "ask/typed.ts":
        'export type Mode = "a" | "b";\nimport { rollbackToPublication } from "../content/publish.js";',
      "ask/side.ts": 'import "../content/publish.js";',
      // Followed through a side effect and a dynamic import, to modules that are not entries.
      "ask/boot.ts": 'import "../lib/boot.js";',
      "lib/boot.ts": 'import { rollbackToPublication } from "../content/publish.js";',
      "ask/lazy.ts": 'const { run } = await import("../lib/lazy.js");',
      "lib/lazy.ts": 'export { publishAll } from "../content/publish.js";',
      "ask/router.ts": 'import { adminRouter } from "../routes/admin.js";',
      // A template literal is followed too; a computed path or a require cannot be.
      "ask/tick.ts": "const m = await import(`../lib/tick.js`);",
      "lib/tick.ts": 'export { publishAll } from "../content/publish.js";',
      "ask/computed.ts": "const m = await import(`../content/${name}.js`);",
      "ask/required.ts": 'const m = createRequire(import.meta.url)("../content/publish.js");',
      // Space or a line break before the bracket is still a dynamic import.
      "ask/spaced.ts": 'const { publishAll } = await import ("../content/publish.js");',
      "ask/broken.ts": 'const m = await import\n("../content/publish.js");',
      // A column carries its table: a helper given one could write that table.
      "ask/column.ts": 'import { touch } from "../lib/touch.js";\nawait touch(row);',
      "lib/touch.ts": "export const touch = (column) => db.update(column.table).set({});",
      "ask/unpacked.ts": 'import { unpack } from "../lib/unpack.js";\nawait unpack(row);',
      "lib/unpack.ts": "export const unpack = ({ table }) => db.update(table).set({});",
      // Writing the publication tables, however spelled: outside the schema and
      // the one reader, merely naming one is caught.
      "ask/writer.ts": "await db.insert(contentPointers).values(row);",
      "ask/raw.ts": "await db.execute(sql`update content_pointers set version_id = ${id}`);",
      "ask/template.ts": "await db.execute(sql`update ${contentVersions} set label = ${label}`);",
      "ask/namespace.ts": "await db.insert(schema.contentPublications).values(row);",
      "ask/alias.ts":
        'import { versionMediaRefs as refs } from "../db/schema.js";\nawait db.delete(refs);',
      "ask/qualified.ts": 'await db.execute(sql`delete from public."content_version_docs"`);',
      "ask/value.ts": "const t = contentPointers;\nawait db.update(t).set(row);",
      "ask/passed.ts": "await writeRow(contentPointers, row);",
      "ask/destructure.ts":
        "const { contentPointers: cp } = schema;\nawait db.update(cp).set(row);",
      "ask/merge.ts": "await db.execute(sql`MERGE INTO content_pointers USING incoming ON true`);",
      "ask/identifier.ts":
        'await db.execute(sql`update ${sql.identifier("content_pointers")} set version_id = ${id}`);',
      // The read-only exports are fine.
      "ask/fine.ts": 'import { buildAll, type PublishResult } from "../content/publish.js";',
    };
    const read = (file: string) => planted[file] ?? null;
    const entries = Object.keys(planted).filter((f) => f.startsWith("ask/"));
    expect(described(publishReach(entries, read, SRC))).toEqual([
      "ask/alias.ts: (publication tables) versionMediaRefs",
      "ask/broken.ts: *",
      "ask/computed.ts: (computed import) *",
      "ask/destructure.ts: (publication tables) contentPointers",
      "ask/identifier.ts: (publication tables) content_pointers",
      "ask/merge.ts: (publication tables) content_pointers",
      "ask/namespace.ts: (publication tables) contentPublications",
      "ask/passed.ts: (publication tables) contentPointers",
      "ask/qualified.ts: (publication tables) content_version_docs",
      "ask/raw.ts: (publication tables) content_pointers",
      "ask/required.ts: (computed import) *",
      "ask/router.ts: routes/admin.ts adminRouter",
      "ask/side.ts: *",
      "ask/spaced.ts: *",
      "ask/template.ts: (publication tables) contentVersions",
      "ask/typed.ts: rollbackToPublication",
      "ask/value.ts: (publication tables) contentPointers",
      "ask/writer.ts: (publication tables) contentPointers",
      "lib/boot.ts: rollbackToPublication",
      "lib/helper.ts: publishAll",
      "lib/lazy.ts: publishAll",
      "lib/tick.ts: publishAll",
      "lib/touch.ts: (a column's table) table",
      "lib/unpack.ts: (a column's table) table",
    ]);
  });

  it("lets the published corpus read the tables, and do nothing else with them", () => {
    const reader = "ask/corpus/build.ts";
    const flagged = (text: string) =>
      publishReach([reader], (file) => (file === reader ? text : null), SRC).length > 0;
    const reads = [
      'import { contentPointers, contentVersions } from "../../db/schema.js";',
      "const rows = await db",
      "  .select({ locale: contentPointers.locale, payload: contentVersions.payload })",
      "  .from(contentPointers)",
      "  .innerJoin(contentVersions, eq(contentVersions.id, contentPointers.versionId));",
    ].join("\n");
    expect(flagged(reads)).toBe(false);
    for (const write of [
      "await db.insert(contentPointers).values(row);",
      "const t = contentPointers;\nawait db.update(t).set(row);",
      "await writeRow(contentPointers, row);",
      "await db.update(contentPointers.locale.table).set(row);",
      "const col = contentPointers.locale;\nawait db.update(col.table).set(row);",
      "const { table } = contentPointers.locale;\nawait db.update(table).set(row);",
      'import { contentPointers as cp } from "../../db/schema.js";\nawait db.update(cp).set(row);',
      "await db.execute(sql`MERGE INTO content_pointers USING incoming ON true`);",
      'await db.execute(sql`truncate ${sql.identifier("content_versions")}`);',
    ]) {
      expect(flagged(`${reads}\n${write}`), write).toBe(true);
    }
  });
});
