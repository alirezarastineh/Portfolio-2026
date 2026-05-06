import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";

const GLYPHS = String.raw`!<>-_\/[]{}—=+*^?#__abcdefghijklmnopqrstuvwxyz0123456789`;

@Component({
  selector: "app-scramble-text",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "inline-block font-mono",
  },
  template: `<span #target class="whitespace-pre" [attr.aria-label]="text()">{{ text() }}</span>`,
})
export class ScrambleTextComponent {
  readonly text = input.required<string>();
  readonly durationMs = input<number>(300);
  readonly perCharMs = input<number>(12);

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private observer?: IntersectionObserver;
  private rafId?: number;

  constructor() {
    afterNextRender(() => this.setup());
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  private setup(): void {
    if (!this.isBrowser) return;
    const el = this.host.nativeElement.querySelector("span") as HTMLElement | null;
    if (!el) return;
    if (globalThis.window?.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            this.scramble(el);
            this.observer?.disconnect();
            break;
          }
        }
      },
      { threshold: 0.4 },
    );
    this.observer.observe(this.host.nativeElement);
  }

  private scramble(el: HTMLElement): void {
    const final = this.text();
    const total = final.length;
    const start = performance.now();
    const stagger = this.perCharMs();
    const dur = this.durationMs();

    const tick = (now: number) => {
      const elapsed = now - start;
      let out = "";
      for (let i = 0; i < total; i++) {
        const charStart = i * stagger;
        const settledAt = charStart + dur;
        if (elapsed < charStart) {
          out += " ";
        } else if (elapsed >= settledAt) {
          out += final[i];
        } else if (final[i] === " ") {
          out += " ";
        } else {
          out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        }
      }
      el.textContent = out;
      if (elapsed < total * stagger + dur) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        el.textContent = final;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private cleanup(): void {
    this.observer?.disconnect();
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
  }
}
