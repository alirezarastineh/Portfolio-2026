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
import { gsap } from "gsap";

import { TerminalWindowComponent } from "../components/terminal-window.component";
import { LanguageService } from "../services/language.service";

type Phase = "idle" | "cmd" | "out" | "done";

interface TerminalLine {
  prompt: string;
  command: string;
  output: string;
}

@Component({
  selector: "app-about-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TerminalWindowComponent],
  host: {
    class: "block",
  },
  template: `
    <section id="about" class="relative px-6 py-24 sm:px-8 sm:py-28 lg:px-12 lg:py-32">
      <div class="mx-auto flex max-w-205 flex-col gap-10">
        <header class="flex flex-wrap items-baseline justify-between gap-4">
          <h2 class="m-0 font-mono text-2xl tracking-tight text-foreground sm:text-3xl">
            {{ lang.t().about.heading }}
          </h2>
          <p class="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-muted-foreground">
            {{ lang.t().about.subtitle }}
          </p>
        </header>

        <app-terminal-window [title]="lang.t().about.terminalTitle">
          <div class="flex flex-col">
            @for (line of lines(); track $index; let i = $index) {
              @if (cmds()[i] !== null) {
                <div class="flex flex-wrap items-baseline gap-x-2">
                  <span class="text-accent-orange">{{ line.prompt }}</span>
                  <span class="text-foreground"
                    >{{ cmds()[i] }}
                    @if (isTypingCmd(i)) {
                      <span class="terminal-caret" aria-hidden="true"></span>
                    }
                  </span>
                </div>
              }
              @if (outs()[i] !== null) {
                <div
                  class="mt-1 max-w-[78ch] whitespace-pre-wrap pb-3 leading-relaxed text-foreground/85"
                >
                  {{ outs()[i] }}
                  @if (isTypingOut(i)) {
                    <span class="terminal-caret" aria-hidden="true"></span>
                  }
                </div>
              }
            }
            @if (phase() === "done") {
              <div class="mt-1 flex items-baseline gap-2">
                <span class="text-accent-orange">{{ lastPrompt() }}</span>
                <span class="terminal-caret" aria-hidden="true"></span>
              </div>
            }
          </div>
        </app-terminal-window>
      </div>
    </section>
  `,
})
export class AboutSectionComponent {
  readonly lang = inject(LanguageService);

  /**
   * Was a field initializer, which snapshotted the copy once — so the terminal
   * silently kept its original language across a toggle. It is derived now, and
   * an effect keeps the rendered text in step.
   */
  readonly lines = computed<TerminalLine[]>(() => this.buildLines());
  readonly lastPrompt = computed(() => this.lang.t().about.terminalPrompt);

  readonly cmds = signal<(string | null)[]>([]);
  readonly outs = signal<(string | null)[]>([]);
  readonly activeIdx = signal<number>(-1);
  readonly phase = signal<Phase>("idle");

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private observer?: IntersectionObserver;
  private started = false;
  private cancelled = false;
  /** Bumped on every copy change so an in-flight typewriter abandons itself. */
  private runId = 0;

  constructor() {
    effect(() => {
      const lines = this.lines();
      untracked(() => this.syncLines(lines));
    });
    afterNextRender(() => this.setup());
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  private syncLines(lines: TerminalLine[]): void {
    this.runId++;

    // Already revealed — swap straight to the new copy rather than replaying
    // the whole typing animation in the reader's face.
    if (this.started || this.phase() === "done") {
      this.populateAll(lines);
      this.phase.set("done");
      return;
    }

    this.cmds.set(lines.map(() => null));
    this.outs.set(lines.map(() => null));
  }

  private buildLines(): TerminalLine[] {
    const t = this.lang.t().about;
    const prompt = t.terminalPrompt;
    return [
      { prompt, command: "whoami", output: t.terminalOutputWhoami },
      { prompt, command: "cat philosophy.txt", output: t.philosophy },
      { prompt, command: "ls skills/", output: t.terminalOutputLs },
      { prompt, command: "cat contact.txt", output: t.terminalOutputContact },
    ];
  }

  isTypingCmd(i: number): boolean {
    return this.activeIdx() === i && this.phase() === "cmd";
  }

  isTypingOut(i: number): boolean {
    return this.activeIdx() === i && this.phase() === "out";
  }

  private setup(): void {
    if (!this.isBrowser || this.reduceMotion()) {
      this.populateAll(this.lines());
      this.phase.set("done");
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !this.started) {
            this.started = true;
            this.observer?.disconnect();
            void this.run();
            break;
          }
        }
      },
      { threshold: 0.3 },
    );
    this.observer.observe(this.host.nativeElement);
  }

  private reduceMotion(): boolean {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  private populateAll(lines: TerminalLine[]): void {
    this.cmds.set(lines.map((l) => l.command));
    this.outs.set(lines.map((l) => l.output));
    this.activeIdx.set(lines.length);
  }

  private async run(): Promise<void> {
    const myRun = ++this.runId;
    const lines = this.lines();
    const stale = () => this.cancelled || myRun !== this.runId;

    for (let i = 0; i < lines.length; i++) {
      if (stale()) return;
      const line = lines[i];
      this.activeIdx.set(i);
      this.phase.set("cmd");
      this.setSlot("cmd", i, "");
      await this.typeText(line.command, (text) => this.setSlot("cmd", i, text));
      await this.delay(0.18);
      if (stale()) return;
      this.phase.set("out");
      this.setSlot("out", i, "");
      await this.typeText(line.output, (text) => this.setSlot("out", i, text));
      await this.delay(0.32);
    }

    if (stale()) return;
    this.activeIdx.set(lines.length);
    this.phase.set("done");
  }

  private setSlot(slot: "cmd" | "out", idx: number, text: string): void {
    const sig = slot === "cmd" ? this.cmds : this.outs;
    sig.update((arr) => {
      const next = arr.slice();
      next[idx] = text;
      return next;
    });
  }

  private typeText(text: string, write: (s: string) => void): Promise<void> {
    return new Promise((resolve) => {
      if (text.length === 0) {
        write("");
        resolve();
        return;
      }
      const state = { i: 0 };
      gsap.to(state, {
        i: text.length,
        duration: text.length * 0.018,
        ease: "none",
        onUpdate: () => write(text.slice(0, Math.floor(state.i))),
        onComplete: () => {
          write(text);
          resolve();
        },
      });
    });
  }

  private delay(seconds: number): Promise<void> {
    return new Promise((resolve) => {
      gsap.to({}, { duration: seconds, onComplete: () => resolve() });
    });
  }

  private cleanup(): void {
    this.cancelled = true;
    this.observer?.disconnect();
  }
}
