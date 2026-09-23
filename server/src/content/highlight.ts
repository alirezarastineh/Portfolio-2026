import type { HighlighterCore, ThemedToken } from "shiki/core";

import { escapeHtml } from "./sanitize.js";

/**
 * Syntax highlighting at publish time, so visitors download no highlighter.
 *
 * Tokens become classes (`shd-ff7b72 shl-cf222e`), not inline styles: Angular's
 * sanitizer strips `style` from `[innerHTML]`, and a stylesheet generated from
 * the two themes (`pnpm content:code-css`) maps every class to its colour —
 * the dark palette now, the light one ready for the light theme.
 */

export const CODE_THEMES = { dark: "github-dark-default", light: "github-light-default" } as const;

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

function themeRules(mode: "dark" | "light", name: string, hl: HighlighterCore): string[] {
  const theme = hl.getTheme(name);
  const prefix = mode === "dark" ? "shd" : "shl";
  const scope = mode === "dark" ? ".code-block" : ':root[data-theme="light"] .code-block';
  const rules = [`${scope} {\n  --code-fg: ${theme.fg};\n  --code-bg: ${theme.bg};\n}`];

  for (const color of themeColors(theme)) {
    const cls = colorClass(prefix, color);
    if (cls) rules.push(`${scope} .${cls} {\n  color: ${color};\n}`);
  }
  return rules;
}

/**
 * The stylesheet for the classes above: each theme's foreground colours, plus
 * the block's own colours as custom properties.
 */
export async function codeStylesheet(): Promise<string> {
  const hl = await getHighlighter();
  const rules: string[] = [];

  for (const [mode, name] of Object.entries(CODE_THEMES) as ["dark" | "light", string][]) {
    rules.push(...themeRules(mode, name, hl));
  }
  rules.push(
    ".code-block .sh-i {\n  font-style: italic;\n}",
    ".code-block .sh-b {\n  font-weight: 600;\n}",
    ".code-block .sh-u {\n  text-decoration: underline;\n}",
  );

  return `/* Generated by \`pnpm -C server content:code-css\` from ${CODE_THEMES.dark} / ${CODE_THEMES.light}. Do not edit. */\n${rules.join("\n")}\n`;
}
