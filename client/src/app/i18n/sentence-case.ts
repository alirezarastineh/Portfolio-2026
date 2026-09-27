/**
 * A single all-caps word as a heading would print it: `PROBLEM` → `Problem`.
 * The CMS writes some labels in capitals because they began as eyebrows
 * (which are uppercased in CSS anyway); set as sans headings they would shout,
 * and screen readers may spell them out. Anything else — mixed case, several
 * words, a short acronym such as `AI` — is returned as written.
 */
export function sentenceCase(label: string, locale: string): string {
  const word = label.trim();
  if (!/^\p{Lu}{4,}$/u.test(word)) return label;
  const lower = word.toLocaleLowerCase(locale);
  return lower.charAt(0).toLocaleUpperCase(locale) + lower.slice(1);
}
