import type { Locale } from "../content/locale";
import type { AskFocus } from "./ask-launcher.service";
import type { Level } from "./ask-level";
import type { AskMessage } from "./ask-types";
import type { MatchRequest } from "./match";
import type { TourRequest } from "./tour";
import { forRequest } from "./sent-messages";

/** The longest page path the server takes (`PAGE_CHARS`, server/src/ask/page.ts). */
const PAGE_CHARS = 160;

/**
 * The page a question is asked on (visitor plan V8): the router's URL without
 * its query or hash. The server decides what it means (a published case study
 * or post, or nothing); what is not a path of this site is not sent.
 */
export function pagePath(url: string): string | null {
  const path = url.split(/[?#]/, 1)[0] ?? "";
  return path.startsWith("/") && path.length <= PAGE_CHARS ? path : null;
}

export interface RequestInput {
  sessionId: string;
  locale: Locale;
  deep: boolean;
  /** Turnstile's token for the session's first question, while it is on; empty otherwise. */
  turnstileToken: string;
  /** The router's URL as the question goes. */
  url: string;
  /** What a reader pointed at with the question (visitor plan V9). */
  focus?: AskFocus | null;
  /** How technical the visitor wants answers (visitor plan V10); standard is not sent. */
  level?: Level;
  /** A tour for an interest instead of an answer (visitor plan V16). */
  tour?: TourRequest | null;
  /** A brief to match instead of an answer (visitor plan V20). */
  match?: MatchRequest | null;
  messages: readonly AskMessage[];
}

/** What `/v1/ask` receives with a question. */
export function requestBody(input: RequestInput) {
  const page = pagePath(input.url);
  return {
    sessionId: input.sessionId,
    locale: input.locale,
    ...(input.deep ? { deep: true } : {}),
    ...(input.turnstileToken ? { turnstileToken: input.turnstileToken } : {}),
    ...(page ? { page } : {}),
    ...(input.focus ? { focus: input.focus } : {}),
    // Standard sends nothing, so the server's instructions stay today's bytes.
    ...(input.level && input.level !== "standard" ? { level: input.level } : {}),
    ...(input.tour ? { mode: "tour", tour: input.tour } : {}),
    ...(input.match ? { mode: "match", match: input.match } : {}),
    messages: forRequest(input.messages),
  };
}
