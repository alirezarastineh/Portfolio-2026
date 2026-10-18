// Checks the migrations against what the deploy relies on (plan Phase 7):
// - each statement is additive. Deploys go API first, and the previous API
//   keeps running against the new schema, so nothing it reads or writes may go
//   away or tighten (the new-migration skill, step 1);
// - each .sql file is in drizzle's journal, which is what the migrator runs and
//   what verify-deploy.sh's "all N migrations applied" is counted against;
// - verify-deploy.sh names each migration from 0008 on in one of its checks
//   (the new-migration skill, step 7).
// It reads files only. A deliberate exception carries
// `-- non-additive: <reason>` in the statement it excuses.
//
// Usage: node scripts/check-migrations.mjs [drizzle-dir] [verify-deploy.sh]
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [
  dir = resolve(here, "../drizzle"),
  verifyDeploy = resolve(here, "../../deploy/hetzner/verify-deploy.sh"),
] = process.argv.slice(2);

// Applied before this check existed, behind a backup. Pinned by content: an
// applied migration is never edited, and the waiver covers this text alone.
const LEGACY = new Map([
  [
    "0009_contract_cleanup.sql",
    {
      sha256: "b28e575391149bf8be47eb62ca793fd7a6294169d63ca22affd0e9cd649ce25c",
      reason: "content v2's contract step; the v1 image columns had no readers left",
    },
  ],
]);

// verify-deploy.sh has a check for each migration from this one on.
const FIRST_VERIFIED = 8;

// What the previous API would trip over, matched with the comments, strings
// and quoted names blanked out.
const RULES = [
  [
    /\bDROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|TYPE|SCHEMA|SEQUENCE|DOMAIN)\b/i,
    "drops a table, view, type, schema or sequence",
  ],
  [/\bDROP\s+COLUMN\b/i, "drops a column"],
  [/\bRENAME\b/i, "renames something"],
  [
    /\bALTER\s+(?:COLUMN\s+)?(?!(?:COLUMN|TABLE)\b)\S+\s+(?:SET\s+DATA\s+)?TYPE\b/i,
    "changes a column's type",
  ],
  [/\bSET\s+NOT\s+NULL\b/i, "makes a column NOT NULL"],
  [/\bDROP\s+DEFAULT\b/i, "drops a column's default"],
  [/\bTRUNCATE\b/i, "empties a table"],
];
// A new NOT NULL column fails the previous API's inserts, and the migration
// itself on a table with rows, unless something fills it.
const ADD_COLUMN = /\bADD\s+COLUMN\b[^,;]*/gi;
const FILLED = /\b(?:DEFAULT|GENERATED|SMALLSERIAL|SERIAL|BIGSERIAL)\b/i;
const NOT_NULL = /\bNOT\s+NULL\b/i;

const WAIVER = /--\s*non-additive:[ \t]*(\S[^\n]*)/i;
// Comments, strings and quoted names, read in one pass from the left: a quote
// inside a comment, or "--" inside a string, belongs to the token it sits in.
const TOKENS = new RegExp(
  [/--[^\n]*/, /\/\*[\s\S]*?\*\//, /'(?:[^']|'')*'/, /"(?:[^"]|"")*"/]
    .map((token) => token.source)
    .join("|"),
  "g",
);
const BLANK = { "'": "''", '"': '""' };
const code = (sql) => sql.replace(TOKENS, (token) => BLANK[token[0]] ?? " ");

const problems = [];
const notes = [];

const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8"));
const tags = journal.entries.map((entry) => entry.tag);
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();
for (const file of files) {
  if (!tags.includes(file.slice(0, -4))) {
    problems.push(`${file} is not in meta/_journal.json: the migrator never runs it`);
  }
}
for (const tag of tags) {
  if (!files.includes(`${tag}.sql`))
    problems.push(`meta/_journal.json lists ${tag}, which has no .sql file`);
}

let additive = 0;
for (const file of files) {
  const text = readFileSync(join(dir, file), "utf8").replaceAll("\r\n", "\n");
  const legacy = LEGACY.get(file);
  if (legacy) {
    const sha256 = createHash("sha256").update(text).digest("hex");
    if (sha256 === legacy.sha256) {
      notes.push(`waived: ${file} (legacy: ${legacy.reason})`);
    } else {
      problems.push(`${file} changed since it was waived: an applied migration is never edited`);
    }
    continue;
  }
  let clean = true;
  // drizzle's migrator runs each chunk between these markers as one query.
  text.split("--> statement-breakpoint").forEach((statement, i) => {
    const body = code(statement);
    const found = RULES.filter(([rule]) => rule.test(body)).map(([, label]) => label);
    for (const [clause] of body.matchAll(ADD_COLUMN)) {
      if (NOT_NULL.test(clause) && !FILLED.test(clause))
        found.push("adds a NOT NULL column with no default");
    }
    if (found.length === 0) return;
    const waiver = statement.match(WAIVER);
    if (waiver) {
      notes.push(`waived: ${file}, statement ${i + 1} (non-additive: ${waiver[1].trim()})`);
      return;
    }
    clean = false;
    problems.push(
      `${file}, statement ${i + 1}, ${found.join(", ")}:\n    ${statement.trim().replaceAll("\n", "\n    ")}`,
    );
  });
  if (clean) additive++;
}

const script = readFileSync(verifyDeploy, "utf8");
const verified = [];
for (const tag of tags) {
  const number = tag.match(/^(\d+)_/)?.[1];
  if (!number || Number(number) < FIRST_VERIFIED) continue;
  // As its pass and fail messages name them: "migration 0027", "migration 0027_mcp_usage".
  const named = new RegExp(String.raw`\b(?:pass|fail|check)\s+"[^"\n]*\bmigration ${number}(?!\d)`);
  if (named.test(script)) verified.push(number);
  else
    problems.push(
      `verify-deploy.sh has no check naming migration ${number} (the new-migration skill, step 7)`,
    );
}

console.log(`journal: ${tags.length} migrations, ${files.length} .sql files`);
console.log(`additive: ${additive} of ${files.length} files`);
for (const note of notes) console.log(`  ${note}`);
if (verified.length > 0) {
  console.log(`verify-deploy.sh: checks each of migrations ${verified[0]} to ${verified.at(-1)}`);
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`FAIL ${problem}`);
  console.error(`check-migrations: ${problems.length} problem(s)`);
  // On GitHub Actions, each problem also goes on the run's page, which shows
  // annotations to readers without a login (the GitHub Actions plan, Phase 3).
  if (process.env.GITHUB_ACTIONS === "true") {
    const escape = (text) =>
      text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
    for (const problem of problems) console.log(`::error title=migrations::${escape(problem)}`);
  }
  process.exit(1);
}
