import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai";

/**
 * The output layer of the Guardrail Sandwich (plan phase 15). The input is
 * fenced (prompt.ts) and the tools only read (tools.ts); this checks what the
 * model writes before a visitor sees it, and removes:
 *   - the canary: a confidential line in the instructions that no answer has
 *     a reason to contain, so any answer that does is repeating them, even
 *     translated or paraphrased around it;
 *   - any run of 12 words copied from the instructions, unless the corpus or
 *     a line the assistant may say (its scope) has it too;
 *   - configured secrets and internal URLs, and key-shaped strings.
 * It holds text back only while it could still become one of these: a
 * secret's beginning until it is decided, a word until it ends, a matched
 * copy until it stops; the start of a run not yet 12 words long at most 96
 * characters (a longer one may show its first words before the rest is
 * removed, never 12 of them). A removal or a word is never cut in two.
 * Copied instructions or a key shape that the visitor wrote themselves are
 * removed when they come back, but are no leak; the canary and the deploy's
 * secrets always are (the canary is public, and is what catches a translated
 * leak). What it cannot see: text the model encodes (base64, a cipher), or a
 * leak through a tool's input (checks.ts flags those after the fact);
 * filtering text cannot undo them, which the book calls an open problem.
 */

export type LeakKind = "canary" | "instructions" | "secret";

/** Copied words that count as the instructions, and how much ordinary text may be held. */
export const SHINGLE_WORDS = 12;
export const HOLD_BACK = 96;
/** What stands where something was removed. */
export const REDACTED = "[…]";

interface Literal {
  text: string;
  kind: LeakKind;
  /** The canary is matched whatever its case; secrets exactly. */
  anyCase: boolean;
}

export interface LeakGuard {
  literals: Literal[];
  /** Normalised word shingles of the instructions that nothing quotable also contains. */
  shingles: ReadonlySet<string>;
  /** Every leading part of a shingle, for holding back a run that may become one. */
  prefixes: ReadonlySet<string>;
}

/** Key-shaped strings (Gemini, OpenRouter): a fixed prefix, then a body of known length. */
const KEYS = [
  { whole: /AIza[0-9A-Za-z_-]{35}/g, prefix: "AIza", body: /^[0-9A-Za-z_-]*$/, length: 35 },
  { whole: /sk-or-v1-[0-9a-f]{64}/g, prefix: "sk-or-v1-", body: /^[0-9a-f]*$/, length: 64 },
];

/** The same shapes for a one-off test (checks.ts). */
export const KEY_SHAPES: readonly RegExp[] = KEYS.map((key) => new RegExp(key.whole.source));

/** A word as the shingles compare it, and where its letters are (punctuation around it excluded). */
interface Token {
  word: string;
  start: number;
  end: number;
  /** Where the token starts and ends, punctuation included: "full-" may yet become "full-stack". */
  rawStart: number;
  rawEnd: number;
}

const WORDISH = /[\p{L}\p{N}]/u;

function tokens(text: string): Token[] {
  const found: Token[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const raw = match[0];
    let lead = 0;
    while (lead < raw.length && !WORDISH.test(raw[lead]!)) lead++;
    let tail = raw.length;
    while (tail > lead && !WORDISH.test(raw[tail - 1]!)) tail--;
    if (tail === lead) continue;
    const start = match.index + lead;
    found.push({
      word: raw.slice(lead, tail).toLowerCase(),
      start,
      end: start + tail - lead,
      rawStart: match.index,
      rawEnd: match.index + raw.length,
    });
  }
  return found;
}

/** Words as the shingles compare them: lower-case, without punctuation at either end. */
export function words(text: string): string[] {
  return tokens(text).map((t) => t.word);
}

function shinglesOf(text: string): Set<string> {
  const all = words(text);
  const set = new Set<string>();
  for (let i = 0; i + SHINGLE_WORDS <= all.length; i++) {
    set.add(all.slice(i, i + SHINGLE_WORDS).join(" "));
  }
  return set;
}

export function buildLeakGuard(options: {
  instructions: string;
  /** Text the assistant may quote: a shingle found here is not a leak. */
  corpusTexts: readonly string[];
  /** Lines of the instructions the assistant may say in its own words or theirs (its scope). */
  quotable?: readonly string[];
  canary: string;
  /** Exact values never to show: keys, passwords, internal URLs (shorter than 8 are ignored). */
  secrets: readonly string[];
}): LeakGuard {
  const exempt = new Set<string>();
  for (const text of [...options.corpusTexts, ...(options.quotable ?? [])]) {
    for (const s of shinglesOf(text)) exempt.add(s);
  }
  const shingles = new Set([...shinglesOf(options.instructions)].filter((s) => !exempt.has(s)));
  const prefixes = new Set<string>();
  for (const shingle of shingles) {
    const parts = shingle.split(" ");
    for (let n = 1; n < SHINGLE_WORDS; n++) prefixes.add(parts.slice(0, n).join(" "));
  }
  const literals: Literal[] = [{ text: options.canary, kind: "canary", anyCase: true }];
  for (const text of new Set(options.secrets)) {
    if (text.length >= 8) literals.push({ text, kind: "secret", anyCase: false });
  }
  literals.sort((a, b) => b.text.length - a.text.length);
  return { literals, shingles, prefixes };
}

