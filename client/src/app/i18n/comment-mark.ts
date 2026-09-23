/**
 * The site writes labels like code comments: `// skills`. The slashes are
 * decoration — a screen reader would read "slash slash skills" — so templates
 * render them `aria-hidden` and the rest as text.
 */
export interface Marked {
  /** Whether the text started with `//`. */
  marked: boolean;
  text: string;
}

export function splitCommentMark(value: string): Marked {
  const match = /^\s*\/\/\s*/.exec(value);
  return match
    ? { marked: true, text: value.slice(match[0].length) }
    : { marked: false, text: value };
}
