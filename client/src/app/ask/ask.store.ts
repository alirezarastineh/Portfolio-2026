import { DOCUMENT } from "@angular/common";
import { computed, effect, inject } from "@angular/core";
import { Router } from "@angular/router";
import { Chat } from "@ai-sdk/angular";
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withProps,
  withState,
} from "@ngrx/signals";
import { DefaultChatTransport, isToolUIPart } from "ai";

import type { Locale } from "../content/locale";
import { fmt } from "../i18n/interpolate";
import { apiBaseUrl } from "../services/api-base";
import { ContactService } from "../services/contact.service";
import { LanguageService } from "../services/language.service";
import { TURNSTILE_SITE_KEY, turnstileToken } from "../services/turnstile";
import {
  AnswerSignals,
  bump,
  finishedTotals,
  hasWords,
  signalRequest,
  type SignalCount,
} from "./answer-signals";
import { answerTrace } from "./answer-trace";
import { answersByQuestion } from "./answers";
import { ASK_COPY } from "./ask-copy";
import type { AskAbout, AskFocus } from "./ask-launcher.service";
import { ASK_STORAGE_KEY } from "./ask-storage";
import { AskTraceService } from "./ask-trace.service";
import type { AskMessage, DownReason, Entry, Failure, RemoteConfig } from "./ask-types";
import { feedbackBody, withDownReason } from "./down-reasons";
import { confirmHandoff } from "./handoff-confirm";
import { handoffSummary } from "./handoff-offer";
import {
  helpLines,
  offlineLines,
  openTarget,
  parseInput,
  projectLines,
  projectListLines,
  skillLines,
  whoamiLines,
  type LocalCommand,
  type OutLine,
} from "./commands";
import { requestBody } from "./request-body";
import { plainText } from "./terminal-markdown";
import { track } from "./track";

/**
 * The terminal's state around one AI SDK `Chat`: what was typed and shown
 * (entries), input history, the `stats` toggle, the tab's session id, the
 * server's config, and what happened to each question. Persisted per tab in
 * sessionStorage, so a visit to a case study and back keeps the conversation.
 *
 * Created in the browser only: the terminal loads lazily and never renders on
 * the server.
 */

const MAX_STORED_MESSAGES = 24;
const MAX_ENTRIES = 60;
const MAX_HISTORY = 50;

interface AskState {
  sessionId: string;
  entries: Entry[];
  history: string[];
  stats: boolean;
  remote: RemoteConfig | null;
  /** Until when the rate limit holds (ms since epoch), for the countdown. */
  limitedUntil: number | null;
  handoff: { summary: string; messageId: string } | null;
  feedback: Record<string, 1 | -1>;
  /** Why each 👎, when the visitor said (visitor plan V2). */
  downReasons: Record<string, DownReason>;
  /** The polite live region's text: finished answers and command output, once. */
  announcement: string;
}

function newSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/={1,2}$/, "");
}

function newId(): string {
  return newSessionId().slice(0, 12);
}

interface Stored {
  sessionId: string;
  entries: Entry[];
  history: string[];
  stats: boolean;
  feedback: Record<string, 1 | -1>;
  /** Absent from what an older terminal stored. */
  downReasons?: Record<string, DownReason>;
  messages: AskMessage[];
}

