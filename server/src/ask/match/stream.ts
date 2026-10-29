import { createUIMessageStream, type UIMessageChunk } from "ai";

import type { Locale } from "../../content/schema.js";
import { newMessageId } from "../agent.js";
import type { AnswerChecks } from "../checks.js";
import type { AskConfig } from "../config.js";
import type { AskCorpus } from "../corpus/index.js";
import { snapshotKey } from "../corpus/snapshots.js";
import { ownWords } from "../handoff.js";
import { signAnswer } from "../history.js";
import { echoOf, LeakTally, newScanState, scanChunk } from "../leak-guard.js";
import { redact, type AnswerLog } from "../log.js";
import { answeringModel, newTrace, type Trace } from "../models/fallback.js";
import { shortName, type ModelEntry } from "../models/registry.js";
import { MATCH_ROUTE } from "../outcome-rows.js";
import { PROMPT_HASH, PROMPT_VERSION } from "../prompt.js";
import { answerReceipt } from "../receipt.js";
import { citeText, withoutMarkers } from "../stream-transforms.js";
import { closingStream, finishReasonOf, logRow, timings } from "../structured.js";
import { buildAnswerTrace, type AnswerTrace } from "../trace.js";
import { summarizeCalls } from "../usage.js";
import { matchGuard, runMatch, type MatchItem, type MatchOutcome, type MatchRow } from "./match.js";
import {
  countsLine,
  handoffPrefix,
  MATCH_BRIEF_LOGGED,
  MATCH_ITEM_CHARS,
  notPublishedLine,
  priorityLabel,
  statusLabel,
  stopLine,
  type MatchKind,
  type MatchStatus,
} from "./prompt.js";

/**
 * A match as one message (visitor plan V19): progress parts while it runs,
 * then the counts, the summary and a row per item, cited and through the
 * output guard, signed as any answer's text is, so it replays as history; the
 * finish carries V6's hand-off offer and the receipt. Logged as a visitor's
 * row on a route of its own (`route: "match"`), so `forget`, the signals and
 * the contact form's attached conversation reach it, and the answers'
 * measures (`VISITOR_ANSWER`) never count it.
 */

const MARK: Record<MatchStatus, string> = { evidence: "✓", partial: "~", "not-published": "–" };

/** An item as its row shows it, bold: no citation markers, no asterisks, on one line. */
const shownItem = (text: string) => withoutMarkers(text).replaceAll("*", "");

function rowLine(row: MatchRow, item: MatchItem, kind: MatchKind, language: Locale): string {
  const priority = kind === "role" ? ` (${priorityLabel(item.priority, language)})` : "";
  const said =
    row.status === "not-published"
      ? notPublishedLine(item.careful, language)
      : [row.summary, row.cites.map((id) => `[^${id}]`).join("")].join(" ");
  return `- ${MARK[row.status]} **${shownItem(item.text)}**${priority} · ${statusLabel(kind, row.status, language)}: ${said}`;
}

/** The answer's text: the counts and the model's summary, then a row per item; a stop's line alone. */
export function matchText(outcome: MatchOutcome): string {
  const { kind, language } = outcome;
  if (outcome.stop) return stopLine(outcome.stop, kind, language);
  const counts: Record<MatchStatus, number> = { evidence: 0, partial: 0, "not-published": 0 };
  for (const row of outcome.rows) counts[row.status]++;
  const head = [countsLine(kind, counts, language), outcome.summary].filter(Boolean).join(" ");
  const items = new Map(outcome.items.map((item) => [item.n, item]));
  const rows = outcome.rows.map((row) => rowLine(row, items.get(row.n)!, kind, language));
  return [head, "", ...rows].join("\n");
}

