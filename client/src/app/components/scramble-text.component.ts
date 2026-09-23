import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
} from "@angular/core";

import { prefersReducedMotion, runFrames } from "../motion/frames";

const GLYPHS = String.raw`!<>-_\/[]{}—=+*^?#__abcdefghijklmnopqrstuvwxyz0123456789`;

function randomGlyph(): string {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return GLYPHS[buffer[0]! % GLYPHS.length] ?? "";
}

/**
 * Text that resolves out of random glyphs the first time it scrolls into
 * view. At rest — on the server, before and after the effect, with reduced
 * motion — it is just the text. While it runs, the glyphs are hidden from
 * assistive technology and the real text is read instead.
 *
 * The glyphs live in a signal rather than being written into the DOM, so a
 * language switch mid-effect (or after it) always shows the new text.
 */
@Component({
  selector: "app-scramble-text",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "inline font-mono",
  },
  template: `@if (glyphs(); as shown) {
      <span class="sr-only">{{ text() }}</span
      ><span class="whitespace-pre-wrap" aria-hidden="true">{{ shown }}</span>
    } @else {
      <span>{{ text() }}</span>
    }`,
})
export class ScrambleTextComponent {
  readonly text = input.required<string>();
  readonly durationMs = input<number>(300);
  readonly perCharMs = input<number>(12);

  protected readonly glyphs = signal<string | null>(null);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private observer?: IntersectionObserver;
  private stop?: () => void;

  constructor() {
    afterNextRender(() => this.setup());
    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      this.stop?.();
    });
  }

  private setup(): void {
    // Render hooks run during the server render here too.
    if (!this.isBrowser || prefersReducedMotion()) return;
    this.observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        this.observer?.disconnect();
        this.scramble();
      },
      { threshold: 0.4 },
    );
    this.observer.observe(this.host.nativeElement);
  }

  private scramble(): void {
    const final = this.text();
    const stagger = this.perCharMs();
    const duration = this.durationMs();
    const end = final.length * stagger + duration;
    let elapsed = 0;

    this.stop = runFrames((dt) => {
      elapsed += dt * 1000;
      // A language switch mid-effect: stop and show the new text.
      if (elapsed >= end || this.text() !== final) {
        this.glyphs.set(null);
        return false;
      }
      let out = "";
      for (let i = 0; i < final.length; i++) {
        const start = i * stagger;
        const char = final[i]!;
        if (elapsed < start) out += " ";
        else if (elapsed >= start + duration || char === " ") out += char;
        else out += randomGlyph();
      }
      this.glyphs.set(out);
      return true;
    });
  }
}
