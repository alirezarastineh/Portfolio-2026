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
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideThumbsDown, lucideThumbsUp } from "@ng-icons/lucide";
import { isToolUIPart, type ChatStatus } from "ai";

import { fmt } from "../i18n/interpolate";
import { LanguageService } from "../services/language.service";
import { AskStore } from "./ask.store";
import type { AskMessage, DownReason, Entry } from "./ask-types";
import { parseInput } from "./commands";
import { reasonChoices } from "./down-reasons";
import { AskLauncherService } from "./ask-launcher.service";
import { shareLink } from "./ask-link";
import { AskLinesComponent } from "./ask-lines.component";
import { linkPolicyFor } from "./link-policy";
import { stepLine } from "./match";
import {
  duration,
  failoverLine,
  pageTitle,
  receiptAlways,
  receiptClauses,
  sourceFacts,
  toolStep,
} from "./receipt";
import { footnotesFor, plainText, renderMarkdown, type Block } from "./terminal-markdown";
import { defaultTour, tourData } from "./tour";
import { track } from "./track";

type AskEntry = Extract<Entry, { kind: "ask" }>;

interface Footnote {
  id: string;
  n: number;
  url: string;
  title: string;
  /** The month it last changed (visitor plan V12). */
  updated: string | null;
}

/**
 * One answer as the console shows it (plan 4 U11): its trace, every step a line on the orange
 * line ("thinking… 1.2 s" first, and a failover, if one keeps the visitor waiting), then the text
 * (safe Markdown, citations as numbers, a dot at its end while it is written), the sources with
 * their dates, and on the latest answer follow-ups and feedback. Every answer keeps the receipt
 * with its "inspect" (visitor plan V12).
 */
