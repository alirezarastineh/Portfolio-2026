import type { HighlighterCore, ThemedToken } from "shiki/core";

import { escapeHtml } from "./sanitize.js";

/**
 * Syntax highlighting at publish time, so visitors download no highlighter.
 *
 * Tokens become classes (`shd-ff7b72 shl-cf222e`), not inline styles: Angular's
 * sanitizer strips `style` from `[innerHTML]`. The class names stay in published
 * content; a generated stylesheet (`pnpm content:code-css`) gives each the site's
 * colour for what it marks, so code follows the page's theme.
 */

export const CODE_THEMES = { dark: "github-dark-default", light: "github-light-default" } as const;

/** The site's colour for what each theme colour marks. The two themes mark the same things. */
const CODE_ROLES: Record<string, readonly string[]> = {
  // Keywords; invalid and deleted text.
  "--accent-orange": ["shd-ff7b72", "shd-ffa198", "shl-cf222e", "shl-82071e"],
  // Strings and constants.
  "--data-2": ["shd-a5d6ff", "shd-79c0ff", "shl-0a3069", "shl-0550ae"],
  // Comments, brackets, ignored lines.
  "--faint-foreground": ["shd-8b949e", "shd-161b22", "shl-6e7781", "shl-57606a", "shl-eaeef2"],
  // Functions, variables, tags and plain text.
  "--foreground": [
    "shd-7ee787",
    "shd-d2a8ff",
    "shd-e6edf3",
    "shd-f0f6fc",
    "shd-ffa657",
    "shl-116329",
    "shl-1f2328",
    "shl-8250df",
    "shl-953800",
    "shl-f6f8fa",
  ],
};

/** What a code block may name; anything else is shown as plain, escaped text. */
const LANGUAGES = [
  () => import("shiki/langs/typescript.mjs"),
  () => import("shiki/langs/tsx.mjs"),
  () => import("shiki/langs/javascript.mjs"),
  () => import("shiki/langs/jsx.mjs"),
  () => import("shiki/langs/json.mjs"),
  () => import("shiki/langs/shellscript.mjs"),
  () => import("shiki/langs/python.mjs"),
  () => import("shiki/langs/html.mjs"),
  () => import("shiki/langs/css.mjs"),
  () => import("shiki/langs/scss.mjs"),
  () => import("shiki/langs/sql.mjs"),
  () => import("shiki/langs/yaml.mjs"),
  () => import("shiki/langs/toml.mjs"),
  () => import("shiki/langs/docker.mjs"),
  () => import("shiki/langs/go.mjs"),
  () => import("shiki/langs/rust.mjs"),
  () => import("shiki/langs/java.mjs"),
  () => import("shiki/langs/diff.mjs"),
  () => import("shiki/langs/markdown.mjs"),
  () => import("shiki/langs/graphql.mjs"),
  () => import("shiki/langs/xml.mjs"),
];

let highlighter: Promise<HighlighterCore> | undefined;

/** Created on the first code block, then kept; the JS regex engine needs no WASM. */
function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ]);
    return createHighlighterCore({
      themes: [
        import("shiki/themes/github-dark-default.mjs"),
        import("shiki/themes/github-light-default.mjs"),
      ],
      langs: LANGUAGES.map((load) => load()),
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

function colorClass(prefix: "shd" | "shl", color: string | undefined): string | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(color ?? "")?.[1];
  return hex ? `${prefix}-${hex.toLowerCase()}` : null;
}

function tokenHtml(token: ThemedToken): string {
  const style = (token.htmlStyle ?? {}) as Record<string, string>;
  const classes = new Set<string>();
  const dark = colorClass("shd", style["--shiki-dark"]);
  const light = colorClass("shl", style["--shiki-light"]);
  if (dark) classes.add(dark);
  if (light) classes.add(light);
  for (const [key, value] of Object.entries(style)) {
    if (key.endsWith("font-style") && value === "italic") classes.add("sh-i");
    if (key.endsWith("font-weight") && value === "bold") classes.add("sh-b");
    if (key.endsWith("text-decoration") && value === "underline") classes.add("sh-u");
  }
  const content = escapeHtml(token.content);
  return classes.size > 0 ? `<span class="${[...classes].join(" ")}">${content}</span>` : content;
}

/**
 * The inner HTML of a `<code>` element: highlighted lines when the language
 * is known, the escaped source otherwise. Deterministic, so a republish of
 * unchanged content produces the same checksum.
 */
export async function highlightCode(code: string, lang: string | null): Promise<string> {
  const source = code.replace(/\n$/, "");
  if (!lang) return escapeHtml(source);

  const hl = await getHighlighter();
  if (!hl.getLoadedLanguages().includes(lang)) return escapeHtml(source);

  const { tokens } = hl.codeToTokens(source, { lang, themes: CODE_THEMES, defaultColor: false });
  return tokens
    .map((line) => `<span class="line">${line.map(tokenHtml).join("")}</span>`)
    .join("\n");
}

/** Every language name (and alias) a code block may use. */
export async function supportedLanguages(): Promise<string[]> {
  return (await getHighlighter()).getLoadedLanguages().sort((a, b) => a.localeCompare(b));
}

function themeColors(theme: ReturnType<HighlighterCore["getTheme"]>): string[] {
  const colors = new Set<string>();
  if (theme.fg) colors.add(theme.fg.toLowerCase());
  for (const setting of theme.settings ?? []) {
    const fg = setting.settings?.foreground;
    if (typeof fg === "string") colors.add(fg.toLowerCase());
  }
  return [...colors].sort((a, b) => a.localeCompare(b));
}

/**
 * The stylesheet for the classes above: each role's classes in the site's colour, and the
 * three styles a theme can add. A theme colour with no role stops it, so nothing ships uncoloured.
 */
export async function codeStylesheet(): Promise<string> {
  const hl = await getHighlighter();
  const mapped = new Set(Object.values(CODE_ROLES).flat());
  for (const [mode, name] of Object.entries(CODE_THEMES) as ["dark" | "light", string][]) {
    for (const color of themeColors(hl.getTheme(name))) {
      const cls = colorClass(mode === "dark" ? "shd" : "shl", color);
      if (cls && !mapped.has(cls)) throw new Error(`[code-css] no role for ${cls} (${name})`);
    }
  }

  const rules = Object.entries(CODE_ROLES).map(
    ([token, classes]) =>
      `${classes.map((cls) => `.code-block .${cls}`).join(",\n")} {\n  color: var(${token});\n}`,
  );
  rules.push(
    ".code-block .sh-i {\n  font-style: italic;\n}",
    ".code-block .sh-b {\n  font-weight: 600;\n}",
    ".code-block .sh-u {\n  text-decoration: underline;\n}",
  );

  return `/* Generated by \`pnpm -C server content:code-css\` from ${CODE_THEMES.dark} / ${CODE_THEMES.light}. Do not edit. */\n${rules.join("\n")}\n`;
}
