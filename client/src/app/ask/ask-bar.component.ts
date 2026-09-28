import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  PLATFORM_ID,
  untracked,
  viewChild,
} from "@angular/core";
import { Router } from "@angular/router";

import { prefersReducedMotion } from "../motion/frames";
import { LanguageService } from "../services/language.service";
import { ASK_ENTRY_COPY } from "./ask-entry-copy";
import { ASK_BAR_ID, AskLauncherService, type AskSource } from "./ask-launcher.service";
import { placeholderSteps } from "./placeholder-typing";

/**
 * The hero's way into the assistant: a prompt that sends its question straight
 * to the About terminal, which answers it there. The placeholder types a few
 * starter questions in turn, and the same questions sit below as chips that
 * send at once.
 *
 * Before the app is interactive the form still works: it goes to the
 * terminal (`action`), though the question itself is not carried over. Event
 * replay would not help: the browser submits the form before Angular could
 * replay the event.
 */
@Component({
  selector: "app-ask-bar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "flex flex-col gap-3" },
  template: `
    <form #form method="get" [attr.action]="'/' + lang.lang() + '#about'" (submit)="submit($event)">
      <div
        class="relative flex h-14 items-center gap-2 rounded-lg border border-border-strong bg-card pl-4 pr-1.5 shadow-e1 transition-[border-color,box-shadow] duration-(--dur-3) focus-within:border-accent-orange focus-within:shadow-glow motion-reduce:transition-none"
      >
        <!-- Sits on the top border, like a panel title in a terminal UI. -->
        <label
          class="absolute -top-2.5 left-3 rounded-sm bg-[linear-gradient(to_bottom,var(--background)_50%,var(--card)_50%)] px-1.5 font-mono text-label text-muted-foreground"
          [for]="inputId"
          >{{ lang.t().hero.askCta }}</label
        >
        <span class="shrink-0 font-mono text-meta text-accent-orange" aria-hidden="true"
          ><span class="max-sm:hidden">{{ promptHost() }}</span
          >{{ promptPath() }}</span
        >
        <input
          #input
          type="text"
          class="h-full min-w-0 grow bg-transparent font-mono text-base text-foreground caret-accent-orange placeholder:text-muted-foreground focus:outline-none"
          [id]="inputId"
          [attr.placeholder]="copy().starters[0]"
          aria-keyshortcuts="/"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          enterkeyhint="send"
          (focus)="pause()"
          (blur)="resume()"
        />
        <button
          type="submit"
          class="press inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          [attr.aria-label]="copy().send"
        >
          <span class="kbd">↵</span>
        </button>
      </div>
    </form>

    <div
      class="flex flex-wrap items-center gap-2"
      role="group"
      [attr.aria-label]="copy().suggestions"
    >
      <span class="font-mono text-meta text-muted-foreground" aria-hidden="true">{{
        copy().try
      }}</span>
      @for (question of copy().starters; track question) {
        <button
          type="button"
          class="chip press min-h-8 cursor-pointer px-2.5 text-left hover:border-border-strong hover:text-foreground"
          (click)="ask(question, 'starter')"
        >
          {{ question }}
        </button>
      }
    </div>
  `,
})
export class AskBarComponent {
  protected readonly lang = inject(LanguageService);
  private readonly launcher = inject(AskLauncherService);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly inputId = ASK_BAR_ID;
  protected readonly copy = computed(() => ASK_ENTRY_COPY[this.lang.lang()]);

  /** `user@portfolio:~$` from the CMS; phones get only `~$`. */
  private readonly prompt = computed(() => this.lang.t().about.terminalPrompt);
  protected readonly promptHost = computed(() => {
    const prompt = this.prompt();
    const at = prompt.lastIndexOf(":");
    return at > 0 ? prompt.slice(0, at + 1) : "";
  });
  protected readonly promptPath = computed(() => {
    const prompt = this.prompt();
    return prompt.slice(prompt.lastIndexOf(":") + 1);
  });

  private readonly form = viewChild.required<ElementRef<HTMLFormElement>>("form");
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>("input");

  private timer?: ReturnType<typeof setTimeout>;
  private observer?: IntersectionObserver;
  private inView = false;
  private typing = false;

  constructor() {
    afterNextRender(() => {
      if (!this.isBrowser || prefersReducedMotion()) return;
      this.typing = true;
      this.observer = new IntersectionObserver(([entry]) => {
        this.inView = entry?.isIntersecting ?? false;
        if (this.inView) this.resume();
        else this.pause();
      });
      this.observer.observe(this.form().nativeElement);
    });

    // Another language's questions start over from the first.
    effect(() => {
      this.copy();
      untracked(() => {
        if (!this.typing) return;
        this.pause();
        this.resume();
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.pause();
      this.observer?.disconnect();
    });
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const input = this.input().nativeElement;
    const text = input.value.trim();
    input.value = "";
    if (text) {
      this.ask(text, "hero");
    } else {
      // Nothing typed: go to the terminal all the same, as the form would.
      this.launcher.focusPrompt("hero");
      this.toTerminal();
    }
  }

  protected ask(question: string, source: AskSource): void {
    this.launcher.ask(question, source);
    this.toTerminal();
  }

  /** Stops typing and leaves the first question showing. */
  protected pause(): void {
    if (!this.typing) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.input().nativeElement.placeholder = this.copy().starters[0] ?? "";
  }

  /**
   * Types the questions while the bar is in view, unfocused and empty. Written
   * to the element directly, not through a binding: a change every 40ms would
   * otherwise run change detection just as often.
   */
  protected resume(): void {
    const input = this.input().nativeElement;
    if (!this.typing || !this.inView || this.timer || input.value) return;
    if (input.ownerDocument.activeElement === input) return;
    const steps = placeholderSteps(this.copy().starters);
    const first = steps.next();
    if (first.done) return;
    const tick = () => {
      const step = steps.next();
      if (step.done) return;
      input.placeholder = step.value.text;
      this.timer = setTimeout(tick, step.value.wait);
    };
    this.timer = setTimeout(tick, first.value.wait);
  }

  private toTerminal(): void {
    void this.router.navigate(["/", this.lang.lang()], { fragment: "about" });
  }
}