@Component({
  selector: "app-ask-answer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AskLinesComponent, NgIcon, NgTemplateOutlet],
  viewProviders: [provideIcons({ lucideThumbsDown, lucideThumbsUp })],
  host: { class: "block" },
  template: `
    <ng-template #inline let-nodes>
      @for (node of nodes; track $index) {
        @switch (node.t) {
          @case ("text") {
            <ng-container>{{ node.v }}</ng-container>
          }
          @case ("strong") {
            <strong
              ><ng-container *ngTemplateOutlet="inline; context: { $implicit: node.c }"
            /></strong>
          }
          @case ("em") {
            <em><ng-container *ngTemplateOutlet="inline; context: { $implicit: node.c }" /></em>
          }
          @case ("code") {
            <code>{{ node.v }}</code>
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

    <div class="answer">
      <!-- What the answer did, each step a line on the orange line, drawn as it happens. -->
      @if (traced()) {
        <ol class="trace" [class.drawing]="live()" [attr.aria-label]="copy().trace.label">
          @for (step of steps(); track $index) {
            <!-- Running: a spinner (a static … under reduced motion). Done: a check.
                 Stopped before its result: neither. -->
            <li>
              {{ step.text }}
              @if (!step.pending) {
                <span class="step-done" aria-hidden="true"></span>
              } @else if (!done()) {
                <span class="step-spin" aria-hidden="true"></span>
              }
            </li>
          }
          <!-- Said once. The seconds tick ten times a second: hidden from screen
               readers, which would read the status again at every change. -->
          @if (thinking()) {
            <li>
              <span role="status"
                >{{ copy().thinking }} <span aria-hidden="true">{{ elapsed() }}</span></span
              >
            </li>
          }
          <!-- A failover before the first words (visitor plan V12): the console's live region says
               it once; here it may change (2 of 3, 3 of 3), so it is not read again. -->
          @if (failover(); as line) {
            <li aria-hidden="true" data-failover>{{ line }}</li>
          }
          <!-- The step a match is on (visitor plan V20): the live region says only its start and
               its rows, so the steps between are not read. -->
          @if (matchProgress(); as line) {
            <li aria-hidden="true" data-match-progress>{{ line }}</li>
          }
          @if (answeredIn(); as line) {
            <li>{{ line }}</li>
          }
          @if (meta(); as line) {
            <li>{{ line }}</li>
          }
        </ol>
      }

      @for (block of blocks(); track $index; let last = $last) {
        @switch (block.t) {
          @case ("p") {
            <!-- prettier-ignore -->
            <p class="para"><ng-container *ngTemplateOutlet="inline; context: { $implicit: block.c }" />@if (writing() && last) {<span class="writing" aria-hidden="true"></span>}</p>
          }
          @case ("ul") {
            <ul class="list">
              @for (item of block.items; track $index) {
                <li>
                  <span class="mark" aria-hidden="true">-</span
                  ><span class="item"
                    ><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }"
                  /></span>
                </li>
              }
            </ul>
          }
          @case ("ol") {
            <ol class="list numbered" [attr.start]="block.start">
              @for (item of block.items; track $index; let i = $index) {
                <li>
                  <span class="mark" aria-hidden="true">{{ block.start + i }}.</span
                  ><span class="item"
                    ><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }"
                  /></span>
                </li>
              }
            </ol>
          }
          @case ("pre") {
            <pre tabindex="0"><code>{{ block.v }}</code></pre>
          }
        }
      }

      <!-- A tour (visitor plan V16): its checked stops, or the short tour where none matched. -->
      @if (tourStops().length) {
        <ol class="list numbered" [attr.aria-label]="copy().tour.stops">
          @for (stop of tourStops(); track stop.id; let i = $index) {
            <li>
              <span class="mark" aria-hidden="true">{{ i + 1 }}.</span>
              <span class="item"
                ><a
                  class="link-underline"
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

      <!-- The sources, numbered as the text cites them; a citation [n] lights up source n. -->
      @if (footnotes().length) {
        <div class="sources">
          <span>{{ copy().sources }}</span>
          <ol>
            @for (note of footnotes(); track note.id) {
              <li [id]="noteId(note.id)">
                <a
                  class="note"
                  [class.lit]="lit() === note.n"
                  [attr.data-n]="note.n"
                  [href]="note.url"
                  (click)="followSource($event, note.url)"
                  ><span class="n" aria-hidden="true">{{ note.n }}</span>
                  <span class="title">{{ note.title }}</span>
                  @if (note.updated) {
                    <span class="updated">{{ note.updated }}</span>
                  }
                </a>
              </li>
            }
          </ol>
        </div>
      }

      <!-- Not a live region: the console announces the failure once (the
           store's announcement); here it would be read again, and a rate
           limit's countdown every second. -->
      @if (entry().failure) {
        <p class="failure">{{ failureText() }}</p>
        @if (entry().offline; as lines) {
          <app-ask-lines [lines]="lines" />
        }
        @if (retryable()) {
          <button type="button" class="ghost press" (click)="retry.emit()">
            {{ copy().retry }}
          </button>
        }
      } @else if (interrupted()) {
        <p class="aside">{{ copy().interrupted }}</p>
      }

      @if (done() && followups().length && latest()) {
        <div class="followups">
          <span>{{ copy().followups }}:</span>
          @for (item of followups(); track item) {
            <button type="button" class="ghost press" (click)="followup(item)">
              {{ item }}
            </button>
          }
        </div>
      }

      @if (done() && message()) {
        <!-- The latest answer's controls; every answer keeps how it was made (plan 4 U11). -->
        <div class="controls">
          @if (latest()) {
            <button
              type="button"
              class="word press"
              [class.on]="rating() === 1"
              [attr.aria-pressed]="rating() === 1"
              [attr.aria-label]="copy().helpful"
              [attr.title]="copy().helpful"
              (click)="rate(1)"
            >
              <ng-icon name="lucideThumbsUp" size="16" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="word press"
              [class.on]="rating() === -1"
              [attr.aria-pressed]="rating() === -1"
              [attr.aria-label]="copy().notHelpful"
              [attr.title]="copy().notHelpful"
              (click)="rate(-1)"
            >
              <ng-icon name="lucideThumbsDown" size="16" aria-hidden="true" />
            </button>
            <button type="button" class="word press" (click)="copyAnswer()">
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
                class="word press"
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
          }
          <!-- The newest match's rows as a table (plan 3 W3), with the sheet put away. -->
          @if (matchPage(); as href) {
            <a class="word press" [href]="href" (click)="openMatchPage($event, href)">{{
              copy().match.page
            }}</a>
          }
          @if (latest() && rating()) {
            <span>{{ copy().thanks }}</span>
          }
          <!-- The receipt waits behind this unless it must show, or stats is on (visitor plan V12). -->
          @if (receiptToggle()) {
            <button
              type="button"
              class="word press"
              [attr.aria-expanded]="opened()"
              (click)="opened.set(!opened())"
            >
              {{ copy().receipt.toggle }}
            </button>
          }
        </div>
        <!-- How it was made, on the same line; "inspect" opens what the log keeps of it. -->
        @if (receiptShown()) {
          <ol
            class="trace"
            data-receipt
            [class.drawing]="opened()"
            [attr.aria-label]="copy().receipt.toggle"
          >
            @for (clause of receipt(); track clause) {
              <li>{{ clause }}</li>
            }
            <li>
              <button type="button" class="word press" (click)="inspect.emit(message()!.id)">
                {{ copy().receipt.inspect }}
              </button>
            </li>
          </ol>
        }
        <!-- Why the -1 (visitor plan V2): codes, never free text. It appears after the visitor's
             own click and leaves the focus on -1; once one is chosen, the others go. -->
        @if (latest() && rating() === -1) {
          <div class="controls" role="group" [attr.aria-label]="copy().downReason.ask">
            <span aria-hidden="true">{{ copy().downReason.ask }}</span>
            @for (reason of reasons(); track reason) {
              <button
                type="button"
                class="word press"
                [class.on]="downReason() === reason"
                [attr.aria-pressed]="downReason() === reason"
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
    .answer {
      display: flex;
      flex-direction: column;
      gap: 0.625rem;
      color: var(--foreground);
    }

    /* The trace: a 1px spine, a 9px tick to each line. One piece of spine per line, so a line
       draws its own part as it arrives; the last stops at its tick. */
    .trace {
      margin: 0;
      padding: 0;
      list-style: none;
      color: var(--muted-foreground);
      font-family: var(--font-data);
      font-size: 0.8125rem;
      line-height: 1.5;
    }
    .trace li {
      position: relative;
      padding-block: 0.0625rem;
      padding-left: 1.0625rem;
      overflow-wrap: anywhere;
    }
    .trace li::before,
    .trace li::after {
      content: "";
      position: absolute;
      left: 0.1875rem;
      background: var(--accent-orange);
    }
    .trace li::before {
      top: calc(0.0625rem + 0.75em);
      width: 0.5625rem;
      height: 1px;
      transform-origin: left;
    }
    .trace li::after {
      top: 0;
      bottom: 0;
      width: 1px;
      transform-origin: top;
    }
    .trace li:last-child::after {
      bottom: auto;
      height: calc(0.0625rem + 0.75em);
    }
    /* Drawn: B612's subset has no check mark. */
    .step-done {
      display: inline-block;
      width: 0.3em;
      height: 0.6em;
      margin-left: 0.75ch;
      border: solid var(--available);
      border-width: 0 1.5px 1.5px 0;
      rotate: 45deg;
      translate: 0 -0.1em;
    }
    .step-spin {
      display: inline-block;
      width: 1ch;
      margin-left: 0.5ch;
      line-height: 1;
    }
    .step-spin::after {
      content: "…";
    }

    strong {
      font-weight: 600;
    }
    code {
      padding: 1px 0.25rem;
      border-radius: 0.25rem;
      background: var(--muted);
      font-family: var(--font-mono);
      font-size: 0.875em;
    }
    pre {
      margin: 0;
      padding: 0.75rem;
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 0.25rem;
      background: var(--background);
      font-size: 0.85em;
    }
    pre code {
      padding: 0;
      background: none;
      font-size: inherit;
    }
    .para {
      max-width: 68ch;
      margin: 0;
      white-space: pre-wrap;
      overflow-wrap: break-word;
    }
    /* Takes no width of its own, so the text never re-wraps as it moves. */
    .writing {
      display: inline-block;
      width: 0.4em;
      height: 0.4em;
      margin-left: 0.25em;
      margin-right: -0.65em;
      border-radius: 50%;
      background: var(--accent-orange);
    }
    .list {
      max-width: 68ch;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .list li {
      display: grid;
      grid-template-columns: 1.5ch 1fr;
      column-gap: 0.25rem;
    }
    .numbered li {
      grid-template-columns: 3ch 1fr;
    }
    .mark {
      color: var(--accent-orange);
    }
    .item {
      overflow-wrap: break-word;
    }

    /* A 24px target around a superscript, without moving the line. */
    .cite {
      position: relative;
      color: var(--accent-orange);
      text-decoration: none;
    }
    .cite::after {
      content: "";
      position: absolute;
      top: 50%;
      left: 50%;
      width: 1.5rem;
      height: 1.5rem;
      translate: -50% -50%;
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

    .sources {
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--border);
      color: var(--muted-foreground);
      font-size: 0.8125rem;
    }
    .sources ol {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .note {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      min-height: 1.5rem;
      border-radius: 0.25rem;
      text-decoration: none;
    }
    .note:hover {
      color: var(--foreground);
    }
    /* The source of the citation pointed at or focused. */
    .note.lit {
      background-color: var(--accent-orange-soft);
      color: var(--foreground);
    }
    .n {
      flex: none;
      min-width: 1.5ch;
      color: var(--accent-orange);
      font-family: var(--font-data);
    }
    .title {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .updated {
      flex: none;
      margin-left: auto;
      font-family: var(--font-data);
      font-size: 0.75rem;
    }

    .failure {
      margin: 0;
      color: var(--destructive);
    }
    .aside {
      margin: 0;
      color: var(--muted-foreground);
      font-size: 0.8125rem;
    }
    .followups {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      color: var(--muted-foreground);
      font-size: 0.8125rem;
    }
    .ghost {
      align-self: flex-start;
      min-height: 1.75rem;
      padding: 0.1875rem 0.5rem;
      border: 1px solid var(--border-strong);
      border-radius: 0.25rem;
      color: var(--foreground);
      text-align: left;
      cursor: pointer;
    }
    .ghost:hover {
      border-color: var(--accent-orange);
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem;
      margin-left: -0.375rem;
      color: var(--muted-foreground);
      font-size: 0.75rem;
    }
    /* Small words and icons, 24px targets. */
    .word {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.5rem;
      min-height: 1.5rem;
      padding-inline: 0.375rem;
      border-radius: 0.25rem;
      color: inherit;
      cursor: pointer;
    }
    .word:hover {
      color: var(--foreground);
    }
    .word.on {
      color: var(--accent-orange);
    }
    .trace .word {
      margin-left: -0.375rem;
      color: var(--accent-orange);
    }

    @media (pointer: coarse) {
      .word,
      .note,
      .ghost {
        min-height: 2.75rem;
      }
      .word {
        min-width: 2.75rem;
      }
      .note {
        align-items: center;
      }
    }

    @media (prefers-reduced-motion: no-preference) {
      .note {
        transition:
          background-color var(--dur-2),
          color var(--dur-2);
      }
      .drawing li {
        animation: trace-in var(--dur-3) var(--ease-out) backwards;
      }
      .drawing li::after {
        animation: trace-run var(--dur-2) var(--ease-out) backwards;
      }
      .drawing li::before {
        animation: trace-tick var(--dur-2) var(--ease-out) var(--dur-2) backwards;
      }
      .step-spin::after {
        content: "⠋";
        animation: step-spin 0.8s steps(1) infinite;
      }
    }
    @keyframes trace-in {
      from {
        opacity: 0;
      }
    }
    @keyframes trace-run {
      from {
        scale: 1 0;
      }
    }
    @keyframes trace-tick {
      from {
        scale: 0 1;
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
  private readonly launcher = inject(AskLauncherService);
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

  /** The match page, under the tab's newest match with rows: the one that page shows. */
  protected readonly matchPage = computed(() => {
    const newest = this.store.entries().findLast((e) => e.kind === "ask" && !!e.match);
    const rows = this.message()?.parts.some((p) => p.type === "data-match");
    return rows && newest?.id === this.entry().id ? `/${this.lang.lang()}/match` : null;
  });

  /** The server moved past a busy model, until this answer's first words (visitor plan V12). */
  protected readonly failover = computed(() => {
    const status = this.store.failover();
    if (!status || !this.live() || status.entryId !== this.entry().id || this.text()) return null;
    return failoverLine(status, this.copy().failover);
  });

  /** The step a match is on (visitor plan V20), until its rows come. */
  protected readonly matchProgress = computed(() => {
    const progress = this.store.matchStep();
    if (!progress || !this.live() || progress.entryId !== this.entry().id || this.text())
      return null;
    return stepLine(progress.step, this.copy().match.steps);
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

  /** The answer's tool calls, as lines of its trace, in the order they came. */
  protected readonly steps = computed(() => {
    const copy = this.copy().trace;
    const content = this.lang.content();
    return (this.message()?.parts ?? []).flatMap((part) => {
      if (!isToolUIPart(part)) return [];
      const name = part.type.slice("tool-".length);
      const text = toolStep(name, (part.input ?? {}) as Record<string, unknown>, copy, content);
      const pending = part.state === "input-streaming" || part.state === "input-available";
      return text ? [{ text, pending }] : [];
    });
  });

  /** All of the answer's text, below its trace however the two took turns. */
  protected readonly blocks = computed<Block[]>(() => {
    const numbers = new Map(this.footnotes().map((f) => [f.id, f.n]));
    const options = {
      cite: (id: string) => numbers.get(id) ?? null,
      link: this.linkPolicy(),
    };
    return (this.message()?.parts ?? []).flatMap((part) =>
      part.type === "text" && part.text ? renderMarkdown(part.text, options) : [],
    );
  });

  /** The trace's last line, once the answer stands: the server's own time for it. */
  protected readonly answeredIn = computed(() => {
    const ms = this.message()?.metadata?.totalMs;
    if (!this.done() || typeof ms !== "number") return null;
    return fmt(this.copy().trace.answered, { time: duration(ms, this.lang.lang()) });
  });

  protected readonly traced = computed(
    () =>
      this.steps().length > 0 ||
      this.thinking() ||
      !!this.failover() ||
      !!this.matchProgress() ||
      !!this.answeredIn() ||
      !!this.meta(),
  );

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
    this.launcher.closeIfSheet();
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
    this.launcher.closeIfSheet();
    void this.router.navigateByUrl(url);
  }

  protected openMatchPage(event: MouseEvent, href: string): void {
    if (modified(event)) return;
    event.preventDefault();
    this.launcher.closeSheet();
    void this.router.navigateByUrl(href);
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