/** The environment variables naming internal places: their URLs, and any password in them. */
const INTERNAL_URLS = ["DATABASE_URL", "MIGRATION_DATABASE_URL", "CONTENT_INVALIDATE_URL"];

/** What the deploy holds that no answer may show: its model keys, internal URLs and passwords. */
export function deploySecrets(
  keys: { gemini: { apiKey: string | null }; openrouter: { apiKey: string | null } },
  env: Partial<Record<string, string>> = process.env,
): string[] {
  const secrets = [keys.gemini.apiKey, keys.openrouter.apiKey];
  for (const name of INTERNAL_URLS) {
    const url = env[name]?.trim();
    if (!url) continue;
    secrets.push(url);
    try {
      const { password } = new URL(url);
      if (password) secrets.push(decodeURIComponent(password));
    } catch {
      // Not a URL: guarded as it is.
    }
  }
  return secrets.filter((s): s is string => !!s);
}

/**
 * The visitor's own words: copied instructions or a key shape the model gives
 * back from them are still removed, but no leak (a pasted paragraph of the
 * public prompt must not raise an alert). The canary is not covered: pasting
 * it must not switch off what catches a translated leak.
 */
export interface Echo {
  lower: string;
  shingles: ReadonlySet<string>;
}

export function echoOf(text: string): Echo {
  return { lower: text.toLowerCase(), shingles: shinglesOf(text) };
}

const NO_ECHO: Echo = { lower: "", shingles: new Set() };

/** One text part's progress: the text held back, as written, and the last words shown before it. */
export interface ScanState {
  pending: string;
  /** As written, removed ones included: a copy that goes on is still recognised. */
  history: string[];
}

export const newScanState = (): ScanState => ({ pending: "", history: [] });

interface Span {
  start: number;
  end: number;
  kind: LeakKind;
  /** Given back from the visitor's own words: removed, not reported. */
  echo: boolean;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/**
 * Where the literals and keys are. The canary and the deploy's secrets are a
 * leak whoever wrote them first; only a key shape may be the visitor's echo.
 */
function exactSpans(guard: LeakGuard, text: string, echo: Echo): Span[] {
  const spans: Span[] = [];
  for (const literal of guard.literals) {
    const pattern = new RegExp(escapeRegExp(literal.text), literal.anyCase ? "gi" : "g");
    for (const m of text.matchAll(pattern)) {
      spans.push({ start: m.index, end: m.index + m[0].length, kind: literal.kind, echo: false });
    }
  }
  for (const key of KEYS) {
    for (const m of text.matchAll(key.whole)) {
      const echoed = echo.lower.includes(m[0].toLowerCase());
      spans.push({ start: m.index, end: m.index + m[0].length, kind: "secret", echo: echoed });
    }
  }
  return spans;
}

/** Contiguous marked token ranges converted to instruction leak spans. */
function spansFromMarks(found: Token[], marked: boolean[], reported: boolean[]): Span[] {
  const spans: Span[] = [];
  let k = 0;
  while (k < found.length) {
    if (!marked[k]) {
      k++;
      continue;
    }
    let last = k;
    while (last + 1 < found.length && marked[last + 1]) last++;
    spans.push({
      start: found[k]!.start,
      end: found[last]!.end,
      kind: "instructions",
      echo: !reported.slice(k, last + 1).some(Boolean),
    });
    k = last + 1;
  }
  return spans;
}

/** Where words copied from the instructions are, counting the words shown before. */
function copiedSpans(
  guard: LeakGuard,
  found: Token[],
  history: readonly string[],
  echo: Echo,
): Span[] {
  const all = [...history, ...found.map((t) => t.word)];
  const marked = Array.from({ length: found.length }, () => false);
  /** Covered by a copied run the visitor did not write: a leak. */
  const reported = Array.from({ length: found.length }, () => false);
  for (let j = 0; j < found.length; j++) {
    const end = history.length + j;
    if (end + 1 < SHINGLE_WORDS) continue;
    const start = end + 1 - SHINGLE_WORDS;
    const run = all.slice(start, end + 1).join(" ");
    if (!guard.shingles.has(run)) continue;
    const own = !echo.shingles.has(run);
    for (let k = Math.max(0, start - history.length); k <= j; k++) {
      marked[k] = true;
      if (own) reported[k] = true;
    }
  }
  return spansFromMarks(found, marked, reported);
}

/** Overlapping spans joined, in order: what is replaced. */
function merged(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const span of sorted) {
    const last = out.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else out.push({ ...span });
  }
  return out;
}

/**
 * The start of a tail of `text` that is the beginning of `needle`, or the end
 * of the text. Any case compares the tail itself, never a lower-cased copy of
 * the whole text, whose length can differ ("İ" lower-cases to two characters).
 */