export interface MatchStreamRequest {
  kind: MatchKind;
  brief: string;
  locale: Locale;
  /** The language the match is written in and the corpus it reads: the brief's, else the visitor's. */
  language: Locale;
  sessionId: string;
  sessionHash: string;
  corpus: AskCorpus;
  config: AskConfig;
  /** The lite chain, less the demoted. */
  lite: ModelEntry[];
  /** The deep chain, less the demoted, when the deep route is open; null otherwise. */
  deep: ModelEntry[] | null;
  abortSignal: AbortSignal;
  droppedAnswers?: number;
  /** Write the log row and the usage (default); off for evals run from a laptop. */
  persist?: boolean;
  /** Called once the stream is over, whatever the outcome (frees the concurrency slot). */
  onClose?: () => void;
}

/** What the contact form is filled with: the kind, then the brief's first words (V6's own-words rule). */
export function matchHandoff(kind: MatchKind, brief: string, language: Locale): string {
  return `${handoffPrefix(kind, language)}: ${ownWords(brief)}`;
}

export function streamMatch(request: MatchStreamRequest): {
  messageId: string;
  stream: ReadableStream<UIMessageChunk>;
  done: Promise<MatchOutcome | null>;
} {
  const { corpus, config, sessionId, language } = request;
  const messageId = newMessageId();
  const trace = newTrace();
  const cited = new Set<string>();
  const dropped: string[] = [];
  let outcome: MatchOutcome | null = null;
  let shown = "";
  let failure: unknown = null;

  const ui = createUIMessageStream({
    execute: async ({ writer }) => {
      outcome = await runMatch({
        kind: request.kind,
        brief: request.brief,
        language,
        corpus,
        config,
        lite: request.lite,
        deep: request.deep,
        trace,
        abortSignal: request.abortSignal,
        persist: request.persist !== false,
        onStep: (step) =>
          writer.write({ type: "data-match-progress", data: { v: 1, ...step }, transient: true }),
        onFailover: (next) =>
          writer.write({
            type: "data-status",
            data: { code: "failover", ...next },
            transient: true,
          }),
      });
      // The whole text through the output guard and the citation check, as an answer's words go.
      const guarded = scanChunk(
        matchGuard(corpus, config),
        newScanState(),
        matchText(outcome),
        true,
        new LeakTally(),
        echoOf(request.brief),
      );
      const sources: UIMessageChunk[] = [];
      shown = citeText(guarded, { corpus, locale: language, cited, dropped }, (source) =>
        sources.push({
          type: "source-url",
          sourceId: source.id,
          url: source.url,
          title: source.title,
          providerMetadata: source.providerMetadata,
        }),
      );
      const receipt = answerReceipt(
        { match: matchTrace(request.kind, outcome) },
        { toolNames: [], cited: cited.size, dropped, searches: outcome.searches },
      );
      const answering = answeringModel(trace);
      writer.write({ type: "start", messageId, messageMetadata: { createdAt: Date.now() } });
      writer.write({ type: "start-step" });
      for (const source of sources) writer.write(source);
      writer.write({ type: "text-start", id: "match" });
      writer.write({ type: "text-delta", id: "match", delta: shown });
      writer.write({ type: "text-end", id: "match" });
      writer.write({ type: "finish-step" });
      writer.write({
        type: "finish",
        finishReason: "stop",
        messageMetadata: {
          sig: signAnswer(sessionId, messageId, shown),
          model: answering ? shortName(answering.model) : null,
          ...timings(trace),
          // The server's own offer (V6), on every match: the visitor's yes sends it.
          handoff: { by: "fallback", summary: matchHandoff(request.kind, request.brief, language) },
          receipt,
        },
      });
    },
    onError: (error) => {
      failure ??= error;
      return "error";
    },
  });

  let resolveDone!: (outcome: MatchOutcome | null) => void;
  const done = new Promise<MatchOutcome | null>((resolve) => (resolveDone = resolve));

  const stream = closingStream(ui, async (ending, error) => {
    if (error !== undefined) failure ??= error;
    request.onClose?.();
    const result = outcome as MatchOutcome | null;
    if (request.persist !== false) {
      await persistMatch(request, {
        messageId,
        result,
        trace,
        shown,
        cited: [...cited],
        dropped,
        finishReason: finishReasonOf(ending, request.abortSignal, failure),
      });
    }
    resolveDone(result);
  });

  return { messageId, stream, done };
}

