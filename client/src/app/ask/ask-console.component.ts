import { NgTemplateOutlet } from "@angular/common";
import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCornerDownLeft, lucideSquare } from "@ng-icons/lucide";

import { LanguageService } from "../services/language.service";
import { COPIED_MS, copyText, type CopyResult } from "../services/copy-text";
import { AskAnswerComponent } from "./ask-answer.component";
import { ASK_ENTRY_COPY, commandRow } from "./ask-entry-copy";
import { answersByQuestion } from "./answers";
import { AskLauncherService, type AskAbout, type AskSource } from "./ask-launcher.service";
import { AskLinesComponent } from "./ask-lines.component";
import { counterLine, type MatchKind } from "./match";
import { MatchBoxComponent } from "./match-box.component";
import { AskStore } from "./ask.store";
import type { Entry } from "./ask-types";
import { fmt } from "../i18n/interpolate";
import { complete, pageQuestions, parseInput } from "./commands";
import { newsCount } from "./news";
import { replannable } from "./tour";
import { track } from "./track";

let instances = 0;
const MAX_INPUT_LINES = 6;
/** Who came here to type: on a phone only they get the prompt, and its keyboard (plan 4 U9). */
const TYPING = new Set<AskSource>(["shortcut", "hero", "link"]);

/**
 * The assistant's console (plan 4 U11): a prompt whose main command is the AI, the commands shown
 * under it, and a log where every answer leaves its trace. Enter sends, Shift+Enter adds a line,
 * ↑/↓ recall history, Tab completes, Ctrl+C stops an answer, Ctrl+L clears, Esc closes the panel.
 * The log never follows the stream: a new exchange goes to its top and grows beneath, and finished
 * answers are announced once through a polite live region, never token by token.
 */
