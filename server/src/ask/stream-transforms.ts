import type { StreamTextTransform, TextStreamPart, ToolSet } from "ai";

import type { Locale } from "../content/schema.js";
import { resolveDocument, type AskCorpus } from "./corpus/index.js";

/**
 * Citation markers (`[^project:atlas@en]`) are checked against the corpus as
 * the text streams. A known id is normalised to its full form and announced
 * once as a source part (the terminal turns it into a footnote); an unknown id
 * is removed, so an invented reference never reaches the visitor. A marker
 * split across chunks is held back until it closes.
 */

const MARKER = / ?\[\^([^\]\s]{1,160})\]/g;
/** A tail that may still grow into a marker: `[`, `[^`, `[^proj…`. */
const OPEN_TAIL = /^ ?\[(\^[^\]\s]{0,160})?$/;
const DANGLING = / ?\[\^[^\]\s]*$/;

type TextDeltaPart = { type: "text-delta"; id: string; text: string };

function findPendingCut(text: string): number {
  const open = text.lastIndexOf("[");
  if (open === -1) return text.length;
  const start = open > 0 && text[open - 1] === " " ? open - 1 : open;
  return OPEN_TAIL.test(text.slice(start)) ? start : text.length;
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

/** What the visitor was shown, collected for the log, the usage row and the signature. */
export interface AnswerRecord {
  textOrder: string[];
  texts: Map<string, string>;
  toolCalls: { name: string; input: unknown }[];
  finishReason: string | null;
  error: unknown;
  aborted: boolean;
}

export function newAnswerRecord(): AnswerRecord {
  return {
    textOrder: [],
    texts: new Map(),
    toolCalls: [],
    finishReason: null,
    error: null,
    aborted: false,
  };
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
          case "tool-call":
            record.toolCalls.push({ name: part.toolName, input: part.input });
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