function tailOf(text: string, needle: string, anyCase = false): number {
  for (let n = Math.min(needle.length - 1, text.length); n > 0; n--) {
    const tail = text.slice(text.length - n);
    const head = needle.slice(0, n);
    if (anyCase ? tail.toLowerCase() === head.toLowerCase() : tail === head) {
      return text.length - n;
    }
  }
  return text.length;
}

/** Where a literal or a key may still be completing at the end of `text`: held, whatever its length. */
function exactTail(guard: LeakGuard, text: string): number {
  let from = text.length;
  for (const literal of guard.literals) {
    from = Math.min(from, tailOf(text, literal.text, literal.anyCase));
  }
  for (const key of KEYS) {
    from = Math.min(from, tailOf(text, key.prefix));
    const at = text.lastIndexOf(key.prefix);
    if (at < 0) continue;
    const body = text.slice(at + key.prefix.length);
    if (body.length < key.length && key.body.test(body)) from = Math.min(from, at);
  }
  return from;
}

/** Where the latest words, those shown included, may be starting a copied run. */
function copyTail(
  guard: LeakGuard,
  complete: Token[],
  history: readonly string[],
  end: number,
): number {
  const all = [...history, ...complete.map((t) => t.word)];
  for (let s = Math.max(0, all.length - (SHINGLE_WORDS - 1)); s < all.length; s++) {
    if (!guard.prefixes.has(all.slice(s).join(" "))) continue;
    const first = Math.max(0, s - history.length);
    return first < complete.length ? complete[first]!.rawStart : end;
  }
  return end;
}

/**
 * Where the text shown now must end. A secret's beginning is always held; a
 * copied run's beginning and an unfinished word too, though no further back
 * than 96 characters for the run. Then, never inside a word or a removal:
 * the cut only ever moves back, so nothing is shown that might still match.
 */
function cutAt(
  guard: LeakGuard,
  raw: string,
  found: Token[],
  spans: Span[],
  history: readonly string[],
): number {
  const open = found.length > 0 && found.at(-1)!.rawEnd === raw.length;
  const complete = open ? found.slice(0, -1) : found;
  const soft = Math.min(
    open ? found.at(-1)!.rawStart : raw.length,
    copyTail(guard, complete, history, raw.length),
  );
  let cut = Math.min(exactTail(guard, raw), Math.max(soft, raw.length - HOLD_BACK, 0));
  for (let moved = true; moved;) {
    moved = false;
    const word = found.find((t) => t.rawStart < cut && cut < t.rawEnd);
    if (word) {
      cut = word.rawStart;
      moved = true;
    }
    const span = spans.find((s) => s.start < cut && cut < s.end);
    if (span) {
      cut = span.start;
      moved = true;
    }
  }
  return cut;
}

/**
 * The next piece of a text part: what may be shown now, with anything found
 * removed, each kind removed added to `hits` (copied instructions and key
 * shapes the visitor wrote themselves excepted). `final` (the part ended)
 * shows the rest.
 */
export function scanChunk(
  guard: LeakGuard,
  state: ScanState,
  text: string,
  final: boolean,
  hits: Set<LeakKind>,
  echo: Echo = NO_ECHO,
): string {
  const raw = state.pending + text;
  const found = tokens(raw);
  const spans = [
    ...exactSpans(guard, raw, echo),
    ...(guard.shingles.size ? copiedSpans(guard, found, state.history, echo) : []),
  ];
  const removals = merged(spans);
  const cut = final ? raw.length : cutAt(guard, raw, found, removals, state.history);

  // Counted once shown removed: a match still held back may yet come to nothing.
  for (const span of spans) if (span.end <= cut && !span.echo) hits.add(span.kind);
  let ready = "";
  let at = 0;
  for (const span of removals) {
    if (span.end > cut) break;
    ready += raw.slice(at, span.start) + REDACTED;
    at = span.end;
  }
  ready += raw.slice(at, cut);
  state.pending = raw.slice(cut);
  state.history = [...state.history, ...words(raw.slice(0, cut))].slice(-(SHINGLE_WORDS - 1));
  return ready;
}

/** The guard over a stream's text parts: after the citations are checked, before the words are paced. */
export function leakGuardTransform<TOOLS extends ToolSet>(
  guard: LeakGuard,
  hits: Set<LeakKind>,
  echo: Echo = NO_ECHO,
): StreamTextTransform<TOOLS> {
  return () => {
    const states = new Map<string, ScanState>();
    const state = (id: string) => {
      let found = states.get(id);
      if (!found) {
        found = newScanState();
        states.set(id, found);
      }
      return found;
    };
    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, out) {
        if (part.type === "text-delta") {
          const ready = scanChunk(guard, state(part.id), part.text, false, hits, echo);
          if (ready) out.enqueue({ ...part, text: ready });
          return;
        }
        if (part.type === "text-end") {
          const rest = scanChunk(guard, state(part.id), "", true, hits, echo);
          states.delete(part.id);
          if (rest) out.enqueue({ type: "text-delta", id: part.id, text: rest });
        }
        out.enqueue(part);
      },
    });
  };
}
