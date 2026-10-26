import { DOCUMENT, NgTemplateOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { Router } from "@angular/router";
import { isToolUIPart, type ChatStatus } from "ai";

import { fmt } from "../i18n/interpolate";
import { LanguageService } from "../services/language.service";
import { AskStore } from "./ask.store";
import type { AskMessage, DownReason, Entry } from "./ask-types";
import { parseInput } from "./commands";
import { reasonChoices } from "./down-reasons";
import { shareLink } from "./ask-link";
import { AskLinesComponent } from "./ask-lines.component";
import { linkPolicyFor } from "./link-policy";
import { failoverLine, pageTitle, receiptAlways, receiptClauses, sourceFacts } from "./receipt";
import { footnotesFor, plainText, renderMarkdown, type Block } from "./terminal-markdown";
import { defaultTour, tourData } from "./tour";
import { track } from "./track";

type AskEntry = Extract<Entry, { kind: "ask" }>;

interface Footnote {
  id: string;
  n: number;
  url: string;
  title: string;
  /** The document's kind as a glyph, and the month it last changed (visitor plan V12). */
  glyph: string | null;
  updated: string | null;
}

type Piece = { kind: "step"; text: string; pending: boolean } | { kind: "text"; blocks: Block[] };

/**
 * One answer as the terminal shows it: tool steps as dim shell output, the
 * text (safe Markdown, citations as footnote numbers), footnotes with each
 * source's kind and date, follow-up suggestions, an optional meta line,
 * feedback, and the receipt with its "inspect" (visitor plan V12). While it
 * is being written: "thinking… 1.2 s" (and a failover, if one keeps the
 * visitor waiting), then a caret at the end of the text.
 */
@Component({
  selector: "app-ask-answer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AskLinesComponent, NgTemplateOutlet],
  host: { class: "block" },
  template: `
    <ng-template #inline let-nodes>
      @for (node of nodes; track $index) {
        @switch (node.t) {
          @case ("text") {
            <ng-container>{{ node.v }}</ng-container>
          }
          @case ("strong") {
            <strong class="font-semibold text-foreground"
              ><ng-container *ngTemplateOutlet="inline; context: { $implicit: node.c }"
            /></strong>
          }
          @case ("em") {
            <em><ng-container *ngTemplateOutlet="inline; context: { $implicit: node.c }" /></em>
          }
          @case ("code") {
            <code class="rounded bg-muted px-1 py-px text-[0.92em]">{{ node.v }}</code>
          }
          @case ("link") {
            <a
              class="link-underline"
              [href]="node.href"
              [attr.rel]="node.internal ? null : 'noopener'"
              (click)="follow($event, node.href, node.internal)"
              ><ng-container *ngTemplateOutlet="inline; context: { $implicit: node.c }"
            /></a>
          }
          @case ("cite") {
            <a
              class="cite"
              [attr.data-n]="node.n"
              [href]="footnoteHref(node.id)"
              [attr.aria-label]="citeLabel(node.id)"
              (click)="followCite($event, node.id)"
              (mouseenter)="lit.set(node.n)"
              (mouseleave)="lit.set(null)"
              (focus)="focusCite($event, node.n)"
              (blur)="lit.set(null)"
              ><sup>[{{ node.n }}]</sup></a
            >
          }
        }
      }
    </ng-template>

    <div class="flex flex-col gap-1.5 pb-3 text-foreground/90">
      @for (piece of pieces(); track $index) {
        @if (piece.kind === "step") {
          <!-- Running: a spinner (a static … under reduced motion). Done: a check.
               Stopped before its result: neither. -->
          <p class="m-0 text-muted-foreground">
            <span aria-hidden="true">› </span>{{ piece.text }}
            @if (!piece.pending) {
              <span class="text-available" aria-hidden="true">✓</span>
            } @else if (!done()) {
              <span class="step-spin" aria-hidden="true"></span>
            }
          </p>
        } @else {
          @for (block of piece.blocks; track $index; let last = $last) {
            @switch (block.t) {
              @case ("p") {
                <!-- prettier-ignore -->
                <p class="m-0 whitespace-pre-wrap wrap-break-word leading-relaxed"><ng-container *ngTemplateOutlet="inline; context: { $implicit: block.c }" />@if (writing() && last) {<span class="terminal-caret" aria-hidden="true"></span>}</p>
              }
              @case ("ul") {
                <ul class="m-0 list-none p-0">
                  @for (item of block.items; track $index) {
                    <li class="grid grid-cols-[1.5ch_1fr] gap-x-1">
                      <span class="text-accent-orange" aria-hidden="true">-</span
                      ><span class="wrap-break-word"
                        ><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }"
                      /></span>
                    </li>
                  }
                </ul>
              }
              @case ("ol") {
                <ol class="m-0 list-none p-0" [attr.start]="block.start">
                  @for (item of block.items; track $index; let i = $index) {
                    <li class="grid grid-cols-[3ch_1fr] gap-x-1">
                      <span class="text-accent-orange" aria-hidden="true"
                        >{{ block.start + i }}.</span
                      ><span class="wrap-break-word"
                        ><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }"
                      /></span>
                    </li>
                  }
                </ol>
              }
              @case ("pre") {
                <pre
                  class="m-0 overflow-x-auto rounded-md border border-border bg-background/60 p-3 text-[0.85em]"
                  tabindex="0"
                ><code>{{ block.v }}</code></pre>
              }
            }
          }
        }
      }

      <!-- A tour (visitor plan V16): its checked stops, or the short tour where none matched. -->
      @if (tourStops().length) {
        <ol class="m-0 list-none p-0" [attr.aria-label]="copy().tour.stops">
          @for (stop of tourStops(); track stop.id; let i = $index) {
            <li class="grid grid-cols-[3ch_1fr] gap-x-1">
              <span class="text-accent-orange" aria-hidden="true">{{ i + 1 }}.</span>
              <span class="wrap-break-word"
                ><a
                  class="underline decoration-border underline-offset-4 hover:decoration-accent-orange"
                  [href]="stop.url"
                  (click)="followStop($event, stop.url)"
                  >{{ stop.title }}</a
                >
                — {{ stop.line }}</span
              >
            </li>
          }
        </ol>
      }

      <!-- Said once. The seconds tick ten times a second: hidden from screen
           readers, which would read the status again at every change. -->
      @if (thinking()) {
        <p class="m-0 text-muted-foreground" role="status">
          {{ copy().thinking }}
          <span class="tabular-nums" aria-hidden="true">{{ elapsed() }}</span>
          <span class="ml-2 hidden text-xs sm:inline">{{ copy().stopHint }}</span>
        </p>
      }
      <!-- A failover before the first words (visitor plan V12): the terminal's live region says
           it once; here it may change (2 of 3, 3 of 3), so it is not read again. -->
      @if (failover(); as line) {
        <p class="m-0 text-xs text-muted-foreground" aria-hidden="true" data-failover>
          {{ line }}
        </p>
      }

      <!-- The sources, as chips; a citation [n] in the text lights up chip n. -->
      @if (footnotes().length) {
        <div
          class="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-2 border-t border-dashed border-border pt-2 text-xs"
        >
          <span class="text-muted-foreground">{{ copy().sources }}:</span>
          <ol class="m-0 flex min-w-0 list-none flex-wrap gap-2 p-0">
            @for (note of footnotes(); track note.id) {
              <li [id]="noteId(note.id)" class="max-w-full">
                <a
                  class="note chip min-h-6 max-w-full gap-1.5 hover:border-border-strong hover:text-foreground"
                  [class.lit]="lit() === note.n"
                  [attr.data-n]="note.n"
                  [href]="note.url"
                  (click)="followSource($event, note.url)"
                  ><span class="text-muted-foreground" aria-hidden="true">[{{ note.n }}]</span>
                  @if (note.glyph) {
                    <span class="text-muted-foreground" aria-hidden="true">{{ note.glyph }}</span>
                  }
                  <span class="min-w-0 wrap-break-word">{{ note.title }}</span>
                  @if (note.updated) {
                    <span class="shrink-0 text-muted-foreground"
                      ><span aria-hidden="true">· </span>{{ note.updated }}</span
                    >
                  }
                </a>
              </li>
            }
          </ol>
        </div>
      }

      <!-- Not a live region: the terminal announces the failure once (the
           store's announcement); here it would be read again, and a rate
           limit's countdown every second. -->
      @if (entry().failure; as failure) {
        <p class="m-0 text-destructive">{{ failureText() }}</p>
        @if (entry().offline; as lines) {
          <app-ask-lines [lines]="lines" />
        }
        @if (retryable()) {
          <button
            type="button"
            class="min-h-6 w-fit cursor-pointer font-mono text-xs text-accent-orange underline underline-offset-4"
            (click)="retry.emit()"
          >
            ↻ {{ copy().retry }}
          </button>
        }
      } @else if (interrupted()) {
        <p class="m-0 text-xs text-muted-foreground">{{ copy().interrupted }}</p>
      }

      @if (done() && followups().length && latest()) {
        <div class="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span class="text-muted-foreground">{{ copy().followups }}:</span>
          @for (item of followups(); track item) {
            <button
              type="button"
              class="press cursor-pointer rounded-md border border-border px-2 py-1 text-left text-foreground/85 hover:border-accent-orange hover:text-foreground"
              (click)="followup(item)"
            >
              {{ item }}
            </button>
          }
        </div>
      }

      @if (done() && message()) {
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          @if (meta(); as m) {
            <span>── {{ m }} ──</span>
          }
          <!-- Pulled left by the buttons' padding, so "+1" lines up with the text. -->
          <span class="-ml-1.5 flex items-center gap-1">
            <button
              type="button"
              class="feedback press"
              [attr.aria-pressed]="rating() === 1"
              [attr.aria-label]="'+1: ' + copy().helpful"
              [class.text-accent-orange]="rating() === 1"
              (click)="rate(1)"
            >
              +1
            </button>
            <button
              type="button"
              class="feedback press"
              [attr.aria-pressed]="rating() === -1"
              [attr.aria-label]="'-1: ' + copy().notHelpful"
              [class.text-accent-orange]="rating() === -1"
              (click)="rate(-1)"
            >
              -1
            </button>
            <button type="button" class="feedback press" (click)="copyAnswer()">
              @if (copied()) {
                {{ copy().copied }}<span aria-hidden="true"> ✓</span>
              } @else {
                {{ copy().copy }}
              }
            </button>
            <!-- A link that carries the question (visitor plan V17); its name says so. -->
            @if (sharedQuestion()) {
              <button
                type="button"
                class="feedback press"
                [attr.aria-label]="shared() ? copy().share.copied : copy().share.name"
                (click)="shareQuestion()"
              >
                @if (shared()) {
                  {{ copy().share.copied }}<span aria-hidden="true"> ✓</span>
                } @else {
                  {{ copy().share.label }}
                }
              </button>
            }
            @if (rating()) {
              <span>{{ copy().thanks }}</span>
            }
            <!-- The receipt waits behind this unless it must show, or stats is on (visitor plan V12). -->
            @if (receiptToggle()) {
              <button
                type="button"
                class="feedback press"
                [attr.aria-expanded]="opened()"
                (click)="opened.set(!opened())"
              >
                {{ copy().receipt.toggle }}
              </button>
            }
          </span>
        </div>
        <!-- How it was made, as counts and codes; "inspect" opens what the log keeps of it. -->
        @if (receiptShown()) {
          <p class="m-0 text-xs text-muted-foreground" data-receipt>
            <span aria-hidden="true"># </span>{{ receipt().join(" · ") }}
            <button
              type="button"
              class="feedback press -ml-1 text-accent-orange"
              (click)="inspect.emit(message()!.id)"
            >
              {{ copy().receipt.inspect }}
            </button>
          </p>
        }
        <!-- Why the -1 (visitor plan V2): codes, never free text. It appears after the visitor's
             own click and leaves the focus on -1; once one is chosen, the others go. -->
        @if (rating() === -1) {
          <div
            class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
            role="group"
            [attr.aria-label]="copy().downReason.ask"
          >
            <span aria-hidden="true">{{ copy().downReason.ask }}</span>
            @for (reason of reasons(); track reason) {
              <button
                type="button"
                class="feedback press"
                [attr.aria-pressed]="downReason() === reason"
                [class.text-accent-orange]="downReason() === reason"
                (click)="giveReason(reason)"
              >
                {{ copy().downReason[reason] }}
              </button>
            }
          </div>
        }
      }
    </div>
  `,
  styles: `
    .cite {
      color: var(--accent-orange);
      text-decoration: none;
    }
    .cite sup {
      font-size: 0.72em;
      line-height: 0;
      margin-left: 1px;
    }
    .cite:hover sup,
    .cite:focus-visible sup {
      text-decoration: underline;
    }

    /* The chip of the citation pointed at or focused (lit). */
    .note.lit {
      border-color: var(--accent-orange);
      background-color: var(--accent-orange-soft);
      color: var(--foreground);
    }

    /* +1, -1 and copy: small words, 24px targets. */
    .feedback {
      display: inline-flex;
      min-width: 1.5rem;
      min-height: 1.5rem;
      align-items: center;
      justify-content: center;
      padding-inline: 0.375rem;
      border-radius: 0.25rem;
      cursor: pointer;
    }
    .feedback:hover {
      color: var(--foreground);
    }

    /* A tool step at work: a braille spinner, 80ms a frame. */
    .step-spin {
      display: inline-block;
      width: 1ch;
      line-height: 1;
    }
    .step-spin::after {
      content: "…";
    }

    @media (prefers-reduced-motion: no-preference) {
      .note {
        transition:
          border-color var(--dur-2),
          background-color var(--dur-2),
          color var(--dur-2);
      }
      .step-spin::after {
        content: "⠋";
        animation: step-spin 0.8s steps(1) infinite;
      }
    }

    @keyframes step-spin {
      0% {
        content: "⠋";
      }
      10% {
        content: "⠙";
      }
      20% {
        content: "⠹";
      }
      30% {
        content: "⠸";
      }
      40% {
        content: "⠼";
      }
      50% {
        content: "⠴";
      }
      60% {
        content: "⠦";
      }
      70% {
        content: "⠧";
      }
      80% {
        content: "⠇";
      }
      90% {
        content: "⠏";
      }
    }
  `,
})
export class AskAnswerComponent {
  readonly entry = input.required<AskEntry>();
  readonly message = input<AskMessage | undefined>(undefined);
  /** True for the question being answered right now. */
  readonly live = input(false);
  readonly status = input<ChatStatus>("ready");
  /** The newest question: only its follow-ups and retry are offered. */
  readonly latest = input(false);

  readonly ask = output<string>();
  readonly retry = output<void>();
  /** `inspect` for this answer, by its message id (visitor plan V12). */
  readonly inspect = output<string>();

  protected readonly store = inject(AskStore);
  private readonly lang = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);

  protected readonly copy = this.store.copy;
  protected readonly copied = signal(false);
  /** The question's link was just copied (visitor plan V17). */
  protected readonly shared = signal(false);
  /**
   * The citation [n] pointed at or focused from the keyboard, whose source chip
   * lights up. Set by its events: a `:has(.cite:hover)` rule did this until
   * WebKit, which never re-matches it for citations that arrive with a
   * streamed answer, left the chip unlit (plan Phase 10's cross-browser run).
   */
  protected readonly lit = signal<number | null>(null);
  private readonly now = signal(Date.now());

  protected readonly thinking = computed(
    () => this.live() && this.status() === "submitted" && !this.entry().failure,
  );
  protected readonly writing = computed(() => this.live() && this.status() === "streaming");
  protected readonly done = computed(
    () => !this.live() || this.status() === "ready" || this.status() === "error",
  );

  protected readonly text = computed(() =>
    (this.message()?.parts ?? [])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n\n"),
  );

  protected readonly footnotes = computed<Footnote[]>(() => {
    const locale = this.lang.lang();
    const copy = this.copy();
    const sources = (this.message()?.parts ?? []).flatMap((p) =>
      p.type === "source-url"
        ? [
            {
              id: p.sourceId,
              url: p.url,
              title: p.title ?? p.url,
              ...sourceFacts(p.providerMetadata, locale, copy),
            },
          ]
        : [],
    );
    return footnotesFor(this.text(), sources);
  });

  /**
   * The question a share link carries (visitor plan V17): the visitor's own, as they asked it;
   * none for a tour.
   */
  protected readonly sharedQuestion = computed(() => {
    const entry = this.entry();
    if (entry.tour) return null;
    const parsed = parseInput(entry.input);
    return parsed.kind === "ask" ? parsed.text : null;
  });

  /** A tour's stops (visitor plan V16): the server's checked plan, or the short tour made here. */
  protected readonly tourStops = computed(() => {
    const data = tourData(this.message());
    if (!data) return [];
    return data.kind === "plan" ? data.stops : defaultTour(this.lang.content(), this.lang.lang());
  });

  /** The server moved past a busy model, until this answer's first words (visitor plan V12). */
  protected readonly failover = computed(() => {
    const status = this.store.failover();
    if (!status || !this.live() || status.entryId !== this.entry().id || this.text()) return null;
    return failoverLine(status, this.copy().failover);
  });

  /** The receipt's clauses (visitor plan V12): what the answer did, from its metadata only. */
  protected readonly receipt = computed(() => {
    const meta = this.message()?.metadata;
    const page = meta?.receipt?.page;
    return receiptClauses(meta, this.copy().receipt, {
      pageTitle: page ? pageTitle(page, this.lang.content()) : null,
      about: this.entry().about,
    });
  });
  /** Opened with "how was this answered?". */
  protected readonly opened = signal(false);
  private readonly always = computed(() => receiptAlways(this.message()?.metadata?.receipt));
  protected readonly receiptToggle = computed(
    () => this.receipt().length > 0 && !this.always() && !this.store.stats(),
  );
  protected readonly receiptShown = computed(
    () => this.receipt().length > 0 && (this.always() || this.store.stats() || this.opened()),
  );

  private readonly linkPolicy = computed(() => linkPolicyFor(this.lang.content()));

  protected readonly pieces = computed<Piece[]>(() => {
    const copy = this.copy();
    const numbers = new Map(this.footnotes().map((f) => [f.id, f.n]));
    const options = {
      cite: (id: string) => numbers.get(id) ?? null,
      link: this.linkPolicy(),
    };
    const pieces: Piece[] = [];
    for (const part of this.message()?.parts ?? []) {
      if (part.type === "text") {
        if (part.text) pieces.push({ kind: "text", blocks: renderMarkdown(part.text, options) });
      } else if (isToolUIPart(part)) {
        const name = part.type.slice("tool-".length);
        const input = (part.input ?? {}) as Record<string, unknown>;
        const label = stepLabel(name, input, copy.tool);
        if (label) {
          pieces.push({
            kind: "step",
            text: label,
            pending: part.state === "input-streaming" || part.state === "input-available",
          });
        }
      }
    }
    return pieces;
  });

  protected readonly followups = computed(() => {
    for (const part of this.message()?.parts ?? []) {
      if (part.type === "tool-suggest_followups" && part.input) {
        const items = (part.input as { items?: unknown }).items;
        if (Array.isArray(items))
          return items.filter((i): i is string => typeof i === "string").slice(0, 3);
      }
    }
    return [];
  });

  protected readonly interrupted = computed(
    () =>
      this.done() && !!this.message() && !this.message()?.metadata?.sig && !this.entry().failure,
  );

  protected readonly retryable = computed(() => {
    const failure = this.entry().failure;
    return (
      this.latest() && !!failure && !["resting", "off", "invalid", "tooLong"].includes(failure)
    );
  });

  protected readonly failureText = computed(() => {
    const entry = this.entry();
    if (!entry.failure) return "";
    if (entry.failure === "rateLimited") {
      const until = this.store.limitedUntil();
      const left = until
        ? Math.max(0, Math.ceil((until - this.now()) / 1000))
        : (entry.retryAfter ?? 60);
      return fmt(this.copy().errors.rateLimited, { s: left });
    }
    return this.store.messageFor(entry.failure, entry.retryAfter);
  });

  protected readonly meta = computed(() => {
    const m = this.message()?.metadata;
    if (!m?.model) return null;
    const copy = this.copy();
    const fallback = m.fallback ? ` (${copy.fallback})` : "";
    if (!this.store.stats()) return m.fallback ? `${m.model}${fallback}` : null;
    const parts = [`${m.model}${m.route === "deep" ? " · deep" : ""}${fallback}`];
    if (typeof m.totalMs === "number") parts.push(`${(m.totalMs / 1000).toFixed(1)} s`);
    if (m.tokens && m.tokens.input > 0) {
      parts.push(fmt(copy.cached, { p: Math.round((m.tokens.cached / m.tokens.input) * 100) }));
    }
    return parts.join(" · ");
  });

  protected readonly rating = computed(() => {
    const id = this.message()?.id;
    return id ? (this.store.feedback()[id] ?? 0) : 0;
  });

  /** Why the -1, once the visitor said (visitor plan V2). */
  protected readonly downReason = computed<DownReason | null>(() => {
    const id = this.message()?.id;
    return id ? (this.store.downReasons()[id] ?? null) : null;
  });

  /** The reasons on offer: all three until one is chosen, then that one. */
  protected readonly reasons = computed(() => reasonChoices(this.downReason()));

  protected readonly elapsed = computed(() => {
    const started = this.message()?.metadata?.createdAt ?? this.startedAt;
    return `${((this.now() - started) / 1000).toFixed(1)} s`;
  });

  private readonly startedAt = Date.now();

  constructor() {
    // A clock for "thinking… 1.2 s" and the rate-limit countdown, only while needed.
    let timer: ReturnType<typeof setInterval> | undefined;
    effect(() => {
      const ticking = this.thinking() || this.entry().failure === "rateLimited";
      if (ticking && !timer) {
        timer = setInterval(() => this.now.set(Date.now()), 100);
      } else if (!ticking && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    });
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected noteId(id: string): string {
    return `ask-note-${this.message()?.id ?? "x"}-${id.replace(/[^a-z0-9]/gi, "-")}`;
  }

  protected footnoteHref(id: string): string {
    return this.footnotes().find((f) => f.id === id)?.url ?? "#";
  }

  protected citeLabel(id: string): string {
    const note = this.footnotes().find((f) => f.id === id);
    return note ? `${this.copy().sources} ${note.n}: ${note.title}` : "";
  }

  protected follow(event: MouseEvent, href: string, internal: boolean): void {
    if (!internal || modified(event)) return;
    event.preventDefault();
    void this.router.navigateByUrl(href.replace(/^https?:\/\/[^/]+/, ""));
  }

  protected followCite(event: MouseEvent, id: string): void {
    track("ask_citation_click");
    this.followSource(event, this.footnoteHref(id));
  }

  /** Focus from the keyboard lights the chip up, as `:focus-visible` did; a click's does not. */
  protected focusCite(event: FocusEvent, n: number): void {
    if ((event.target as HTMLElement).matches(":focus-visible")) this.lit.set(n);
  }

  protected followSource(event: MouseEvent, url: string): void {
    // Followed, in this tab or another (visitor plan V2): a citation or its chip.
    this.note("citations");
    if (modified(event) || !url.startsWith("/") || url.startsWith("/media/")) return;
    event.preventDefault();
    void this.router.navigateByUrl(url);
  }

  /** A tour's stop opened from its list: the visitor's own step, through the router (V16). */
  protected followStop(event: MouseEvent, url: string): void {
    if (modified(event)) return;
    event.preventDefault();
    void this.router.navigateByUrl(url);
  }

  /**
   * Copies this page's address carrying the question (visitor plan V17): opened, it puts the
   * question in the prompt, and only the visitor sends it. Said once: "Link copied".
   */
  protected async shareQuestion(): Promise<void> {
    const question = this.sharedQuestion();
    if (!question) return;
    try {
      await navigator.clipboard.writeText(
        shareLink(this.doc.location.origin, this.router.url, question),
      );
      this.shared.set(true);
      track("ask_share");
      this.store.announce(this.copy().share.copied);
      setTimeout(() => this.shared.set(false), 1500);
    } catch {
      // Clipboard refused (permissions): nothing to do.
    }
  }

  /** A follow-up question asked: counted for this answer, then asked. */
  protected followup(item: string): void {
    this.note("followups");
    this.ask.emit(item);
  }

  protected rate(value: 1 | -1): void {
    const id = this.message()?.id;
    if (id && this.rating() !== value) void this.store.rate(id, value);
  }

  protected giveReason(reason: DownReason): void {
    const id = this.message()?.id;
    if (id && this.downReason() !== reason) void this.store.rate(id, -1, reason);
  }

  protected async copyAnswer(): Promise<void> {
    try {
      await navigator.clipboard.writeText(plainText(this.text()));
      this.copied.set(true);
      this.note("copies");
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard refused (permissions): nothing to do.
    }
  }

  /** What the visitor did with this answer, for the browser's signals (visitor plan V2). */
  private note(count: "followups" | "citations" | "copies"): void {
    const id = this.message()?.id;
    if (id) this.store.note(id, count);
  }
}

function modified(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

function stepLabel(
  name: string,
  input: Record<string, unknown>,
  labels: Record<string, string>,
): string | null {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  switch (name) {
    case "search_portfolio":
      return fmt(labels["search_portfolio"]!, { q: str("query") });
    case "get_document":
      return fmt(labels["get_document"]!, { id: str("id") });
    case "list_projects":
      return fmt(labels["list_projects"]!, { q: str("text") }).trim();
    case "get_resume":
      return labels["get_resume"]!;
    case "navigate":
      return fmt(labels["navigate"]!, { to: str("to") });
    default:
      // Follow-ups and the hand-off have their own rendering.
      return null;
  }
}
