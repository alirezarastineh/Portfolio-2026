import { DOCUMENT } from "@angular/common";
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
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from "@angular/core";

import { LanguageService } from "../services/language.service";
import { AskAnswerComponent } from "./ask-answer.component";
import { AskLauncherService } from "./ask-launcher.service";
import { AskLinesComponent } from "./ask-lines.component";
import { AskStore } from "./ask.store";
import type { AskMessage, Entry } from "./ask-types";
import { complete, parseInput } from "./commands";
import { track } from "./track";

let instances = 0;
const MAX_INPUT_LINES = 6;

/**
 * The live prompt of the About terminal (and of the sheet on other pages): a
 * real shell whose main command is the AI assistant. Enter sends, Shift+Enter
 * adds a line, ↑/↓ recall history, Tab completes, Ctrl+C stops an answer,
 * Ctrl+L clears, Esc leaves. The transcript is a log whose finished answers
 * are announced once through a polite live region, never token by token.
 * On a phone, focusing the prompt opens the terminal full screen.
 */
@Component({
  selector: "app-terminal-shell",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AskAnswerComponent, AskLinesComponent],
  host: { class: "block" },
  template: `
    <div #frame [class]="frameClass()">
      @if (expanded()) {
        <div class="flex items-center justify-between border-b border-border py-2">
          <span class="text-xs text-muted-foreground">{{ lang.t().ask.title }}</span>
          <button
            type="button"
            class="cursor-pointer rounded px-2 py-1 text-muted-foreground hover:text-foreground"
            [attr.aria-label]="copy().close"
            (click)="collapse()"
          >
            ✕
          </button>
        </div>
      }

      <div
        #log
        role="log"
        aria-live="off"
        [attr.aria-label]="lang.t().ask.title"
        [class]="logClass()"
        (scroll)="onScroll()"
      >
        @for (entry of store.entries(); track entry.id) {
          <div class="pt-1">
            <!-- prettier-ignore -->
            <p class="m-0 flex flex-wrap items-baseline gap-x-2"><span class="text-accent-orange" aria-hidden="true">{{ prompt() }}</span><span class="sr-only">{{ copy().you }}:</span><span class="min-w-0 whitespace-pre-wrap wrap-break-word text-foreground">{{ entry.input }}</span></p>
            @if (entry.kind === "local") {
              <app-ask-lines class="pb-3" [lines]="entry.lines" />
            } @else {
              <app-ask-answer
                [entry]="entry"
                [message]="answers().get(entry.userId)"
                [live]="entry.id === liveId()"
                [status]="status()"
                [latest]="entry.id === latestAskId()"
                (ask)="send($event)"
                (retry)="store.retry(entry.id)"
              />
            }
          </div>
        }
        @if (store.handoff(); as handoff) {
          <div
            class="flex flex-wrap items-center gap-2 pb-3"
            role="group"
            [attr.aria-label]="copy().handoff.ask"
          >
            <span class="text-accent-orange">{{ copy().handoff.ask }}</span>
            <button
              type="button"
              class="cursor-pointer rounded-md border border-border px-2 py-0.5 hover:border-accent-orange"
              (click)="store.answerHandoff(true)"
            >
              {{ copy().handoff.yes }}
            </button>
            <button
              type="button"
              class="cursor-pointer rounded-md border border-border px-2 py-0.5 hover:border-accent-orange"
              (click)="store.answerHandoff(false)"
            >
              {{ copy().handoff.no }}
            </button>
          </div>
        }
      </div>

      <form
        class="mt-1 flex items-start gap-2"
        [class.invisible]="!active()"
        (submit)="$event.preventDefault(); submit()"
      >
        <label [for]="inputId" class="shrink-0 select-none text-accent-orange"
          >{{ prompt() }}<span class="sr-only"> {{ copy().inputLabel }}</span></label
        >
        <span class="relative min-w-0 grow">
          @if (showIdleCaret()) {
            <span
              class="terminal-caret pointer-events-none absolute left-0 top-[0.3em]"
              aria-hidden="true"
            ></span>
          }
          <textarea
            #input
            [id]="inputId"
            rows="1"
            class="terminal-input"
            [style.padding-left]="showIdleCaret() ? '1.2ch' : null"
            [attr.placeholder]="lang.t().ask.placeholder"
            [attr.aria-describedby]="hintId"
            [attr.tabindex]="active() ? null : -1"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            enterkeyhint="send"
            (keydown)="onKey($event)"
            (input)="onInput()"
            (focus)="onFocus()"
            (blur)="focused.set(false)"
          ></textarea>
        </span>
      </form>
      <p [id]="hintId" class="m-0 mt-1 text-xs text-muted-foreground" [class.invisible]="!active()">
        {{ lang.t().ask.hint }} · {{ lang.t().ask.disclosure }}
      </p>

      <div class="sr-only" aria-live="polite" aria-atomic="true">{{ store.announcement() }}</div>
    </div>
  `,
  styles: `
    .terminal-input {
      display: block;
      width: 100%;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--foreground);
      font: inherit;
      line-height: inherit;
      resize: none;
      overflow-y: hidden;
      caret-color: var(--accent-orange);
    }
    .terminal-input::placeholder {
      color: var(--muted-foreground);
      opacity: 0.75;
    }
  `,
})
export class TerminalShellComponent {
  /** False while the About intro is still typing: the prompt keeps its place, hidden. */
  readonly active = input(true);
  /** In the sheet on other pages, which is full screen on phones already. */
  readonly inSheet = input(false);