@Component({
  selector: "app-ask-console",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AskAnswerComponent, AskLinesComponent, MatchBoxComponent, NgIcon, NgTemplateOutlet],
  viewProviders: [provideIcons({ lucideCornerDownLeft, lucideSquare })],
  template: `
    <!-- What waits on the visitor, under the newest exchange. -->
    <ng-template #waiting>
      @if (store.handoff(); as handoff) {
        <div class="choice" role="group" [attr.aria-label]="copy().handoff.ask">
          <span class="asks">{{ copy().handoff.ask }}</span>
          <span class="what">{{ handoff.summary }}</span>
          <button type="button" class="ghost press" (click)="store.answerHandoff(true)">
            {{ copy().handoff.yes }}
          </button>
          <button type="button" class="ghost press" (click)="store.answerHandoff(false)">
            {{ copy().handoff.no }}
          </button>
        </div>
      }
      <!-- forget (visitor plan V14): irreversible, so it names what goes and waits for a yes. -->
      @if (store.forgetPending()) {
        <div
          class="choice"
          role="group"
          [attr.aria-label]="copy().forget.ask"
          [attr.aria-describedby]="forgetId"
        >
          <span class="asks">{{ copy().forget.ask }}</span>
          <span [id]="forgetId" class="what">{{ copy().forget.what }}</span>
          <button type="button" class="ghost press" (click)="store.answerForget(true)">
            {{ copy().forget.yes }}
          </button>
          <button type="button" class="ghost press" (click)="store.answerForget(false)">
            {{ copy().forget.no }}
          </button>
        </div>
      }
      <!-- The guided tour (visitor plan V16): where it is, and the visitor's own moves. -->
      @if (store.tour(); as tour) {
        <div class="choice" role="group" [attr.aria-label]="tourLabel()">
          <span class="asks">{{ tourLabel() }}</span>
          @if (tour.at > 0) {
            <button type="button" class="ghost press" (click)="send('back')">
              {{ copy().tour.back }}
            </button>
          }
          @if (tour.at < tour.stops.length - 1) {
            <button type="button" class="ghost press" (click)="send('next')">
              {{ copy().tour.next }}
            </button>
          }
          @if (canReplan()) {
            <button type="button" class="ghost press" (click)="send('tour more like this')">
              {{ copy().tour.more }}
            </button>
          }
          <button type="button" class="ghost press" (click)="send('tour stop')">
            {{ copy().tour.end }}
          </button>
        </div>
      }
      <!-- What's new (visitor plan V15): stores a date in this browser, so only after a yes. -->
      @if (store.newsPending()) {
        <div
          class="choice"
          role="group"
          [attr.aria-label]="copy().news.ask"
          [attr.aria-describedby]="newsId"
        >
          <span class="asks">{{ copy().news.ask }}</span>
          <span [id]="newsId" class="what">{{ copy().news.what }}</span>
          <button type="button" class="ghost press" (click)="store.answerNews(true)">
            {{ copy().news.yes }}
          </button>
          <button type="button" class="ghost press" (click)="store.answerNews(false)">
            {{ copy().news.no }}
          </button>
        </div>
      }
      @if (store.loading()) {
        <p class="loading">{{ copy().loading }}</p>
      }
      <!-- Match a brief (visitor plan V20): the paste box, its code loaded with the first match. -->
      @defer (when store.match()) {
        @if (store.match(); as kind) {
          <app-match-box
            [kind]="kind"
            (sent)="sendMatch(kind, $event)"
            (dismissed)="dismissMatch()"
          />
        }
      }
    </ng-template>

    <div
      #log
      tabindex="0"
      role="log"
      aria-live="off"
      class="log"
      [attr.aria-label]="lang.t().ask.title"
    >
      @for (entry of store.entries(); track entry.id; let last = $last) {
        <div class="entry" [class.latest]="last">
          <!-- prettier-ignore -->
          <p class="question"><span class="prompt" aria-hidden="true">&gt;</span><span class="sr-only">{{ copy().you }}:</span><span class="said">{{ entry.input }}@if (entry.kind === "ask" && entry.about) {<span class="about">{{ entry.about.label }}</span>}</span></p>
          @if (entry.kind === "local") {
            <app-ask-lines [lines]="entry.lines" (ask)="send($event)" (fill)="fill($event)" />
            <!-- Output worth keeping (inspect's timeline, visitor plan V12) can be copied whole. -->
            @if (entry.copy; as text) {
              <button type="button" class="quiet press" (click)="copyOutput(entry.id, text)">
                {{ copy()[copiedOutput()?.id === entry.id ? copiedOutput()!.result : "copy"] }}
              </button>
            }
          } @else {
            <app-ask-answer
              [entry]="entry"
              [message]="answers().get(entry.userId)"
              [live]="entry.id === liveId()"
              [status]="status()"
              [latest]="entry.id === latestAskId()"
              (ask)="send($event)"
              (retry)="store.retry(entry.id)"
              (inspect)="inspectAnswer($event)"
            />
          }
          @if (last) {
            <ng-container *ngTemplateOutlet="waiting" />
          }
        </div>
      } @empty {
        <!-- What it can do, and a first question to try. -->
        <div class="empty">
          @if (store.available()) {
            <p class="hint">{{ lang.t().ask.hint }}</p>
            <div class="suggestions" role="group" [attr.aria-label]="starters().suggestions">
              @for (question of suggestions(); track question) {
                <button type="button" class="suggestion press" (click)="start(question)">
                  {{ question }}
                </button>
              }
            </div>
            <!-- What changed since the last visit, once the visitor turned what's new on (V15). -->
            @if (newsLine(); as line) {
              <button type="button" class="news press" (click)="send('news')">{{ line }}</button>
            }
          } @else {
            <p class="hint">{{ lang.t().ask.offline }}</p>
            <button type="button" class="suggestion press" (click)="send('contact')">
              {{ starters().contact }}
            </button>
          }
        </div>
        <ng-container *ngTemplateOutlet="waiting" />
      }
    </div>

    <form class="composer" (submit)="$event.preventDefault(); submit(); refocus()">
      <label [for]="inputId" class="prompt"
        ><span aria-hidden="true">&gt;</span
        ><span class="sr-only">{{ copy().inputLabel }}</span></label
      >
      <textarea
        #input
        [id]="inputId"
        rows="1"
        class="prompt-input"
        [attr.placeholder]="lang.t().ask.placeholder"
        [attr.aria-describedby]="nearLimit() ? hintId + ' ' + countId : hintId"
        autocomplete="off"
        autocapitalize="sentences"
        spellcheck="true"
        enterkeyhint="send"
        (keydown)="onKey($event)"
        (input)="onInput()"
        (focus)="reportOpen('terminal')"
      ></textarea>
      <!-- One button, so the focus stays on it as sending turns into stopping. -->
      <button
        class="send press"
        [attr.type]="busy() ? 'button' : 'submit'"
        [attr.aria-label]="busy() ? copy().stop : starters().send"
        [disabled]="limited()"
        (click)="stopIfBusy()"
      >
        <ng-icon
          [name]="busy() ? 'lucideSquare' : 'lucideCornerDownLeft'"
          size="16"
          aria-hidden="true"
        />
      </button>
    </form>
    @if (nearLimit()) {
      <p [id]="countId" class="count" [class.over]="tooLong()">{{ counter() }}</p>
    }
    <div class="commands" role="group" translate="no" [attr.aria-label]="starters().commands">
      @for (command of commands(); track command) {
        <button type="button" class="press" (click)="send(command)">{{ command }}</button>
      }
    </div>
    <p [id]="hintId" class="ai-note">{{ lang.t().ask.disclosure }}</p>

    <div class="sr-only" aria-live="polite" aria-atomic="true">{{ store.announcement() }}</div>
    <!-- Where Cloudflare's check shows when it asks the visitor (store: readyToAsk). -->
    <div #check class="check" [attr.data-label]="copy().quickCheck"></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .log {
      position: relative;
      flex: 1 1 0;
      min-height: 5rem;
      padding: 1rem;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .entry {
      padding-block: 0.875rem;
      border-top: 1px solid var(--border);
    }
    .entry:first-child {
      padding-top: 0;
      border-top: 0;
    }
    /* Tall enough that a new exchange can reach the top, whatever its length. */
    .latest {
      min-height: 100%;
    }
    .question {
      display: flex;
      gap: 0.5rem;
      margin: 0 0 0.5rem;
      color: var(--foreground);
      font-size: 0.9375rem;
      font-weight: 600;
      line-height: 1.5;
    }
    .prompt {
      flex: none;
      color: var(--signal);
      font-family: var(--font-mono);
      font-weight: 500;
      user-select: none;
    }
    .said {
      min-width: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .about {
      margin-left: 0.75ch;
      color: var(--muted-foreground);
      font-weight: 400;
    }

    .empty {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .hint {
      margin: 0;
      color: var(--muted-foreground);
      font-size: 0.9375rem;
      line-height: 1.5;
      text-wrap: pretty;
    }
    .suggestions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .suggestion {
      min-height: 2.5rem;
      padding: 0.4375rem 0.75rem;
      border: 1px solid var(--border-strong);
      border-radius: 0.25rem;
      color: var(--foreground);
      font-size: 0.9375rem;
      line-height: 1.5;
      text-align: left;
      cursor: pointer;
    }
    @media (hover: hover) {
      .suggestion:hover {
        border-color: var(--accent-orange);
      }
    }
    .news {
      min-height: 1.5rem;
      color: var(--accent-orange);
      font-size: 0.875rem;
      text-align: left;
      text-decoration: underline;
      text-decoration-color: var(--border-strong);
      text-underline-offset: 0.25em;
      cursor: pointer;
    }
    @media (hover: hover) {
      .news:hover {
        text-decoration-color: var(--accent-orange);
      }
    }

    /* Near-instant work never flashes it. */
    .loading {
      margin: 0.75rem 0 0;
      color: var(--muted-foreground);
      font-size: 0.875rem;
      animation: appear 0s 200ms backwards;
    }
    @keyframes appear {
      from {
        opacity: 0;
      }
    }

    .choice {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
      padding-top: 0.75rem;
      font-size: 0.9375rem;
    }
    .asks {
      color: var(--accent-orange);
    }
    .what {
      flex-basis: 100%;
      color: var(--muted-foreground);
      font-size: 0.8125rem;
    }
    .ghost {
      min-height: 1.75rem;
      padding-inline: 0.625rem;
      border: 1px solid var(--border-strong);
      border-radius: 0.25rem;
      cursor: pointer;
    }
    @media (hover: hover) {
      .ghost:hover {
        border-color: var(--accent-orange);
      }
    }
    .quiet {
      min-height: 1.5rem;
      margin-top: 0.25rem;
      color: var(--muted-foreground);
      font-size: 0.75rem;
      cursor: pointer;
    }
    @media (hover: hover) {
      .quiet:hover {
        color: var(--foreground);
      }
    }

    .composer {
      display: flex;
      flex: none;
      align-items: flex-end;
      gap: 0.5rem;
      min-height: 3rem;
      margin: 0.5rem 1rem 0;
      padding: 0.1875rem 0.1875rem 0.1875rem 0.75rem;
      border: 1px solid var(--input-line);
      border-radius: 0.25rem;
    }
    .composer:focus-within {
      border-color: var(--accent-orange);
      box-shadow: 0 0 0 1px var(--accent-orange);
    }
    /* Forced colours keep one border colour and no shadow. */
    @media (forced-colors: active) {
      .composer:focus-within {
        outline: 2px solid Highlight;
      }
    }
    .composer .prompt {
      align-self: flex-start;
      padding-block: 0.5rem;
      line-height: 1.5;
    }
    .prompt-input {
      display: block;
      flex: 1;
      min-width: 0;
      margin: 0;
      padding-block: 0.5rem;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--foreground);
      font: inherit;
      /* iOS zooms into a field under 16px when it takes focus. */
      font-size: 1rem;
      line-height: 1.5;
      resize: none;
      overflow-y: hidden;
    }
    .prompt-input::placeholder {
      color: var(--muted-foreground);
      opacity: 1;
    }
    .send {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 2.5rem;
      height: 2.5rem;
      border: 1px solid var(--border-strong);
      border-radius: 0.25rem;
      color: var(--muted-foreground);
      cursor: pointer;
    }
    @media (hover: hover) {
      .send:hover {
        color: var(--foreground);
      }
    }
    .send:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .count {
      flex: none;
      margin: 0.25rem 1rem 0;
      color: var(--muted-foreground);
      font-size: 0.75rem;
    }
    .count.over {
      color: var(--destructive);
    }
    /* Named only once Cloudflare asks the visitor (services/turnstile.ts). */
    .check {
      flex: none;
      padding-inline: 1rem;
    }
    .check[data-asking] {
      padding-block: 0.5rem;
    }
    .check[data-asking]::before {
      content: attr(data-label);
      display: block;
      margin-bottom: 0.25rem;
      color: var(--muted-foreground);
      font-size: 0.8125rem;
    }

    .commands {
      display: flex;
      flex: none;
      flex-wrap: wrap;
      gap: 0 0.875rem;
      margin: 0.375rem 1rem 0;
      color: var(--muted-foreground);
      font-family: var(--font-mono);
      font-size: 0.8125rem;
    }
    .commands button {
      min-height: 1.5rem;
      text-align: left;
      cursor: pointer;
    }
    @media (hover: hover) {
      .commands button:hover {
        color: var(--foreground);
      }
    }
    .ai-note {
      flex: none;
      margin: 0.125rem 1rem 0.875rem;
      color: var(--muted-foreground);
      font-size: 0.75rem;
      line-height: 1.5;
      text-wrap: pretty;
    }

    @media (pointer: coarse) {
      .suggestion,
      .ghost,
      .commands button {
        min-height: 2.75rem;
      }
      .commands button {
        min-width: 2.75rem;
      }
      .quiet,
      .news {
        min-height: 2.75rem;
      }
      .send {
        width: 2.75rem;
        height: 2.75rem;
      }
      .prompt-input {
        min-height: 2.75rem;
      }
    }
  `,
})
export class AskConsoleComponent {
  /** It stands on home's stage, not in the panel (plan 4 U11b). */
  readonly stage = input(false);

