import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai";

import type { Locale } from "../content/schema.js";
import { resolveDocument, type AskCorpus } from "./corpus/index.js";
import { toolOutcome, type ToolOutcome } from "./tools.js";

/**
 * Citation markers (`[^project:atlas@en]`) are checked against the corpus as
 * the text streams. A known id is normalised to its full form and announced
 * once as a source part (the terminal turns it into a footnote); an unknown id
 * is removed, so an invented reference never reaches the visitor. A marker
 * split across chunks is held back until it closes.
 *
 * Some models write the brackets full-width, `【^profile@en】` or
 * `［^profile@en］` (a habit from their own citation format); those are read
 * the same way and come out as `[^…]`.
 */

const OPENERS = ["[", "【", "［"];
const MARKER = / ?[[【［]\^([^\]】］\s]{1,160})[\]】］]/g;
/** A tail that may still grow into a marker: `[`, `[^`, `[^proj…`. */
const OPEN_TAIL = /^ ?[[【［](\^[^\]】］\s]{0,160})?$/;
const DANGLING = / ?[[【［]\^[^\]】］\s]*$/;

type TextDeltaPart = { type: "text-delta"; id: string; text: string };

function findPendingCut(text: string): number {
  const open = Math.max(...OPENERS.map((opener) => text.lastIndexOf(opener)));
  if (open !== -1) {
    const start = open > 0 && text[open - 1] === " " ? open - 1 : open;
    if (OPEN_TAIL.test(text.slice(start))) return start;
  }
  // A trailing space may belong to a marker the next chunk starts: an invented
  // one takes its space with it, so the answer reads the same however it is cut.
  return text.endsWith(" ") ? text.length - 1 : text.length;
}

export function citationTransform<TOOLS extends ToolSet>(options: {
  corpus: Pick<AskCorpus, "byId">;
  locale: Locale;
  cited: Set<string>;
  /** Ids the model invented; they are removed from the text either way. */
  dropped?: string[];
}): StreamTextTransform<TOOLS> {
  const { corpus, locale, cited, dropped } = options;

  return () => {
    const pending = new Map<string, string>();

    function rewrite(
      text: string,
      out: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
    ): string {
      return text.replace(MARKER, (match, raw: string) => {
        const doc = resolveDocument(corpus, raw, locale);
        if (!doc) {
          dropped?.push(raw);
          return "";
        }
        if (!cited.has(doc.id)) {
          cited.add(doc.id);
          out.enqueue({
            type: "source",
            sourceType: "url",
            id: doc.id,
            url: doc.url,
            title: doc.title,
          });
        }
        return `${match.startsWith(" ") ? " " : ""}[^${doc.id}]`;
      });
    }

    function handleTextDelta(
      part: TextDeltaPart,
      out: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
    ): void {
      const text = (pending.get(part.id) ?? "") + part.text;
      const cut = findPendingCut(text);
      pending.set(part.id, text.slice(cut));
      const ready = rewrite(text.slice(0, cut), out);
      if (ready) out.enqueue({ ...part, text: ready });
    }

    function handleTextEnd(
      id: string,
      out: TransformStreamDefaultController<TextStreamPart<TOOLS>>,
    ): void {
      const rest = pending.get(id);
      pending.delete(id);
      if (!rest) return;
      const flushed = rewrite(rest, out).replace(DANGLING, "");
      if (flushed) out.enqueue({ type: "text-delta", id, text: flushed });
    }

    return new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, out) {
        if (part.type === "text-delta") {
          handleTextDelta(part, out);
          return;
        }
        if (part.type === "text-end") {
          handleTextEnd(part.id, out);
        }
        out.enqueue(part);
      },
    });
  };
}

export interface RecordedToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Null until its result arrives: a call cut off by the end of the answer has none. */
  outcome: ToolOutcome | null;
  /** Size of the result the model got back, in characters of JSON. */
  resultChars: number;
}

/** One agent step as the stream showed it: its tool calls and how it ended. */
export interface RecordedStep {
  tools: RecordedToolCall[];
  finishReason: string | null;
}

/** What the visitor was shown, collected for the log, the usage row and the signature. */
export interface AnswerRecord {
  textOrder: string[];
  texts: Map<string, string>;
  toolCalls: { name: string; input: unknown }[];
  steps: RecordedStep[];
  finishReason: string | null;
  error: unknown;
  aborted: boolean;
}

export function newAnswerRecord(): AnswerRecord {
  return {
    textOrder: [],
    texts: new Map(),
    toolCalls: [],
    steps: [],
    finishReason: null,
    error: null,
    aborted: false,
  };
}

function currentStep(record: AnswerRecord): RecordedStep {
  let step = record.steps.at(-1);
  if (!step) {
    step = { tools: [], finishReason: null };
    record.steps.push(step);
  }
  return step;
}

function recordedCall(record: AnswerRecord, id: string): RecordedToolCall | undefined {
  for (let i = record.steps.length - 1; i >= 0; i--) {
    const call = record.steps[i]!.tools.find((t) => t.id === id);
    if (call) return call;
  }
  return undefined;
}

function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The answer's text as the browser will hold it: its text parts, in order,
 * empty ones dropped. The server recomputes the same from the message the
 * browser sends back, to check the signature.
 */
export function answerText(record: AnswerRecord): string {
  return record.textOrder
    .map((id) => record.texts.get(id) ?? "")
    .filter(Boolean)
    .join("\n\n");
}

export function recorderTransform<TOOLS extends ToolSet>(
  record: AnswerRecord,
): StreamTextTransform<TOOLS> {
  return () =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, out) {
        switch (part.type) {
          case "text-start":
            record.textOrder.push(part.id);
            break;
          case "text-delta":
            record.texts.set(part.id, (record.texts.get(part.id) ?? "") + part.text);
            break;
          case "start-step":
            record.steps.push({ tools: [], finishReason: null });
            break;
          case "tool-call":
            record.toolCalls.push({ name: part.toolName, input: part.input });
            currentStep(record).tools.push({
              id: part.toolCallId,
              name: part.toolName,
              input: part.input,
              outcome: null,
              resultChars: 0,
            });
            break;
          case "tool-result": {
            const call = part.preliminary ? undefined : recordedCall(record, part.toolCallId);
            if (call) {
              call.outcome = toolOutcome(part.output);
              call.resultChars = jsonLength(part.output);
            }
            break;
          }
          case "tool-error": {
            const call = recordedCall(record, part.toolCallId);
            if (call) call.outcome = "error";
            break;
          }
          case "finish-step":
            currentStep(record).finishReason = part.finishReason;
            break;
          case "finish":
            record.finishReason = part.finishReason;
            break;
          case "error":
            record.error = part.error;
            break;
          case "abort":
            record.aborted = true;
            break;
        }
        out.enqueue(part);
      },
    });
}
