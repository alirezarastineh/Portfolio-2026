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
  signal,
  untracked,
} from "@angular/core";

import { SectionHeadingComponent } from "../components/section-heading.component";
import { TerminalWindowComponent } from "../components/terminal-window.component";
import { CHROME } from "../i18n/chrome";
import { prefersReducedMotion, runFrames } from "../motion/frames";
import { LanguageService } from "../services/language.service";
import { typingAt, type TerminalLine, type TypingState } from "./about-typing";

/**
 * The About section: a terminal session. The server renders every line, so
 * the text is there for readers without JavaScript and for search engines.
 * In the browser, if the section has not been seen yet, it types itself out
 * the first time it scrolls into view. Text not yet typed keeps its place
 * (hidden, not removed), so nothing below it moves; "skip" shows it all.
 * Reduced motion never animates. Phase 7 turns the prompt into the assistant.
 */
@Component({
  selector: "app-about-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SectionHeadingComponent, TerminalWindowComponent],
  host: {
    class: "block",
  },
  template: `
    <section
      id="about"
      aria-labelledby="about-heading"
      class="relative px-6 py-24 sm:px-8 sm:py-28 lg:px-12 lg:py-32"
    >
      <div class="mx-auto flex max-w-205 flex-col gap-12">
        <app-section-heading
          headingId="about-heading"
          [heading]="lang.t().about.heading"
          [eyebrow]="lang.t().about.subtitle"
        />

        <div class="relative">
          <app-terminal-window [title]="lang.t().about.terminalTitle">
            @if (typing(); as state) {
              <!-- Read in full by assistive technology while it types. -->
              <div class="sr-only">
                @for (line of lines(); track $index) {
                  <p>{{ line.prompt }} {{ line.command }}</p>
                  <p>{{ line.output }}</p>
                }
              </div>
            }
            <div class="flex flex-col" [attr.aria-hidden]="typing() ? 'true' : null">
              @for (line of lines(); track $index; let i = $index) {
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <span class="text-accent-orange" [class.invisible]="!started(i)">{{
                    line.prompt
                  }}</span>
                  <!-- prettier-ignore -->
                  <span class="text-foreground"
                    >{{ shown(line.command, i, "cmd")
                    }}@if (caretAt(i, "cmd")) {<span class="terminal-caret" aria-hidden="true"></span>}<span
                      class="invisible"
                      >{{ hidden(line.command, i, "cmd") }}</span
                    ></span
                  >
                </div>
                <!-- Typed and untyped text must touch: no whitespace in between, or
                     it would render (pre-wrap) and shift the text as it types. -->
                <!-- prettier-ignore -->
                <p
                  class="m-0 mt-1 max-w-[78ch] whitespace-pre-wrap pb-3 leading-relaxed text-foreground/85"
                >{{ shown(line.output, i, "out")
                  }}@if (caretAt(i, "out")) {<span class="terminal-caret" aria-hidden="true"></span>}<span
                    class="invisible"
                    >{{ hidden(line.output, i, "out") }}</span
                  ></p>
              }
              <div class="mt-1 flex items-baseline gap-2" [class.invisible]="!finished()">
                <span class="text-accent-orange">{{ lang.t().about.terminalPrompt }}</span>
                <span class="terminal-caret" aria-hidden="true"></span>
              </div>
            </div>
          </app-terminal-window>

          @if (typing()) {
            <!-- Its name starts with the visible word, so voice control finds it. -->
            <button
              type="button"
              class="absolute right-3 top-1.5 cursor-pointer rounded-md px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              (click)="skip()"
            >
              {{ chrome().skip }}<span class="sr-only">: {{ chrome().skipLabel }}</span
              ><span aria-hidden="true"> ▸</span>
            </button>
          }
        </div>
      </div>
    </section>
  `,
})
export class AboutSectionComponent {
  readonly lang = inject(LanguageService);

  readonly lines = computed<TerminalLine[]>(() => {
    const t = this.lang.t().about;
    const prompt = t.terminalPrompt;
    return [
      { prompt, command: "whoami", output: t.terminalOutputWhoami },
      { prompt, command: "cat philosophy.txt", output: t.philosophy },
      { prompt, command: "ls skills/", output: t.terminalOutputLs },
      { prompt, command: "cat contact.txt", output: t.terminalOutputContact },
    ];
  });

  protected readonly chrome = computed(() => CHROME[this.lang.lang()].about);

  /** Null when everything is shown: on the server, with reduced motion, and once done. */
  protected readonly typing = signal<TypingState | null>(null);
  protected readonly finished = computed(() => this.typing() === null);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private observer?: IntersectionObserver;
  private stop?: () => void;

  constructor() {
    afterNextRender(() => this.arm());

    // New copy (a language switch) shows in full at once, never retyped.
    effect(() => {
      this.lines();
      untracked(() => this.skip());
    });

    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      this.stop?.();
    });
  }

  protected started(i: number): boolean {
    const state = this.typing();
    return !state || i <= state.line;
  }

  protected shown(text: string, i: number, part: "cmd" | "out"): string {
    const state = this.typing();
    return state ? text.slice(0, state[part][i]) : text;
  }

  protected hidden(text: string, i: number, part: "cmd" | "out"): string {
    const state = this.typing();
    return state ? text.slice(state[part][i]) : "";
  }

  protected caretAt(i: number, part: "cmd" | "out"): boolean {
    const state = this.typing();
    return !!state && state.line === i && state.part === part;
  }

  skip(): void {
    this.observer?.disconnect();
    this.stop?.();
    this.stop = undefined;
    this.typing.set(null);
  }

  /**
   * Types only for a reader who has not seen the text yet: if the section is
   * already on screen when the page becomes interactive (a link to #about),
   * it stays as it is.
   */
  private arm(): void {
    // Render hooks run during the server render here too.
    if (!this.isBrowser || prefersReducedMotion()) return;
    let first = true;
    this.observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        if (first) {
          first = false;
          if (visible) {
            this.observer?.disconnect();
            return;
          }
          this.typing.set(typingAt(this.lines(), 0));
          return;
        }
        if (visible) {
          this.observer?.disconnect();
          this.run();
        }
      },
      { threshold: 0.3 },
    );
    this.observer.observe(this.host.nativeElement);
  }

  private run(): void {
    const lines = this.lines();
    let elapsed = 0;
    this.stop = runFrames((dt) => {
      if (!this.typing()) return false;
      elapsed += dt * 1000;
      const state = typingAt(lines, elapsed);
      if (state.part === "done") {
        this.typing.set(null);
        this.stop = undefined;
        return false;
      }
      this.typing.set(state);
      return true;
    });
  }
}
