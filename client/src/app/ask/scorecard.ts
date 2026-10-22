import type { Locale } from "../content/locale";
import { formatDay } from "../content/period";
import { fmt } from "../i18n/interpolate";
import { duration } from "../visuals/trace";
import type { AskCopy } from "./ask-copy";
import type { OutLine } from "./commands";

/**
 * `evals` (visitor plan V13): the assistant's public scorecard
 * (`GET /v1/ask/scorecard`, `server/src/ask/scorecard.ts`) as shell output:
 * the eval run recorded for the deployed prompt, 30 days of live checks, and
 * the nightly judge's sample while it runs. Read field by field, by name: a
 * field this file does not name is never printed.
 */

type Raw = Record<string, unknown>;

const obj = (value: unknown): Raw =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function percent(share: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "de" ? "de-DE" : "en-GB", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(share);
}

/** A share's words, or "not enough answers yet" where the server sent none. */
function shareText(raw: unknown, words: string, locale: Locale, t: AskCopy["evals"]): string {
  const share = num(obj(raw)["share"]);
  const n = num(obj(raw)["n"]);
  return share === null || n === null
    ? t.notEnough
    : fmt(words, { rate: percent(share, locale), n });
}

function recordedLines(raw: unknown, t: AskCopy["evals"], locale: Locale): OutLine[] {
  const run = obj(raw);
  if (run["measured"] !== true) {
    const reason = str(run["reason"]);
    return [
      {
        label: t.labels.recorded,
        text: reason ? fmt(t.notMeasured, { reason }) : t.notMeasuredBare,
      },
    ];
  }
  const at = str(run["at"]);
  const categories = arr(run["categories"])
    .map(obj)
    .map((c) => `${str(c["name"])} ${num(c["passed"]) ?? 0}/${num(c["completed"]) ?? 0}`);
  return [
    {
      label: t.labels.recorded,
      text: fmt(t.recorded, {
        date: at ? formatDay(at, locale) : "–",
        passed: num(run["passed"]) ?? 0,
        completed: num(run["completed"]) ?? 0,
        rate: percent(num(run["passRate"]) ?? 0, locale),
        judge: str(run["judge"]) || "–",
      }),
    },
    ...(categories.length
      ? [{ label: " ", text: categories.join(" · "), tone: "dim" as const }]
      : []),
  ];
}

function liveLines(raw: unknown, t: AskCopy["evals"], locale: Locale): OutLine[] {
  const live = obj(raw);
  const answers = num(live["answers"]) ?? 0;
  const unanswered = obj(live["unanswered"]);
  const share = num(unanswered["share"]);
  const asked = num(unanswered["n"]);
  const head: OutLine = {
    label: fmt(t.labels.live, { days: num(live["days"]) ?? 30 }),
    text: [
      fmt(t.answers, { n: answers }),
      share === null || asked === null
        ? ""
        : fmt(t.unanswered, { n: Math.round(share * asked), rate: percent(share, locale) }),
    ]
      .filter(Boolean)
      .join(" · "),
  };
  if (answers < (num(live["minimum"]) ?? 20)) {
    return [head, { label: " ", text: t.notEnough, tone: "dim" }];
  }
  const first = obj(live["firstWordMs"]);
  const median = num(first["median"]);
  const refusals = Object.entries(obj(live["refusals"])).filter(([, count]) => num(count));
  return [
    head,
    {
      label: t.labels.citations,
      text: shareText(live["citationsVerified"], t.citations, locale, t),
    },
    { label: t.labels.repaired, text: shareText(live["repaired"], t.repaired, locale, t) },
    { label: t.labels.figures, text: shareText(live["figuresFlagged"], t.figures, locale, t) },
    {
      label: t.labels.firstWord,
      text:
        median === null
          ? t.notEnough
          : fmt(t.firstWord, { time: duration(median, locale), n: num(first["n"]) ?? 0 }),
    },
    {
      label: t.labels.refusals,
      text: refusals.length
        ? refusals.map(([kind, count]) => `${kind} ${num(count)}`).join(" · ")
        : t.none,
    },
  ];
}

/** The scorecard's lines, ending with the line that asks for the system card. */
export function scorecardLines(raw: unknown, copy: AskCopy, locale: Locale): OutLine[] {
  const t = copy.evals;
  const card = obj(raw);
  const lines: OutLine[] = [
    { text: fmt(t.head, { prompt: str(card["prompt"]) }), tone: "dim" },
    ...recordedLines(card["recorded"], t, locale),
    ...liveLines(card["live"], t, locale),
  ];
  // While the nightly judge runs: its sample's median faithfulness.
  if (card["judge"] !== null && card["judge"] !== undefined) {
    const judge = obj(card["judge"]);
    const median = num(judge["median"]);
    lines.push({
      label: t.labels.judge,
      text:
        median === null
          ? t.notEnough
          : fmt(t.judge, { rate: percent(median, locale), n: num(judge["n"]) ?? 0 }),
    });
  }
  lines.push({ text: t.systemCard, ask: t.systemCardQuestion });
  return lines;
}

/** The scorecard, or why not: unpublished (404), rate-limited (429), or a failure. */
export async function fetchScorecard(
  get: () => Promise<Response>,
): Promise<
  | { ok: true; card: unknown }
  | { ok: false; reason: "off" | "failed" }
  | { ok: false; reason: "limited"; retryAfter: number }
> {
  let res: Response;
  try {
    res = await get();
  } catch {
    return { ok: false, reason: "failed" };
  }
  if (res.status === 404) return { ok: false, reason: "off" };
  if (res.status === 429) {
    const body: unknown = await res.json().catch(() => ({}));
    return { ok: false, reason: "limited", retryAfter: num(obj(body)["retryAfter"]) ?? 60 };
  }
  if (!res.ok) return { ok: false, reason: "failed" };
  return res.json().then(
    (card: unknown) => ({ ok: true as const, card }),
    () => ({ ok: false as const, reason: "failed" as const }),
  );
}
