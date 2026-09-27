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
  input,
  PLATFORM_ID,
  signal,
  untracked,
} from "@angular/core";

import { AskLauncherService } from "../ask/ask-launcher.service";
import { hasStoredConversation } from "../ask/ask-storage";
import { TerminalShellComponent } from "../ask/terminal-shell.component";
import { PictureComponent } from "../components/picture.component";
import { SectionHeadingComponent } from "../components/section-heading.component";
import {
  TerminalWindowComponent,
  type TerminalStatus,
} from "../components/terminal-window.component";
import { AVAILABILITY_DOT, availabilityLabel } from "../content/availability";
import { CONTENT_PREVIEW } from "../content/content-source";
import { placeName } from "../content/place";
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
 * Reduced motion never animates. The last line is the portfolio assistant's
 * prompt (`ask/terminal-shell.component.ts`), loaded lazily; once it knows
 * whether the assistant answers, the title bar says so. Beside the terminal
 * from `lg` (below it on phones), a card with the person: photo, bio and a few
 * facts.
 */
@Component({
  selector: "app-about-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PictureComponent,
    SectionHeadingComponent,
    TerminalShellComponent,
    TerminalWindowComponent,
  ],
  host: {
    class: "block",
  },
  template: `
    <section id="about" aria-labelledby="about-heading" class="container-site section-y relative">
      <div class="flex flex-col gap-12">
        <app-section-heading
          headingId="about-heading"
          [index]="index()"
          [heading]="lang.t().about.heading"
          [eyebrow]="lang.t().about.subtitle"
        />

        <div class="grid grid-cols-12 gap-x-(--col-gap) gap-y-8">
          <div class="relative col-span-12 lg:col-span-8">
            <app-terminal-window [title]="lang.t().about.terminalTitle" [status]="status()">
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
              </div>
              <!-- The live prompt: the assistant's shell, loaded as the section
                 nears the screen (or when asked for). Until then — and on the
                 server — the same prompt, caret and hint hold its place. Not
                 \`on viewport\`: that trigger runs during the server render here. -->
              @defer (when loadShell()) {
                <app-terminal-shell [active]="finished()" />
              } @placeholder {
                <div>
                  <div class="mt-1 flex items-baseline gap-2" [class.invisible]="!finished()">
                    <span class="text-accent-orange">{{ lang.t().about.terminalPrompt }}</span>
                    <span class="terminal-caret" aria-hidden="true"></span>
                  </div>
                  <p class="m-0 mt-1 text-xs text-muted-foreground" [class.invisible]="!finished()">
                    {{ lang.t().ask.hint }} · {{ lang.t().ask.disclosure }}
                  </p>
                </div>
              }
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

          <!-- The person at the prompt. -->
          <div class="surface-card col-span-12 flex flex-col gap-5 self-start p-6 lg:col-span-4">
            <div class="flex items-center gap-4">
              <div
                class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted font-mono text-muted-foreground"
              >
                @if (identity().avatar; as avatar) {
                  <app-picture
                    [image]="avatar"
                    alt=""
                    [sizes]="'64px'"
                    [imgClass]="'block size-full object-cover'"
                  />
                } @else {
                  <span aria-hidden="true">{{ initials() }}</span>
                }
              </div>
              <p class="m-0 flex min-w-0 flex-col">
                <span class="text-h4 text-foreground">{{ identity().name }}</span>
                <span class="font-mono text-meta text-muted-foreground">{{
                  identity().handle
                }}</span>
              </p>
            </div>
            @if (bio()) {
              <p class="m-0 text-pretty leading-relaxed text-muted-foreground">{{ bio() }}</p>
            }
            <dl class="m-0 flex flex-col gap-4 border-t border-border pt-5">
              @for (fact of facts(); track fact.label) {
                <div class="flex flex-col gap-1">
                  <dt class="eyebrow text-muted-foreground">{{ fact.label }}</dt>
                  <dd class="m-0 flex items-center gap-2 text-foreground">
                    @if (fact.dot) {
                      <span
                        class="size-2 shrink-0 rounded-full"
                        [class]="fact.dot"
                        aria-hidden="true"
                      ></span>
                    }
                    {{ fact.value }}
                  </dd>
                </div>
              }
            </dl>
          </div>
        </div>
      </div>
    </section>
  `,
})
export class AboutSectionComponent {
  /** The section's number on the home page, `01`; set by the page. */
  readonly index = input("");

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

  private readonly launcher = inject(AskLauncherService);

  /** `● online` once the prompt's code knows; not while the intro types (its skip button sits there). */
  protected readonly status = computed<TerminalStatus | null>(() => {
    const state = this.launcher.assistant();
    if (!state || this.typing()) return null;
    const online = state === "online";
    return { label: online ? this.chrome().online : this.chrome().resting, live: online };
  });

  protected readonly identity = computed(() => this.lang.content().identity);
  protected readonly bio = computed(() => this.lang.t().about.bio?.trim() ?? "");
  protected readonly initials = computed(() =>
    this.identity()
      .name.split(/\s+/)
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase(),
  );

  /** Where he is, since when he has worked (with work experience), and whether he is available. */
  protected readonly facts = computed(() => {
    const { identity, experiences } = this.lang.content();
    const t = this.lang.t();
    const c = this.chrome();
    // ISO dates: the smallest string is the earliest start.
    const since = experiences
      .filter((e) => e.kind === "work")
      .reduce<string>(
        (first, e) => (!first || e.period.start < first ? e.period.start : first),
        "",
      );
    return [
      {
        label: c.based,
        value: placeName(identity.location, this.lang.lang()) || t.profile.location,
        dot: "",
      },
      ...(since ? [{ label: c.since, value: since.slice(0, 4), dot: "" }] : []),
      {
        label: c.status,
        value: availabilityLabel(t.hero, identity.availability),
        dot: AVAILABILITY_DOT[identity.availability],
      },
    ];
  });

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  /** The admin's draft preview: the text in full, no typing, and no live assistant. */
  private readonly preview = inject(CONTENT_PREVIEW);
  private observer?: IntersectionObserver;
  private shellObserver?: IntersectionObserver;

  /** True once the shell's code should load: near the screen, asked for, or a returning tab. */
  protected readonly loadShell = signal(false);
  private stop?: () => void;

  constructor() {
    afterNextRender(() => {
      this.arm();
      this.watchForShell();
    });

    // New copy (a language switch) shows in full at once, never retyped.
    effect(() => {
      this.lines();
      untracked(() => this.skip());
    });

    // "Ask my portfolio" wants the prompt now, not after the intro.
    const launcher = this.launcher;
    effect(() => {
      if (!launcher.focusPending()) return;
      untracked(() => {
        this.skip();
        if (!this.preview) this.loadShell.set(true);
      });
    });

    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      this.shellObserver?.disconnect();
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
  /** Loads the prompt's code a little before the section scrolls into view. */
  private watchForShell(): void {
    if (!this.isBrowser || this.preview) return;
    if (hasStoredConversation()) {
      this.loadShell.set(true);
      return;
    }
    this.shellObserver = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.shellObserver?.disconnect();
        this.loadShell.set(true);
      },
      { rootMargin: "300px 0px" },
    );
    this.shellObserver.observe(this.host.nativeElement);
  }

  private arm(): void {
    // Render hooks run during the server render here too. A tab that already
    // talked to the assistant has seen the intro.
    if (!this.isBrowser || this.preview || prefersReducedMotion() || hasStoredConversation()) {
      return;
    }
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