  protected readonly store = inject(AskStore);
  protected readonly lang = inject(LanguageService);
  private readonly launcher = inject(AskLauncherService);
  private readonly doc = inject(DOCUMENT);

  protected readonly copy = this.store.copy;
  protected readonly inputId = `ask-input-${++instances}`;
  protected readonly hintId = `ask-hint-${instances}`;

  private readonly inputRef = viewChild.required<ElementRef<HTMLTextAreaElement>>("input");
  private readonly logRef = viewChild.required<ElementRef<HTMLElement>>("log");
  private readonly frameRef = viewChild.required<ElementRef<HTMLElement>>("frame");

  protected readonly expanded = signal(false);
  protected readonly focused = signal(false);
  private readonly value = signal("");
  /** Where ↑/↓ are in the history; null while typing something new. */
  private historyIndex: number | null = null;
  private draft = "";
  /** Follow the stream down unless the reader scrolled up to read. */
  private stick = true;
  private opened = false;

  protected readonly prompt = computed(() => this.lang.t().about.terminalPrompt);
  protected readonly status = computed(() => this.store.chat.status);
  protected readonly busy = computed(() => ["submitted", "streaming"].includes(this.status()));
  protected readonly showIdleCaret = computed(() => !this.focused() && !this.value());

  /** Each question's answer: the assistant message right after it. */
  protected readonly answers = computed(() => {
    const messages: AskMessage[] = this.store.chat.messages;
    const map = new Map<string, AskMessage>();
    messages.forEach((m, i) => {
      const next = messages[i + 1];
      if (m.role === "user" && next?.role === "assistant") map.set(m.id, next);
    });
    return map;
  });

