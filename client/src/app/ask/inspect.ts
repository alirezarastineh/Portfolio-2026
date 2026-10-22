import type { Locale } from "../content/locale";
import { fmt } from "../i18n/interpolate";
import { duration } from "../visuals/trace";
import type { AskCopy } from "./ask-copy";
import type { OutLine } from "./commands";
import { counted } from "./receipt";

/**
 * `inspect` (visitor plan V12): what the log keeps of one of the visitor's
 * answers (`POST /v1/ask/inspect`, `server/src/ask/inspect.ts`), as a shell
 * timeline they can copy. The response is read field by field, by name: a
 * field this file does not name is never printed, whatever the server sends.
 */

type Raw = Record<string, unknown>;

const obj = (value: unknown): Raw =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * The tool's step as the live answer showed it (`search "…"`, `cat …`); its
 * name where it has no input to show (withheld, or one that is never shown).
 */
function toolLabel(name: string, input: string, labels: AskCopy["tool"]): string {
  switch (name) {
    case "list_projects":
      return fmt(labels.list_projects, { q: input }).trim();
    case "get_resume":
      return labels.get_resume;
    case "search_portfolio":
      return input ? fmt(labels.search_portfolio, { q: input }) : name;
    case "get_document":
      return input ? fmt(labels.get_document, { id: input }) : name;
    case "navigate":
      return input ? fmt(labels.navigate, { to: input }) : name;
    default:
      return name;
  }
}