  protected readonly store = inject(AskStore);
  protected readonly lang = inject(LanguageService);
  private readonly launcher = inject(AskLauncherService);

  protected readonly commands = computed(() => commandRow(this.launcher.scorecard()));
  protected readonly copy = this.store.copy;
  protected readonly inputId = `ask-input-${++instances}`;
  protected readonly hintId = `ask-hint-${instances}`;
  protected readonly forgetId = `ask-forget-${instances}`;
  protected readonly newsId = `ask-news-${instances}`;
  protected readonly countId = `ask-count-${instances}`;

  private readonly inputRef = viewChild.required<ElementRef<HTMLTextAreaElement>>("input");
  private readonly logRef = viewChild.required<ElementRef<HTMLElement>>("log");
  private readonly check = viewChild.required<ElementRef<HTMLElement>>("check");

  /** The prompt's length, for the counter that shows near the limit (plan 4 U12). */
  private readonly length = signal(0);
  protected readonly nearLimit = computed(() => this.length() > this.store.maxChars() * 0.8);
  protected readonly tooLong = computed(() => this.length() > this.store.maxChars());
  protected readonly counter = computed(() => {
    const max = this.store.maxChars();
    const line = counterLine(this.length(), this.copy().match, this.lang.lang(), max);
    return this.tooLong() ? `${this.tooLongText()} ${line}` : line;
  });
  private readonly tooLongText = computed(() =>
    fmt(this.copy().errors.tooLong, { n: this.store.maxChars() }),
  );
  /** A rate limit holds: send waits, and the question stays in the prompt. */
  protected readonly limited = signal(false);
  /** The output just copied, for its button's "copied ✓". */
  protected readonly copiedOutput = signal<{ id: string; result: CopyResult } | null>(null);
  /** Where ↑/↓ are in the history; null while typing something new. */
  private historyIndex: number | null = null;
  private draft = "";