function readStored(): Stored | null {
  try {
    const raw = sessionStorage.getItem(ASK_STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    return typeof stored.sessionId === "string" && Array.isArray(stored.entries) ? stored : null;
  } catch {
    return null;
  }
}

/** What a reload needs to redraw: tool results are dropped, except where they were acted on. */
function forStorage(messages: AskMessage[]): AskMessage[] {
  return messages.slice(-MAX_STORED_MESSAGES).map((m) => ({
    ...m,
    parts: m.parts.map((p) =>
      isToolUIPart(p) && p.type !== "tool-navigate" && "output" in p
        ? ({ ...p, output: undefined } as typeof p)
        : p,
    ),
  }));
}

interface ErrorResponseBody {
  error?: string;
  retryAfter?: number;
}

function parseResponseBody(responseBody?: string): ErrorResponseBody {
  if (!responseBody) return {};
  try {
    return JSON.parse(responseBody) as ErrorResponseBody;
  } catch {
    return {};
  }
}

function failureFromStatus(
  status: number,
  responseBody?: string,
): { failure: Failure; retryAfter?: number } {
  const body = parseResponseBody(responseBody);
  switch (status) {
    case 429:
      return body.error === "busy"
        ? { failure: "busy" }
        : { failure: "rateLimited", retryAfter: body.retryAfter ?? 60 };
    case 503:
      return { failure: body.error === "assistant_resting" ? "resting" : "off" };
    case 413:
      return { failure: "tooLong" };
    case 400:
      return { failure: "invalid" };
    default:
      return { failure: "error" };
  }
}

function failureFrom(error: Error): { failure: Failure; retryAfter?: number } {
  const status = (error as { statusCode?: number }).statusCode;
  if (status) {
    return failureFromStatus(status, (error as { responseBody?: string }).responseBody);
  }
  // A stream's error part carries the server's code as the message.
  if (error.message === "unavailable" || error.message === "timeout" || error.message === "error") {
    return { failure: error.message };
  }
  if (error instanceof TypeError || !navigator.onLine) return { failure: "offline" };
  return { failure: "error" };
}

interface TurnstileState {
  turnstileToken: string;
  verified: boolean;
}

/**
 * While Turnstile is on, the server checks a session once, on its first
 * question: fetch a token for it. False when no token could be had.
 */
async function readyToAsk(next: TurnstileState, locale: Locale): Promise<boolean> {
  if (!TURNSTILE_SITE_KEY || next.verified) return true;
  try {
    next.turnstileToken = await turnstileToken(locale);
    return true;
  } catch {
    return false;
  }
}

/** A question the server answered took the check; one it refused needs a new token. */
function settleCheck(next: TurnstileState, entries: readonly Entry[], entryId: string): void {
  if (next.turnstileToken) {
    const entry = entries.find((e) => e.id === entryId);
    next.verified = entry?.kind === "ask" && !entry.failure;
  }
  next.turnstileToken = "";
}

export const AskStore = signalStore(
  { providedIn: "root" },
  withState<AskState>(() => {
    const stored = readStored();
    return {
      sessionId: stored?.sessionId ?? newSessionId(),
      entries: stored?.entries ?? [],
      history: stored?.history ?? [],
      stats: stored?.stats ?? false,
      remote: null,
      limitedUntil: null,
      handoff: null,
      feedback: stored?.feedback ?? {},
      downReasons: stored?.downReasons ?? {},
      announcement: "",
    };
  }),
  withProps(() => ({
    _router: inject(Router),
    _lang: inject(LanguageService),
    _contact: inject(ContactService),
    _doc: inject(DOCUMENT),
    _trace: inject(AskTraceService),
    /** The request being prepared: set just before `sendMessage`. */
    _next: {
      deep: false,
      /** What a reader pointed at with the question (visitor plan V9). */
      focus: null as AskFocus | null,
      entryId: null as string | null,
      /** Turnstile, while on: a single-use token for this session's first question. */
      turnstileToken: "",
      verified: false,
    },
    /** When each question was sent and its answer's first word showed (`performance.now()`). */
    _timings: new Map<string, { sentAt: number; shownAt?: number }>(),
    /** How often each question was asked again after it failed. */
    _retries: new Map<string, number>(),
    /** What the browser saw of each answer, sent to the server (visitor plan V2). */
    _signals: new AnswerSignals((sessionId, messageId, signals, keepalive) =>
      fetch(...signalRequest(apiBaseUrl(), sessionId, messageId, signals, keepalive)),
    ),
  })),
  withComputed((store) => ({
    copy: computed(() => ASK_COPY[store._lang.lang()]),
    /** Answers need the server; off or resting means the offline shell. */
    available: computed(() => {
      const state = store.remote()?.state;
      return state !== "off" && state !== "resting";
    }),
  })),
  withProps((store) => {
    const locale = (): Locale => store._lang.lang();

    const updateEntry = (id: string, patch: Partial<Extract<Entry, { kind: "ask" }>>) =>
      patchState(store, {
        entries: store
          .entries()
          .map((e) => (e.id === id && e.kind === "ask" ? { ...e, ...patch } : e)),
      });

    function handleToolPart(part: AskMessage["parts"][number]): void {
      if (!isToolUIPart(part) || part.state !== "output-available") return;
      if (part.type === "tool-navigate") {
        const output = part.output as { ok?: boolean; to?: string } | undefined;
        if (output?.ok && output.to) void store._router.navigateByUrl(output.to);
      }
    }

    const chat: Chat<AskMessage> = new Chat<AskMessage>({
      id: store.sessionId(),
      messages: readStored()?.messages ?? [],
      transport: new DefaultChatTransport<AskMessage>({
        api: `${apiBaseUrl()}/v1/ask`,
        prepareSendMessagesRequest: ({ messages }) => ({
          body: requestBody({
            sessionId: store.sessionId(),
            locale: locale(),
            deep: store._next.deep,
            turnstileToken: store._next.turnstileToken,
            url: store._router.url,
            focus: store._next.focus,
            messages,
          }),
        }),
      }),
      onError: (error) => {
        const entryId = store._next.entryId;
        if (!entryId) return;
        const { failure, retryAfter } = failureFrom(error);
        // The visitor sees one line; the console keeps what actually failed
        // (a dropped connection and a bug both read as "offline" otherwise).
        if (failure === "offline" || failure === "error") {
          console.warn("[ask] answer failed:", error);
        }
        const copy = ASK_COPY[locale()];
        const entry = store.entries().find((e) => e.id === entryId);
        const offline =
          failure === "unavailable" || failure === "resting" || failure === "off"
            ? offlineLines(entry?.input ?? "", store._lang.content(), locale(), copy)
            : undefined;
        updateEntry(entryId, {
          failure,
          ...(retryAfter ? { retryAfter } : {}),
          ...(offline ? { offline } : {}),
        });
        if (failure === "rateLimited" && retryAfter) {
          patchState(store, { limitedUntil: Date.now() + retryAfter * 1000 });
        }
        if (failure === "resting" || failure === "off") {
          const remote = store.remote();
          if (remote) patchState(store, { remote: { ...remote, state: failure } });
        }
        patchState(store, { announcement: plainText(messageFor(failure, retryAfter)) });
      },
      onFinish: ({ message, isAbort, isError }) => {
        persist();
        reportFinish(message, isAbort);
        if (isAbort || isError || message.role !== "assistant") return;
        track("ask_answer");
        // For the hero's trace panel: what this answer did, replayed there.
        const entry = store.entries().find((e) => e.id === store._next.entryId);
        if (entry?.kind === "ask") {
          const parsed = parseInput(entry.input);
          store._trace.record(
            answerTrace(parsed.kind === "ask" ? parsed.text : entry.input, message),
          );
        }
        const text = message.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n\n");
        patchState(store, { announcement: plainText(text) });

        for (const part of message.parts) {
          handleToolPart(part);
        }
        // The offer comes after the words (visitor plan V6): the model's, or the server's own.
        const summary = handoffSummary(message);
        if (summary) patchState(store, { handoff: { summary, messageId: message.id } });
      },
    });

    /**
     * Once an answer's stream is over (visitor plan V2): the time to its first visible word and
     * to its end, a stop, and how often its question was asked again before it.
     */
    function reportFinish(message: AskMessage, stopped: boolean): void {
      const entryId = store._next.entryId;
      const timing = entryId ? store._timings.get(entryId) : undefined;
      if (message.role !== "assistant" || !entryId || !timing) return;
      const { shownAt, totals } = finishedTotals({
        ...timing,
        now: performance.now(),
        words: hasWords(message),
        stopped,
        retries: store._retries.get(entryId) ?? 0,
      });
      timing.shownAt = shownAt;
      store._signals.report(store.sessionId(), message.id, (current) => ({
        ...current,
        ...totals,
      }));
    }

    function messageFor(failure: Failure, retryAfter?: number): string {
      const copy = ASK_COPY[locale()];
      switch (failure) {
        case "rateLimited":
          return fmt(copy.errors.rateLimited, { s: retryAfter ?? 60 });
        case "tooLong":
          return fmt(copy.errors.tooLong, { n: store.remote()?.limits.maxChars ?? 600 });
        case "resting":
        case "off":
          return store._lang.t().ask.offline;
        default:
          return copy.errors[failure];
      }
    }

    function persist(): void {
      try {
        const stored: Stored = {
          sessionId: store.sessionId(),
          entries: store.entries().slice(-MAX_ENTRIES),
          history: store.history().slice(-MAX_HISTORY),
          stats: store.stats(),
          feedback: store.feedback(),
          downReasons: store.downReasons(),
          messages: forStorage(chat.messages),
        };
        sessionStorage.setItem(ASK_STORAGE_KEY, JSON.stringify(stored));
      } catch {
        // Storage full or blocked: the conversation lasts as long as the page.
      }
    }

    return { chat, _persist: persist, _updateEntry: updateEntry, messageFor };
  }),
  withMethods((store) => {
    const locale = (): Locale => store._lang.lang();
    const content = () => store._lang.content();

    function show(input: string, lines: OutLine[]): void {
      patchState(store, {
        entries: [...store.entries(), { id: newId(), kind: "local" as const, input, lines }].slice(
          -MAX_ENTRIES,
        ),
        announcement: lines.map((l) => (l.label ? `${l.label}: ${l.text}` : l.text)).join("\n"),
      });
      store._persist();
    }

    function go(path: string): void {
      void store._router.navigateByUrl(path);
    }

    async function ask(
      input: string,
      text: string,
      deep: boolean,
      about: AskAbout | undefined,
    ): Promise<void> {
      const copy = store.copy();
      if (!store.available()) {
        show(input, [
          { text: store._lang.t().ask.offline, tone: "dim" },
          ...offlineLines(text, content(), locale(), copy),
        ]);
        return;
      }
      const limit = store.remote()?.limits.maxChars ?? 600;
      if (text.length > limit) {
        show(input, [{ text: fmt(copy.errors.tooLong, { n: limit }), tone: "error" }]);
        return;
      }
      const until = store.limitedUntil();
      if (until && until > Date.now()) {
        show(input, [
          {
            text: fmt(copy.errors.rateLimited, { s: Math.ceil((until - Date.now()) / 1000) }),
            tone: "error",
          },
        ]);
        return;
      }
      if (deep && store.remote()?.deep === false) deep = false;

      const entryId = newId();
      const userId = newId();
      patchState(store, {
        entries: [
          ...store.entries(),
          { id: entryId, kind: "ask" as const, input, userId, deep, ...(about ? { about } : {}) },
        ].slice(-MAX_ENTRIES),
        handoff: null,
        announcement: "",
      });
      // From here the visitor waits (a Turnstile check included): the first word's time counts it.
      store._timings.set(entryId, { sentAt: performance.now() });
      track("ask_send");
      store._next.deep = deep;
      store._next.focus = about?.focus ?? null;
      store._next.entryId = entryId;
      if (!(await readyToAsk(store._next, locale()))) {
        store._updateEntry(entryId, { failure: "error" });
        return;
      }
      await store.chat.sendMessage({ id: userId, role: "user", parts: [{ type: "text", text }] });
      settleCheck(store._next, store.entries(), entryId);
    }

    function toContact(): void {
      go(`/${locale()}#contact`);
    }

    function downloadFile(href: string): void {
      const link = store._doc.createElement("a");
      link.href = href;
      link.download = "";
      link.click();
    }

    function clearTerminal(): void {
      patchState(store, { entries: [], announcement: "" });
      store._persist();
    }

    function resetSession(): void {
      void store.chat.stop();
      store.chat.messages = [];
      patchState(store, {
        sessionId: newSessionId(),
        entries: [],
        handoff: null,
        feedback: {},
        downReasons: {},
        limitedUntil: null,
      });
      store._persist();
    }

    function handleOpen(input: string, arg: string): void {
      const copy = store.copy();
      const target = openTarget(content(), locale(), arg);
      if (!target) {
        show(input, [{ text: fmt(copy.cmd.notFound, { x: arg }), tone: "error" }]);
        return;
      }
      show(input, [{ text: fmt(copy.opening, { path: target }), tone: "dim" }]);
      go(target);
    }

    function handleCv(input: string): void {
      const copy = store.copy();
      const c = content();
      if (!c.identity.resume) {
        show(input, [{ text: copy.cmd.noCv, tone: "dim" }]);
        return;
      }
      show(input, [{ text: copy.cmd.cv, tone: "dim" }]);
      downloadFile(`/${locale()}/resume.pdf`);
    }

    function handleLang(input: string, arg: string): void {
      const copy = store.copy();
      const target = arg as Locale;
      if (target !== "en" && target !== "de") {
        show(input, [{ text: copy.cmd.langUsage, tone: "dim" }]);
        return;
      }
      show(input, [{ text: fmt(copy.cmd.lang, { lang: target.toUpperCase() }), tone: "dim" }]);
      store._lang.remember(target);
      void store._router.navigateByUrl(store._lang.alternates()[target]);
    }

    function handleStats(input: string): void {
      const copy = store.copy();
      const next = !store.stats();
      patchState(store, { stats: next });
      show(input, [{ text: next ? copy.cmd.statsOn : copy.cmd.statsOff, tone: "dim" }]);
    }

    function handleHistory(input: string): void {
      const copy = store.copy();
      const past = store.history().slice(0, -1);
      if (!past.length) {
        show(input, [{ text: copy.cmd.historyEmpty, tone: "dim" }]);
        return;
      }
      show(
        input,
        past.map((h, i) => ({ label: String(i + 1).padStart(3), text: h })),
      );
    }

    function handleSudo(input: string): void {
      const copy = store.copy();
      const l = locale();
      show(
        input,
        copy.cmd.sudo.map((text, i) => ({
          text,
          tone: i ? ("accent" as const) : ("dim" as const),
        })),
      );
      patchState(store, {
        handoff: {
          summary:
            l === "de"
              ? "Hallo Alireza, ich würde gern mit dir über eine Zusammenarbeit sprechen."
              : "Hi Alireza, I'd like to talk to you about working together.",
          messageId: "",
        },
      });
    }

    function runCommand(input: string, parsed: { name: LocalCommand; arg: string }): void {
      const copy = store.copy();
      const c = content();
      const l = locale();
      switch (parsed.name) {
        case "help":
          show(input, helpLines(copy, store._lang.t().ask.disclosure));
          break;
        case "whoami":
          show(input, whoamiLines(c, l, copy));
          break;
        case "ls-projects":
          show(input, projectListLines(c, l, copy));
          break;
        case "ls-skills":
          show(input, skillLines(c, copy));
          break;
        case "cat":
          show(input, projectLines(c, l, parsed.arg, copy));
          break;
        case "open":
          handleOpen(input, parsed.arg);
          break;
        case "open-usage":
          show(input, [{ text: copy.cmd.openUsage, tone: "dim" }]);
          break;
        case "deep-usage":
          show(input, [{ text: copy.cmd.deepUsage, tone: "dim" }]);
          break;
        case "cv":
          handleCv(input);
          break;
        case "contact":
          show(input, [{ text: copy.cmd.contact, tone: "dim" }]);
          toContact();
          break;
        case "lang":
          handleLang(input, parsed.arg);
          break;
        case "stats":
          handleStats(input);
          break;
        case "history":
          handleHistory(input);
          break;
        case "clear":
          clearTerminal();
          break;
        case "reset":
          resetSession();
          show(input, [{ text: copy.cmd.reset, tone: "dim" }]);
          break;
        case "sudo":
          handleSudo(input);
          break;
      }
    }

    return {
      /**
       * Runs what was typed: a shell command, or a question; a reader's button
       * brings what its question is about (visitor plan V9).
       */
      async submit(raw: string, about?: AskAbout): Promise<void> {
        const input = raw.trim();
        const parsed = parseInput(input);
        if (parsed.kind === "empty") return;
        if (store.history().at(-1) !== input) {
          patchState(store, { history: [...store.history(), input].slice(-MAX_HISTORY) });
        }

        // A pending hand-off takes y/n first.
        if (store.handoff() && /^(y|yes|j|ja|n|no|nein)$/i.test(input)) {
          this.answerHandoff(/^(y|yes|j|ja)$/i.test(input));
          return;
        }

        if (parsed.kind === "ask") {
          await ask(input, parsed.text, parsed.deep, about);
          return;
        }

        runCommand(input, parsed);
      },

      stop(): void {
        track("ask_stop");
        void store.chat.stop();
      },

      /** Asks the failed question again. */
      async retry(entryId: string): Promise<void> {
        const entry = store.entries().find((e) => e.id === entryId);
        if (entry?.kind !== "ask") return;
        store._updateEntry(entryId, {
          failure: undefined,
          retryAfter: undefined,
          offline: undefined,
        });
        // The answer that comes says it was asked again (visitor plan V2), and is timed afresh.
        store._retries.set(entryId, (store._retries.get(entryId) ?? 0) + 1);
        store._timings.set(entryId, { sentAt: performance.now() });
        store._next.deep = entry.deep;
        store._next.focus = entry.about?.focus ?? null;
        store._next.entryId = entryId;
        if (!(await readyToAsk(store._next, store._lang.lang()))) {
          store._updateEntry(entryId, { failure: "error" });
          return;
        }
        await store.chat.regenerate();
        settleCheck(store._next, store.entries(), entryId);
      },

      /** Clears the screen; the conversation goes on. */
      clear(): void {
        clearTerminal();
      },

      /** A new session: the assistant forgets this conversation. */
      reset(): void {
        resetSession();
      },

      toggleStats(): void {
        patchState(store, { stats: !store.stats() });
        store._persist();
      },

      /** +1 or -1 on an answer; a -1 may come back with its reason (visitor plan V2). */
      async rate(messageId: string, value: 1 | -1, reason?: DownReason): Promise<void> {
        patchState(store, {
          feedback: { ...store.feedback(), [messageId]: value },
          downReasons: withDownReason(store.downReasons(), messageId, value, reason),
        });
        store._persist();
        track("ask_feedback", reason ? { reason } : undefined);
        try {
          await fetch(`${apiBaseUrl()}/v1/ask/feedback`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(feedbackBody(store.sessionId(), messageId, value, reason)),
          });
        } catch {
          // Feedback is best effort.
        }
      },

      /** A follow-up clicked, a citation followed or the answer copied (visitor plan V2). */
      note(messageId: string, count: Exclude<SignalCount, "retries">): void {
        if (count === "followups") track("ask_followup");
        if (count === "copies") track("ask_copy");
        store._signals.report(store.sessionId(), messageId, (totals) => bump(totals, count));
      },

      /** The visitor's answer to "hand this conversation to the contact form?". */
      answerHandoff(yes: boolean): void {
        const pending = store.handoff();
        if (!pending) return;
        const copy = store.copy();
        patchState(store, { handoff: null });
        if (!yes) {
          show(copy.handoff.no, [{ text: copy.handoff.declined, tone: "dim" }]);
          return;
        }
        track("ask_handoff");
        // The answer the offer came with: the conversation the form may attach.
        const ask = pending.messageId
          ? { sessionId: store.sessionId(), messageId: pending.messageId }
          : null;
        if (ask) {
          // Counted as confirmed (the hand-off funnel); best effort, retried
          // while the answer is still being logged.
          void confirmHandoff(() =>
            fetch(`${apiBaseUrl()}/v1/ask/handoff`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(ask),
            }),
          );
        }
        store._contact.prefill.set({ text: pending.summary, ask });
        show(copy.handoff.yes, [{ text: copy.handoff.done, tone: "accent" }]);
        this.toContact();
      },

      toContact(): void {
        go(`/${locale()}#contact`);
      },

      download(href: string): void {
        const link = store._doc.createElement("a");
        link.href = href;
        link.download = "";
        link.click();
      },

      async loadConfig(): Promise<void> {
        try {
          const res = await fetch(`${apiBaseUrl()}/v1/ask/config`);
          if (res.ok) patchState(store, { remote: (await res.json()) as RemoteConfig });
        } catch {
          // Unknown: questions are tried, and their failure says why.
        }
      },
    };
  }),
  withHooks({
    onInit(store) {
      void store.loadConfig();

      // The answer's first visible word (visitor plan V2): the moment the question being answered
      // gets text, as the browser shows it.
      effect(() => {
        if (store.chat.status !== "streaming") return;
        const entry = store.entries().find((e) => e.id === store._next.entryId);
        const timing = entry ? store._timings.get(entry.id) : undefined;
        if (entry?.kind !== "ask" || !timing || timing.shownAt !== undefined) return;
        if (hasWords(answersByQuestion(store.chat.messages).get(entry.userId))) {
          timing.shownAt = performance.now();
        }
      });

      // What never reached the server goes once more as the page is left.
      const flush = () => store._signals.flush();
      store._doc.defaultView?.addEventListener("pagehide", flush);
    },
  }),
);

export type AskStore = InstanceType<typeof AskStore>;
