import type {
  ModelMessage,
  StreamTextTransform,
  TextStreamPart,
  ToolSet,
  UIMessageChunk,
  UIMessageStreamWriter,
} from "ai";

import { repairTurn, type RepairLookup } from "./prompt.js";
import { DOCUMENT_CHARS, FETCH_CLIP } from "./tool-defs.js";

/**
 * The pieces of the verifier's one repair (visitor plan V5): an answer that
 * ended with no words gets one more call on its own chain, tools off, and the
 * words it writes join the same message. agent.ts runs it; these are the
 * parts it is built from.
 */

/** How a merged stream ended: read to its end, failed, or cancelled (the visitor left). */
export type MergeEnd = "done" | "failed" | "cancelled";

/**
 * Merges `stream` into the answer's UI stream and settles once it is spent, so
 * what comes next starts after it: `merge` alone reads every stream it is
 * given at once, and two would interleave. Nothing is read ahead
 * (`highWaterMark: 0`): every chunk is in the answer before this settles.
 * `keep` leaves a chunk out (the agent's finish, held for the end; the
 * repair's errors). A failure is the answer's own (`propagate`, the agent's
 * stream: the writer's `onError` turns it into an error chunk) or ends the
 * stream quietly (the repair's: the closing line answers instead).
 */
export function mergeInOrder(
  writer: Pick<UIMessageStreamWriter, "merge">,
  stream: ReadableStream<UIMessageChunk>,
  options: { keep?: (chunk: UIMessageChunk) => boolean; onFailure?: "propagate" | "end" } = {},
): Promise<MergeEnd> {
  const keep = options.keep ?? (() => true);
  const reader = stream.getReader();
  return new Promise((settle) => {
    writer.merge(
      new ReadableStream<UIMessageChunk>(
        {
          async pull(controller) {
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                  controller.close();
                  settle("done");
                  return;
                }
                if (keep(value)) {
                  controller.enqueue(value);
                  return;
                }
              }
            } catch (error) {
              if (options.onFailure === "end") controller.close();
              else controller.error(error);
              settle("failed");
            }
          },
          async cancel(reason) {
            settle("cancelled");
            await reader.cancel(reason);
          },
        },
        { highWaterMark: 0 },
      ),
    );
  });
}

function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** A step's tool results, as the agent's steps hold them. */
export interface StepResults {
  toolResults: readonly { toolName: string; input: unknown; output: unknown }[];
}

/**
 * What the answer's lookups returned, for the repair to answer from: each
 * result cut where a fetched document is (`FETCH_CLIP`), all of them where an
 * answer's documents are (`DOCUMENT_CHARS`), so the repair reads no more than
 * the answer could have.
 */
export function lookupsOf(steps: readonly StepResults[]): RepairLookup[] {
  let left = DOCUMENT_CHARS;
  return steps
    .flatMap((step) => step.toolResults)
    .map((result) => {
      const full = json(result.output);
      const kept = full.slice(0, Math.max(0, Math.min(FETCH_CLIP, left)));
      left -= kept.length;
      return {
        tool: result.toolName,
        input: json(result.input).slice(0, 300),
        output: kept.length < full.length ? `${kept}…` : kept,
      };
    });
}

/**
 * The repair's conversation: the answer's own, and the server's turn (what the
 * lookups returned, then the repair line) as a second text part of the
 * visitor's last turn, after its fence. No provider sees two user turns in a
 * row, and none needs tool history: the shape a model without tools gets.
 */
export function repairMessages(
  messages: readonly ModelMessage[],
  lookups: readonly RepairLookup[],
): ModelMessage[] {
  const turn = { type: "text" as const, text: repairTurn(lookups) };
  const last = messages.at(-1);
  if (last?.role !== "user") return [...messages, { role: "user", content: [turn] }];
  const content =
    typeof last.content === "string"
      ? [{ type: "text" as const, text: last.content }]
      : last.content;
  return [...messages.slice(0, -1), { ...last, content: [...content, turn] }];
}

/**
 * Renames a stream's text parts: each `streamText` call numbers its own from
 * the start (Gemini's first is "0"), and the answer's record keys its text by
 * id, so the repair's parts must not reuse the agent's.
 */
export function renameTextIds<TOOLS extends ToolSet>(prefix: string): StreamTextTransform<TOOLS> {
  return () =>
    new TransformStream<TextStreamPart<TOOLS>, TextStreamPart<TOOLS>>({
      transform(part, out) {
        const text =
          part.type === "text-start" || part.type === "text-delta" || part.type === "text-end";
        out.enqueue(text ? { ...part, id: `${prefix}${part.id}` } : part);
      },
    });
}

/** The closing line as a text part of its own: the server's words, no model's. */
export function closingChunks(id: string, line: string): UIMessageChunk[] {
  return [
    { type: "text-start", id },
    { type: "text-delta", id, delta: line },
    { type: "text-end", id },
  ];
}
