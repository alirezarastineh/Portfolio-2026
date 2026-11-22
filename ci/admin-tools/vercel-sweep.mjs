// Vercel's Web Interface Guidelines, the rules a script can answer, over the admin's templates. Read-only.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url)).replace(/[\\/]$/, "");
const ROOTS = [`${REPO}/client/src/app/admin`, `${REPO}/client/src/app/pages/admin`, `${REPO}/client/src/app/pages/admin.page.ts`];
const SRC = `${REPO}/client/src/app`;
const files = [];
(function walk(paths) {
  for (const p of paths) {
    if (statSync(p).isDirectory()) {
      walk(readdirSync(p).map((n) => join(p, n)));
    } else if (p.endsWith(".ts") && !p.endsWith(".spec.ts")) {
      files.push(p);
    }
  }
})(ROOTS);
const rel = (f) => relative(SRC, f).replaceAll("\\", "/");
const lineOf = (text, i) => text.slice(0, i).split("\n").length;
const R = {};
const add = (rule, file, text, i, note = "") => {
  const where = `${rel(file)}:${lineOf(text, i)}`;
  R[rule] ??= [];
  R[rule].push(note ? `${where} ${note}` : where);
};

for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/<ng-icon\b[^>]*>/g)) {
    if (!/aria-hidden|aria-label/.test(m[0])) {
      add("icon without aria-hidden", file, text, m.index);
    }
  }
  for (const m of text.matchAll(/<button\b([^>]*)>\s*<ng-icon\b[^>]*>(?:\s*<\/ng-icon>)?\s*<\/button>/g)) {
    if (!/aria-label/.test(m[1])) {
      add("icon-only button without aria-label", file, text, m.index);
    }
  }
  for (const m of text.matchAll(/transition-all|transition:\s*all/g)) {
    add("transition all", file, text, m.index);
  }
  for (const m of text.matchAll(/outline-none|outline:\s*none/g)) {
    const around = text.slice(Math.max(0, m.index - 200), m.index + 200);
    if (!/focus-visible|focus:/.test(around)) {
      add("outline none, no replacement nearby", file, text, m.index);
    }
  }
  // Each text run and quoted copy whole, then the dots in it: one pattern for both would backtrack.
  for (const m of text.matchAll(/>[^<>{}]*</g)) {
    if (m[0].includes("...")) {
      add("three dots in copy", file, text, m.index, m[0].slice(1, 50));
    }
  }
  for (const m of text.matchAll(/(?:description|label|title|placeholder|hint|text)\s*[:=]\s*"([^"\n]*)"/g)) {
    if (m[1].includes("...")) {
      add("three dots in copy", file, text, m.index, m[1].slice(0, 50));
    }
  }
  for (const m of text.matchAll(/<img\b[^>]*>/g)) {
    if (!/\bwidth=|\[width\]|\[attr\.width\]/.test(m[0])) {
      add("img without width and height", file, text, m.index);
    }
    if (!/loading=/.test(m[0])) {
      add("img without loading", file, text, m.index);
    }
    if (!/\balt=|\[alt\]|\[attr\.alt\]/.test(m[0])) {
      add("img without alt", file, text, m.index);
    }
  }
  for (const m of text.matchAll(/<(div|span|li|tr|td)\b[^>]*\(click\)=/g)) {
    add("click on a non-control", file, text, m.index, m[1]);
  }
  for (const m of text.matchAll(/toLocale(?:Date|Time)?String\(/g)) {
    add("toLocaleString, not one shared Intl formatter", file, text, m.index);
  }
  for (const m of text.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
    if (!/rel=/.test(m[0])) {
      add("new tab without rel", file, text, m.index);
    }
  }
  for (const m of text.matchAll(/\bautofocus\b/g)) {
    add("autofocus", file, text, m.index);
  }
  for (const m of text.matchAll(/<table\b[^>]*>/g)) {
    const end = text.indexOf("</table>", m.index);
    const t = text.slice(m.index, end);
    if (!/<caption/.test(t)) {
      add("table without caption", file, text, m.index);
    }
    if (!/tabular-nums|font-mono|font-data|text-data/.test(m[0] + t)) {
      add("table without tabular numbers", file, text, m.index);
    }
    if (!/scope=/.test(t)) {
      add("th without scope", file, text, m.index);
    }
  }
  for (const m of text.matchAll(/<select\b[^>]*>/g)) {
    if (!/hlm|bg-/.test(m[0])) {
      add("native select without explicit colours", file, text, m.index);
    }
  }
  for (const m of text.matchAll(/\btext-\[1[01](?:\.\d+)?px\]|text-\[0\.[67]\d*rem\]/g)) {
    add("text under 12px", file, text, m.index, m[0]);
  }
  for (const m of text.matchAll(/\b(amber|indigo|emerald|violet|sky|rose)-\d{2,3}/g)) {
    add("palette colour outside the tokens", file, text, m.index, m[0]);
  }
  for (const m of text.matchAll(/signal<[^>]*(?:Tab|tab|Filter|filter|view)[^>]*>\(|(?:tab|filter|view)\s*=\s*signal/g)) {
    add("view state in a signal, not the URL", file, text, m.index);
  }
  for (const m of text.matchAll(/toast\.error\([^,]+,\s*\{\s*description:\s*(?:result|saved|res|r)\.error/g)) {
    add("toast shows a raw API code", file, text, m.index);
  }
  for (const m of text.matchAll(/placeholder="([^"]+)"/g)) {
    if (/[a-z]$/i.test(m[1]) && m[1].split(" ").length > 2) {
      add("placeholder without an ellipsis", file, text, m.index, m[1].slice(0, 30));
    }
  }
}

const summary = Object.fromEntries(Object.entries(R).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, v.length]));
const OUT = process.env.ADMIN_TOOLS_OUT ?? `${REPO}/.claude/specs/admin-redesign`;
writeFileSync(`${OUT}/vercel-sweep.json`,JSON.stringify({ files: files.length, summary, findings: R }, null, 1));
console.log(`files ${files.length}`);
for (const [k, n] of Object.entries(summary)) {
  console.log(`${String(n).padStart(4)}  ${k}   e.g. ${R[k].slice(0, 2).join(" ; ")}`);
}