  protected readonly starters = computed(() => ASK_ENTRY_COPY[this.lang.lang()]);
  /** About this page on a case study or a post; else three of the admin's, or the built-in three. */
  protected readonly suggestions = computed(() => {
    const page = pageQuestions(this.lang.page(), this.lang.content(), this.copy().pageQuestions);
    if (page) return page;
    const own = this.store.remote()?.suggestions[this.lang.lang()];
    return own?.length ? own.slice(0, 3) : this.starters().starters;
  });
  protected readonly status = computed(() => this.store.chat.status);
  protected readonly busy = computed(() => ["submitted", "streaming"].includes(this.status()));
  /** Where the tour is (visitor plan V16): "tour · stop 2 of 5 · Atlas", or its stops before the first. */
  protected readonly tourLabel = computed(() => {
    const tour = this.store.tour();
    if (!tour) return "";
    const copy = this.copy().tour;
    const stop = tour.stops[tour.at];
    return stop
      ? fmt(copy.group, { k: tour.at + 1, n: tour.stops.length, title: stop.title })
      : fmt(copy.groupBefore, { n: tour.stops.length });
  });
  /** "more like this": once per tour, from a page the server can plan from, while it answers. */
  protected readonly canReplan = computed(() => {
    const tour = this.store.tour();
    return !!tour && !tour.replanned && this.store.available() && replannable(tour.stops[tour.at]);
  });
  /** "3 updates since Sep 12", while what's new is on and something changed (visitor plan V15). */
  protected readonly newsLine = computed(() => {
    const news = this.store.news();
    return news?.count ? newsCount(news.count, news.since, this.lang.lang()) : null;
  });