function when(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function stepLines(raw: unknown, n: number, copy: AskCopy, locale: Locale): OutLine[] {
  const t = copy.inspect;
  const step = obj(raw);
  const count = (value: unknown) =>
    (num(value) ?? 0).toLocaleString(locale === "de" ? "de-DE" : "en-GB");
  const time = (value: unknown) => {
    const ms = num(value);
    return ms === null ? "–" : duration(ms, locale);
  };
  const model = str(step["model"]);
  const tokens = obj(step["tokens"]);
  const lines: OutLine[] = [
    {
      label: fmt(t.labels.step, { n }),
      text: model
        ? fmt(t.model, {
            model,
            ttft: time(step["ttftMs"]),
            input: count(tokens["input"]),
            cached: count(tokens["cached"]),
            output: count(tokens["output"]),
          })
        : t.noModel,
    },
  ];
  for (const passed of arr(step["passedOver"]).map(obj)) {
    lines.push({
      label: " ",
      text: fmt(t.passedOver, {
        model: str(passed["model"]),
        outcome: str(passed["outcome"]),
        ms: time(passed["ms"]),
      }),
      tone: "dim",
    });
  }
  for (const tool of arr(step["tools"]).map(obj)) {
    lines.push({
      label: " ",
      text: fmt(t.tool, {
        label: toolLabel(str(tool["name"]), str(tool["input"]), copy.tool),
        outcome: str(tool["outcome"]),
        chars: count(tool["chars"]),
      }),
      tone: "dim",
    });
  }
  return lines;
}

/** The head, the route and its reason, and a move to the thorough model. */
function routeLines(view: Raw, copy: AskCopy, locale: Locale): OutLine[] {
  const t = copy.inspect;
  const reason = str(view["reason"]);
  const lines: OutLine[] = [
    {
      text: fmt(t.head, {
        id: str(view["id"]),
        at: when(str(view["at"]), locale),
        prompt: str(view["prompt"]),
      }),
      tone: "dim",
    },
    {
      label: t.labels.route,
      text: [str(view["route"]), reason ? fmt(t.reason, { reason }) : ""]
        .filter(Boolean)
        .join(" · "),
    },
  ];
  const escalation = obj(view["escalation"]);
  const why = str(escalation["reason"]);
  if (why) {
    const words = Object.hasOwn(copy.receipt.escalation, why)
      ? copy.receipt.escalation[why as keyof AskCopy["receipt"]["escalation"]]
      : why;
    lines.push({
      label: " ",
      text: fmt(t.moved, { step: num(escalation["step"]) ?? "?", why: words }),
    });
  }
  return lines;
}

/** What the question came with: a careful topic, the page, what was pointed at, the level. */
function contextLines(view: Raw, t: AskCopy["inspect"]): OutLine[] {
  const page = obj(view["page"]);
  const focus = obj(view["focus"]);
  const promoted = page["promoted"] === true ? ` · ${t.promoted}` : "";
  const found = focus["verified"] === true ? t.found : t.notFound;
  return [
    { label: t.labels.careful, text: str(view["careful"]) },
    { label: t.labels.page, text: str(page["id"]) && `${str(page["id"])}${promoted}` },
    { label: t.labels.focus, text: str(focus["kind"]) && `${str(focus["kind"])} · ${found}` },
    { label: t.labels.level, text: str(view["level"]) },
  ].filter((line) => line.text);
}

/** What came of it: the citations, the guard, the checks, a repair, the time. */
function outcomeLines(view: Raw, copy: AskCopy, locale: Locale): OutLine[] {
  const t = copy.inspect;
  const citations = obj(view["citations"]);
  const kept = arr(citations["kept"]).map(str).filter(Boolean);
  const removed = num(citations["removed"]) ?? 0;
  const guard = Object.entries(obj(view["guard"])).filter(([, count]) => num(count));
  const flags = arr(view["flags"]).map(str).filter(Boolean);
  const repair = obj(view["repair"]);
  const time = (value: unknown) => {
    const ms = num(value);
    return ms === null ? "–" : duration(ms, locale);
  };
  const lines: OutLine[] = [
    {
      label: t.labels.cited,
      text: [
        kept.length ? kept.join(", ") : copy.receipt.sources.none,
        removed > 0 ? counted(removed, copy.receipt.removed) : "",
      ]
        .filter(Boolean)
        .join(" · "),
    },
    {
      label: t.labels.guard,
      text: guard.length ? guard.map(([kind, n]) => `${kind} ×${num(n)}`).join(", ") : t.nothing,
    },
    { label: t.labels.checks, text: flags.length ? flags.join(", ") : t.none },
  ];
  if (str(repair["reason"])) {
    const words = repair["by"] === "fixed-line" ? t.byLine : t.byModel;
    lines.push({ label: t.labels.repair, text: fmt(words, { reason: str(repair["reason"]) }) });
  }
  lines.push({
    label: t.labels.time,
    text: fmt(t.time, { total: time(view["totalMs"]), ttft: time(view["ttftMs"]) }),
  });
  return lines;
}

/** The timeline's lines for one answer's projection. */
export function inspectLines(raw: unknown, copy: AskCopy, locale: Locale): OutLine[] {
  const view = obj(raw);
  return [
    ...routeLines(view, copy, locale),
    ...contextLines(view, copy.inspect),
    ...arr(view["steps"]).flatMap((step, i) => stepLines(step, i + 1, copy, locale)),
    ...outcomeLines(view, copy, locale),
  ];
}

/** The lines as text to copy: each label in its column, as the terminal shows them. */
export function linesText(input: string, prompt: string, lines: readonly OutLine[]): string {
  return [
    `${prompt} ${input}`,
    ...lines.map((line) => (line.label ? `${line.label.padEnd(16)}${line.text}` : line.text)),
  ].join("\n");
}

/**
 * Asks for an answer's projection. A 404 is tried again a few times: an
 * answer is logged once its stream has ended, which can be a moment after the
 * browser shows it. `missing` when it never comes (pruned, deleted, unknown).
 */
export async function fetchInspect(
  post: () => Promise<Response>,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<{ ok: true; view: unknown } | { ok: false; missing: boolean }> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1000;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const failed = { ok: false as const, missing: false };

  async function step(attempt: number): Promise<Awaited<ReturnType<typeof fetchInspect>>> {
    let res: Response;
    try {
      res = await post();
    } catch {
      return failed;
    }
    if (res.ok)
      return res.json().then(
        (view: unknown) => ({ ok: true as const, view }),
        () => failed,
      );
    if (res.status !== 404) return failed;
    if (attempt >= attempts) return { ok: false, missing: true };
    await sleep(delayMs);
    return step(attempt + 1);
  }

  return step(1);
}
