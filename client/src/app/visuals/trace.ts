import type { AnswerTrace } from "../ask/ask-trace.service";
import type { AskEntryCopy } from "../ask/ask-entry-copy";
import type { Locale } from "../content/locale";
import { fmt } from "../i18n/interpolate";

export type TraceStep = "query" | "route" | "retrieve" | "generate" | "cite" | "answer";

/** One step of the pipeline. `bar` places its time on the answer's timeline, in percent. */
export interface TraceRow {
  step: TraceStep;
  detail: string;
  time: string;
  bar: { left: number; width: number } | null;
}

export interface TraceView {
  /** 0 for the example; each real answer counts up, which replays the panel. */
  id: number;
  live: boolean;
  caption: string;
  summary: string;
  rows: TraceRow[];
}

/** The example's timeline, in ms: illustrative, and labelled as an example. */
const EXAMPLE = {
  route: [0, 12],
  retrieve: [12, 190],
  generate: [190, 1400],
  cite: [1400, 1409],
  total: 1420,
  cached: 86,
} as const;

export function duration(ms: number, locale: Locale): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = (ms / 1000).toLocaleString(locale === "de" ? "de-DE" : "en-GB", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${seconds} s`;
}

function bar(from: number, to: number, total: number): TraceRow["bar"] {
  if (total <= 0 || to < from) return null;
  return { left: (from / total) * 100, width: ((to - from) / total) * 100 };
}

/** The panel's rows: the example until the visitor has asked something, then their answer. */
export function traceView(
  copy: AskEntryCopy,
  locale: Locale,
  trace: (AnswerTrace & { id: number }) | null,
): TraceView {
  const t = copy.trace;
  if (!trace) {
    const span = (step: keyof typeof EXAMPLE & TraceStep) => {
      const [from, to] = EXAMPLE[step];
      return { time: duration(to - from, locale), bar: bar(from, to, EXAMPLE.total) };
    };
    return {
      id: 0,
      live: false,
      caption: t.example,
      summary: t.summary,
      rows: [
        { step: "query", detail: copy.starters[0] ?? "", time: "", bar: null },
        { step: "route", detail: "lite", ...span("route") },
        { step: "retrieve", detail: t.tools, ...span("retrieve") },
        { step: "generate", detail: t.model, ...span("generate") },
        { step: "cite", detail: t.sources, ...span("cite") },
        {
          step: "answer",
          detail: fmt(t.cached, { p: EXAMPLE.cached }),
          time: duration(EXAMPLE.total, locale),
          bar: bar(0, EXAMPLE.total, EXAMPLE.total),
        },
      ],
    };
  }

  const total = trace.totalMs;
  const seconds = total === null ? "–" : duration(total, locale);
  const model = trace.model ?? "–";
  const generating = total !== null && trace.ttftMs !== null;
  return {
    id: trace.id,
    live: true,
    caption: fmt(t.last, { s: seconds }),
    summary: fmt(t.lastSummary, { model, s: seconds }),
    rows: [
      { step: "query", detail: trace.question, time: "", bar: null },
      { step: "route", detail: trace.route ?? "lite", time: "", bar: null },
      {
        step: "retrieve",
        detail: trace.tools.length ? trace.tools.join(", ") : t.noTools,
        time: "",
        bar: null,
      },
      {
        // From the first token to the last: the part of the answer that is
        // certainly generation.
        step: "generate",
        detail: trace.fallback ? `${model} · ${t.fallback}` : model,
        time: generating ? duration(total - trace.ttftMs!, locale) : "",
        bar: generating ? bar(trace.ttftMs!, total, total) : null,
      },
      {
        step: "cite",
        detail: trace.sources ? fmt(t.sourcesCount, { n: trace.sources }) : t.noSources,
        time: "",
        bar: null,
      },
      {
        step: "answer",
        detail: trace.cachedPct === null ? "" : fmt(t.cached, { p: trace.cachedPct }),
        time: total === null ? "" : seconds,
        bar: total === null ? null : bar(0, total, total),
      },
    ],
  };
}
