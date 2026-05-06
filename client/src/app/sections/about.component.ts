import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  PLATFORM_ID,
  signal,
} from "@angular/core";
import { gsap } from "gsap";

import { TerminalWindowComponent } from "../components/terminal-window.component";
import { terminalPrompt, type TerminalLine } from "../data/about.data";
import { LanguageService } from "../services/language.service";

type Phase = "idle" | "cmd" | "out" | "done";

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

        <app-terminal-window title="user@portfolio — zsh">
          <div class="flex flex-col">
            @for (line of lines; track $index; let i = $index) {
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
                <span class="text-accent-orange">{{ lastPrompt }}</span>
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

  readonly lines: TerminalLine[] = this.buildLines();
  readonly lastPrompt = terminalPrompt;

  readonly cmds = signal<(string | null)[]>(this.lines.map(() => null));
  readonly outs = signal<(string | null)[]>(this.lines.map(() => null));
  readonly activeIdx = signal<number>(-1);
  readonly phase = signal<Phase>("idle");

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private observer?: IntersectionObserver;
  private started = false;
  private cancelled = false;

  constructor() {
    afterNextRender(() => this.setup());
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  private buildLines(): TerminalLine[] {
    const t = this.lang.t();
    return [
      { prompt: terminalPrompt, command: "whoami", output: t.about.terminalOutputWhoami },
      { prompt: terminalPrompt, command: "cat philosophy.txt", output: t.about.philosophy },
      { prompt: terminalPrompt, command: "ls skills/", output: [t.about.terminalOutputLs] },
      {
        prompt: terminalPrompt,
        command: "cat contact.txt",
        output: t.about.terminalOutputContact,
      },
    ];
  }

  isTypingCmd(i: number): boolean {
    return this.activeIdx() === i && this.phase() === "cmd";
  }

  isTypingOut(i: number): boolean {
    return this.activeIdx() === i && this.phase() === "out";
  }

  private setup(): void {
    if (!this.isBrowser) {
      this.populateAll();
      this.phase.set("done");
      return;
    }
    if (this.reduceMotion()) {
      this.populateAll();
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

  private populateAll(): void {
    this.cmds.set(this.lines.map((l) => l.command));
    this.outs.set(this.lines.map((l) => this.outputText(l)));
    this.activeIdx.set(this.lines.length);
  }

  private outputText(l: TerminalLine): string {
    return Array.isArray(l.output) ? l.output.join("\n") : l.output;
  }

  private async run(): Promise<void> {
    for (let i = 0; i < this.lines.length; i++) {
      if (this.cancelled) return;
      const line = this.lines[i];
      this.activeIdx.set(i);
      this.phase.set("cmd");
      this.setSlot("cmd", i, "");
      await this.typeText(line.command, (text) => this.setSlot("cmd", i, text));
      await this.delay(0.18);
      if (this.cancelled) return;
      this.phase.set("out");
      this.setSlot("out", i, "");
      const out = this.outputText(line);
      await this.typeText(out, (text) => this.setSlot("out", i, text));
      await this.delay(0.32);
    }
    this.activeIdx.set(this.lines.length);
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
