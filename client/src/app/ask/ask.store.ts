import { DOCUMENT } from "@angular/common";
import { computed, inject } from "@angular/core";
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
import { ASK_COPY } from "./ask-copy";
import { ASK_STORAGE_KEY } from "./ask-storage";
import type { AskMessage, Entry, Failure, RemoteConfig } from "./ask-types";
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
/** Messages sent back as context; the server keeps fewer still. */
const MAX_SENT_MESSAGES = 16;

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

/** What the server needs: text, and the signature that lets an answer count as history. */
function forRequest(messages: AskMessage[]) {
  return messages.slice(-MAX_SENT_MESSAGES).map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts.filter((p) => p.type === "text").map((p) => ({ type: "text", text: p.text })),
    ...(m.role === "assistant" && m.metadata?.sig ? { metadata: { sig: m.metadata.sig } } : {}),
  }));
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
      announcement: "",
    };
  }),
  withProps(() => ({
    _router: inject(Router),
    _lang: inject(LanguageService),
    _contact: inject(ContactService),
    _doc: inject(DOCUMENT),
    /** The request being prepared: set just before `sendMessage`. */
    _next: {
      deep: false,
      entryId: null as string | null,
      /** Turnstile, while on: a single-use token for this session's first question. */
      turnstileToken: "",
      verified: false,
    },
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

    function handleToolPart(part: AskMessage["parts"][number], messageId: string): void {
      if (!isToolUIPart(part) || part.state !== "output-available") return;
      if (part.type === "tool-handoff_contact") {
        const summary = (part.input as { summary?: string } | undefined)?.summary;
        if (summary) patchState(store, { handoff: { summary, messageId } });
      } else if (part.type === "tool-navigate") {
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
          body: {
            sessionId: store.sessionId(),
            locale: locale(),
            ...(store._next.deep ? { deep: true } : {}),
            ...(store._next.turnstileToken ? { turnstileToken: store._next.turnstileToken } : {}),
            messages: forRequest(messages),
          },
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
        if (isAbort || isError || message.role !== "assistant") return;
        track("ask_answer");
        const text = message.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text)
          .join("\n\n");
        patchState(store, { announcement: plainText(text) });

        for (const part of message.parts) {
          handleToolPart(part, message.id);
        }
      },
    });

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

    async function ask(input: string, text: string, deep: boolean): Promise<void> {
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
          { id: entryId, kind: "ask" as const, input, userId, deep },
        ].slice(-MAX_ENTRIES),
        handoff: null,
        announcement: "",
      });
      track("ask_send");
      store._next.deep = deep;
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
      /** Runs what was typed: a shell command, or a question. */
      async submit(raw: string): Promise<void> {
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
          await ask(input, parsed.text, parsed.deep);
          return;
        }

        runCommand(input, parsed);
      },

      stop(): void {
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
        store._next.deep = entry.deep;
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

      async rate(messageId: string, value: 1 | -1): Promise<void> {
        patchState(store, { feedback: { ...store.feedback(), [messageId]: value } });
        store._persist();
        track("ask_feedback");
        try {
          await fetch(`${apiBaseUrl()}/v1/ask/feedback`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: store.sessionId(), messageId, value }),
          });
        } catch {
          // Feedback is best effort.
        }
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
        store._contact.prefill.set(pending.summary);
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
    },
  }),
);

export type AskStore = InstanceType<typeof AskStore>;