/** The row's route reason: the kind, and how the match ended. */
export function matchRouteReason(kind: MatchKind, result: MatchOutcome | null): string {
  if (!result) return `${kind}:none`;
  const end = result.stop ? `stop:${result.stop}` : "rows";
  const repaired = result.repaired.plan || result.repaired.rows ? "+repair" : "";
  return `${kind}:${end}${repaired}`;
}

interface MatchDetails {
  messageId: string;
  result: MatchOutcome | null;
  trace: Trace;
  shown: string;
  cited: string[];
  dropped: string[];
  finishReason: string;
}

async function persistMatch(request: MatchStreamRequest, details: MatchDetails): Promise<void> {
  // Match spends the visitors' reserve under its own feature, up to its cap. Its searches'
  // embedding calls are recorded as the searches make them (embeddings.ts).
  await logRow({
    feature: "match",
    calls: details.trace.calls,
    sessionHash: request.sessionHash,
    corpus: request.corpus,
    label: "match",
    entry: () => matchRow(request, details),
  });
}

/** The trace's `match`: the items redacted, what each found, and the critic's verdicts. */
export function matchTrace(
  kind: MatchKind,
  result: MatchOutcome | null,
): NonNullable<AnswerTrace["match"]> {
  const rows = new Map((result?.rows ?? []).map((row) => [row.n, row]));
  return {
    kind,
    items: (result?.items ?? []).map((item) => {
      const row = rows.get(item.n);
      return {
        text: redact(item.text).slice(0, MATCH_ITEM_CHARS),
        priority: item.priority,
        status: row?.status ?? null,
        hits: item.hits,
        ...(item.careful ? { careful: true as const } : {}),
        ...(row?.downgraded ? { downgraded: true as const } : {}),
      };
    }),
    repaired: result?.repaired ?? { plan: false, rows: false },
    ...(result?.failures.length ? { failures: [...new Set(result.failures)] } : {}),
    ...(result?.stop ? { stop: result.stop } : {}),
  };
}

function matchRow(request: MatchStreamRequest, details: MatchDetails): AnswerLog {
  const { result, trace } = details;
  const { tokens, usd } = summarizeCalls([...trace.calls, ...(result?.searchCalls ?? [])]);
  const checks: AnswerChecks = { v: 1, flags: result?.injection ? ["injection-attempt"] : [] };
  const answering = answeringModel(trace);
  return {
    id: details.messageId,
    sessionHash: request.sessionHash,
    locale: request.locale,
    language: request.language,
    // A visitor's row: `forget` takes it. The route keeps it out of the answers' measures.
    source: "terminal",
    route: MATCH_ROUTE,
    routeReason: matchRouteReason(request.kind, result),
    // Redacted before it is cut, so no address is cut in half and kept.
    question: redact(request.brief).slice(0, MATCH_BRIEF_LOGGED),
    answer: details.shown,
    citedIds: details.cited,
    toolCalls: [],
    model: answering?.model ?? null,
    attempts: trace.attempts,
    ...timings(trace),
    tokens,
    usd,
    finishReason: details.finishReason,
    promptVersion: `${PROMPT_VERSION}+${PROMPT_HASH}`,
    droppedAnswers: request.droppedAnswers ?? 0,
    // The offer went out with the finish: `/v1/ask/handoff` takes the visitor's yes to it.
    trace: buildAnswerTrace([], trace, undefined, {
      match: matchTrace(request.kind, result),
      ...(result ? { handoff: { by: "fallback" as const } } : {}),
    }),
    droppedCitations: details.dropped,
    corpusKey: snapshotKey(request.corpus),
    checks,
  };
}