  protected readonly latestAskId = computed(() => {
    const entries: Entry[] = this.store.entries();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]!.kind === "ask") return entries[i]!.id;
    }
    return null;
  });
  protected readonly liveId = computed(() => (this.busy() ? this.latestAskId() : null));

  protected readonly frameClass = computed(() =>
    this.expanded()
      ? "ask-expanded fixed inset-x-0 top-0 z-[70] flex flex-col bg-card px-4 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-[env(safe-area-inset-top)] font-mono text-sm leading-[1.7]"
      : "flex flex-col",
  );
  protected readonly logClass = computed(() =>
    this.expanded() ? "min-h-0 grow overflow-y-auto pt-2" : "max-h-[32rem] overflow-y-auto",
  );

  constructor() {
    // A request from the hero link or the palette, once the prompt can take
    // it (after this render; the sheet focuses its own after opening).
    const injector = inject(Injector);
    effect(() => {
      if (!this.launcher.focusPending() || !this.active() || this.inSheet()) return;
      untracked(() =>
        afterNextRender(
          () => {
            if (this.launcher.takeFocus()) this.focusInput();
          },
          { injector },
        ),
      );
    });

    // Keep the newest output in view while it streams.
    afterRenderEffect(() => {
      this.store.entries();
      this.store.handoff();
      const log = this.logRef().nativeElement;
      if (this.store.chat.messages && this.stick) log.scrollTop = log.scrollHeight;
    });

    const destroyRef = inject(DestroyRef);
    const onViewport = () => this.fitViewport();
    effect(() => {
      const vv = this.doc.defaultView?.visualViewport;
      const root = this.doc.documentElement;
      if (this.expanded()) {
        root.classList.add("overflow-hidden");
        vv?.addEventListener("resize", onViewport);
        vv?.addEventListener("scroll", onViewport);
        untracked(() => this.fitViewport());
      } else {
        root.classList.remove("overflow-hidden");
        vv?.removeEventListener("resize", onViewport);
        vv?.removeEventListener("scroll", onViewport);
      }
    });
    destroyRef.onDestroy(() => {
      this.doc.documentElement.classList.remove("overflow-hidden");
      const vv = this.doc.defaultView?.visualViewport;
      vv?.removeEventListener("resize", onViewport);
      vv?.removeEventListener("scroll", onViewport);
    });
  }

  focusInput(): void {
    const el = this.inputRef().nativeElement;
    el.focus({ preventScroll: false });
  }

  /** Runs what is in the prompt. */
  protected submit(): void {
    const el = this.inputRef().nativeElement;
    const text = el.value;
    if (!text.trim()) return;
    // One answer at a time; shell commands still run meanwhile.
    if (this.busy() && parseInput(text).kind === "ask") return;
    el.value = "";
    this.value.set("");
    this.historyIndex = null;
    this.stick = true;
    this.grow();
    void this.store.submit(text);
  }

  protected send(text: string): void {
    const el = this.inputRef().nativeElement;
    el.value = text;
    this.submit();
    el.focus();
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
    } else if (event.key === "Escape") {
      if (this.expanded()) this.collapse();
      else el.blur();
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
    this.value.set(this.inputRef().nativeElement.value);
    this.historyIndex = null;
    this.grow();
  }

  protected onFocus(): void {
    this.focused.set(true);
    if (!this.opened) {
      this.opened = true;
      track("ask_open");
    }
    const narrow = this.doc.defaultView?.matchMedia("(max-width: 639px)").matches;
    if (narrow && !this.inSheet() && !this.expanded()) {
      this.expanded.set(true);
      // The element moved; keep the keyboard on it.
      queueMicrotask(() => this.inputRef().nativeElement.focus({ preventScroll: true }));
    }
  }

  protected collapse(): void {
    this.expanded.set(false);
    const frame = this.frameRef().nativeElement;
    frame.style.height = "";
    frame.style.transform = "";
    this.inputRef().nativeElement.blur();
  }

  protected onScroll(): void {
    const log = this.logRef().nativeElement;
    this.stick = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
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
    this.value.set(text);
    if (resetHistory) this.historyIndex = null;
    this.grow();
  }

  private grow(): void {
    const el = this.inputRef().nativeElement;
    el.style.height = "auto";
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
    const max = line * MAX_INPUT_LINES;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }

  /** Full screen above the on-screen keyboard. */
  private fitViewport(): void {
    const frame = this.frameRef().nativeElement;
    const vv = this.doc.defaultView?.visualViewport;
    frame.style.height = vv ? `${vv.height}px` : "100dvh";
    frame.style.transform = vv ? `translateY(${vv.offsetTop}px)` : "";
  }
}