  protected readonly answers = computed(() => answersByQuestion(this.store.chat.messages));

  protected readonly latestAskId = computed(() => {
    const entries: Entry[] = this.store.entries();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]!.kind === "ask") return entries[i]!.id;
    }
    return null;
  });
  protected readonly liveId = computed(() => (this.busy() ? this.latestAskId() : null));

  constructor() {
    // What the panel's title bar says: the server's word, once it has one
    // (a failed answer can put the assistant to rest mid-conversation).
    effect(() => {
      const remote = this.store.remote();
      if (!remote) return;
      this.launcher.assistant.set(remote.state === "ok" ? "online" : "resting");
      if (remote.scorecard !== undefined) this.launcher.scorecard.set(remote.scorecard);
    });

    effect((onCleanup) => {
      const left = (this.store.limitedUntil() ?? 0) - Date.now();
      if (left <= 0) return;
      this.limited.set(true);
      const timer = setTimeout(() => this.limited.set(false), left);
      onCleanup(() => {
        clearTimeout(timer);
        this.limited.set(false);
      });
    });

    // What the stage reads without loading any of this.
    effect(() => {
      const asked = this.store.entries().findLast((entry) => entry.kind === "ask");
      this.launcher.lastQuestion.set(asked?.input ?? null);
    });

    // On the stage nobody hands it a request: the panel does that for its console.
    afterRenderEffect(() => {
      if (this.stage() && this.launcher.takeFocus()) this.claim();
    });

    afterNextRender(() => (this.launcher.turnstileHost = this.check().nativeElement));
    inject(DestroyRef).onDestroy(() => {
      this.launcher.turnstileHost = null;
      // Leaving home mid-answer or mid-tour, the panel carries on (plan 4 U11b).
      if (this.stage() && (this.busy() || this.store.tour())) this.launcher.openPanel();
    });

    // A new exchange goes to the top, once; what it writes grows beneath it (NN/g: no autoscroll).
    let newest: string | undefined;
    afterRenderEffect(() => {
      const id = this.store.entries().at(-1)?.id;
      if (id === newest) return;
      newest = id;
      this.toNewest();
    });
  }

  /** Only the log moves: `scrollIntoView` would take the page along. */
  private toNewest(): void {
    const log = this.logRef().nativeElement;
    const latest = log.querySelector<HTMLElement>(".latest");
    if (latest) log.scrollTop = latest.offsetTop;
  }

  focusInput(): void {
    // The stage is on screen, and the page never moves for it.
    this.inputRef().nativeElement.focus({ preventScroll: this.stage() });
  }

  /**
   * Takes a request from elsewhere on the site: the focus, and its question if
   * it brought one, with what a reader pointed at (visitor plan V9); a shared
   * link's question goes in the prompt unsent (V17).
   */
  claim(): void {
    // Its first question can come before the first render's callback has run.
    this.launcher.turnstileHost = this.check().nativeElement;
    const source = this.launcher.takeSource();
    this.reportOpen(source);
    this.toNewest();
    // A shared link's question (visitor plan V17): in the prompt, for the visitor to send or not.
    const draft = this.launcher.takeDraft();
    if (draft) this.setValue(draft);
    const question = this.launcher.takeQuestion();
    const about = this.launcher.takeAbout();
    if (question) this.send(question, about ?? undefined);
    if (!this.onPhone() || TYPING.has(source)) this.focusInput();
  }

  /** Where the panel is a sheet, and a focused prompt an on-screen keyboard over what was asked for. */
  private onPhone(): boolean {
    return this.launcher.narrow();
  }

  /** After a button: back to the prompt, or on a phone to the log, keeping the keyboard down. */
  protected refocus(): void {
    if (this.onPhone()) this.logRef().nativeElement.focus({ preventScroll: true });
    else this.focusInput();
  }

  /** `ask_open`, once per page load, with where the visitor came from. */
  protected reportOpen(source: AskSource): void {
    if (this.launcher.opened) return;
    this.launcher.opened = true;
    track("ask_open", { source });
  }

  /** Runs what is in the prompt. */
  protected submit(): void {
    const el = this.inputRef().nativeElement;
    const text = el.value;
    if (!text.trim()) return;
    if (parseInput(text).kind === "ask") {
      // One answer at a time; shell commands still run meanwhile. The words stay in the prompt.
      if (this.busy() || this.limited()) return;
      if (this.tooLong()) {
        this.store.announce(this.tooLongText());
        return;
      }
    }
    el.value = "";
    this.historyIndex = null;
    this.grow();
    void this.store.submit(text);
  }

  /**
   * A question or command from a button, the ⋯ menu or a reader, with what it is about: what the
   * visitor is typing stays. While an answer runs, or when it is too long, a question waits in the
   * prompt instead.
   */
  send(text: string, about?: AskAbout): void {
    const question = parseInput(text).kind === "ask";
    if (question && (this.busy() || text.length > this.store.maxChars())) this.setValue(text);
    else void this.store.submit(text, about);
    this.refocus();
  }

  /** The composer's button, which otherwise submits the form. */
  protected stopIfBusy(): void {
    if (this.busy()) this.store.stop();
  }

  /** A command that needs a word of the visitor's: in the prompt, to finish. */
  protected fill(text: string): void {
    this.setValue(text);
    this.focusInput();
  }

  /** The paste box's brief, sent; the prompt takes the focus back (visitor plan V20). */
  protected sendMatch(kind: MatchKind, brief: string): void {
    void this.store.sendMatch(kind, brief, "terminal");
    this.refocus();
  }

  protected dismissMatch(): void {
    this.store.cancelMatch();
    this.refocus();
  }

  /** A starter question from the empty console. */
  protected start(question: string): void {
    this.reportOpen("starter");
    this.send(question);
  }

  /** An answer's "inspect": its timeline comes as the log's newest entry. */
  protected inspectAnswer(messageId: string): void {
    void this.store.inspect(messageId);
  }

  protected async copyOutput(id: string, text: string): Promise<void> {
    this.copiedOutput.set({ id, result: await copyText(text) });
    setTimeout(() => this.copiedOutput.set(null), COPIED_MS);
  }

  private handleArrowKey(event: KeyboardEvent, el: HTMLTextAreaElement): boolean {
    if (event.key === "ArrowUp") {
      const before = el.value.slice(0, el.selectionStart);
      if (!before.includes("\n") && this.recall(-1)) {
        event.preventDefault();
        return true;
      }
    } else if (event.key === "ArrowDown") {
      const after = el.value.slice(el.selectionEnd);
      if (!after.includes("\n") && this.recall(1)) {
        event.preventDefault();
        return true;
      }
    }
    return false;
  }

  private handleTabKey(event: KeyboardEvent, el: HTMLTextAreaElement): boolean {
    if (event.key !== "Tab" || event.shiftKey || !el.value) return false;
    const completed = complete(el.value, this.lang.content());
    if (completed) {
      event.preventDefault();
      this.setValue(completed);
      return true;
    }
    return false;
  }

  private handleShortcutKey(event: KeyboardEvent, el: HTMLTextAreaElement): void {
    const key = event.key.toLowerCase();
    const mod = event.ctrlKey || event.metaKey;

    if (mod && key === "c" && this.busy() && el.selectionStart === el.selectionEnd) {
      event.preventDefault();
      this.store.stop();
    } else if (event.ctrlKey && key === "l") {
      event.preventDefault();
      this.store.clear();
    }
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.isComposing) return;
    const el = this.inputRef().nativeElement;

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.submit();
      return;
    }
    if (this.handleArrowKey(event, el) || this.handleTabKey(event, el)) return;
    this.handleShortcutKey(event, el);
  }

  protected onInput(): void {
    this.historyIndex = null;
    this.grow();
  }

  /** ↑ older, ↓ newer; true when it moved. */
  private recall(direction: -1 | 1): boolean {
    const history = this.store.history();
    if (!history.length) return false;
    if (this.historyIndex === null) {
      if (direction === 1) return false;
      this.draft = this.inputRef().nativeElement.value;
      this.historyIndex = history.length - 1;
    } else {
      const next = this.historyIndex + direction;
      if (next < 0) return true;
      if (next >= history.length) {
        this.historyIndex = null;
        this.setValue(this.draft);
        return true;
      }
      this.historyIndex = next;
    }
    this.setValue(history[this.historyIndex]!, false);
    return true;
  }

  private setValue(text: string, resetHistory = true): void {
    const el = this.inputRef().nativeElement;
    el.value = text;
    el.setSelectionRange(text.length, text.length);
    if (resetHistory) this.historyIndex = null;
    this.grow();
  }

  private grow(): void {
    const el = this.inputRef().nativeElement;
    this.length.set(el.value.length);
    el.style.height = "auto";
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
    const max = line * MAX_INPUT_LINES;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }
}
