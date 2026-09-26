import { isPlatformBrowser, NgTemplateOutlet } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  PLATFORM_ID,
  viewChild,
} from "@angular/core";

import {
  atRest,
  coarsePointer,
  prefersReducedMotion,
  runFrames,
  stepSpring,
  type Spring,
} from "../motion/frames";

type Variant = "primary" | "secondary";
type ButtonType = "button" | "submit";

/**
 * A button or link that leans toward the pointer. Only a pointer that hovers
 * moves it: on touch it is a plain button, and reduced motion keeps it still.
 */
@Component({
  selector: "app-magnetic-button",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  host: {
    class: "inline-block",
  },
  template: `
    <ng-template #projectedContent><ng-content /></ng-template>
    @if (asAnchor()) {
      <a
        #target
        [class]="buttonClass()"
        [attr.href]="href()"
        [attr.target]="external() ? '_blank' : null"
        [attr.rel]="external() ? 'noreferrer noopener' : null"
        [attr.download]="download() ? '' : null"
        (pointermove)="onMove($event)"
        (pointerleave)="onLeave()"
      >
        <span class="inline-flex items-center gap-2">
          <ng-container [ngTemplateOutlet]="projectedContent" />
        </span>
      </a>
    } @else {
      <button
        #target
        [attr.type]="buttonType()"
        [class]="buttonClass()"
        [disabled]="disabled()"
        [attr.aria-busy]="busy() ? 'true' : null"
        (pointermove)="onMove($event)"
        (pointerleave)="onLeave()"
      >
        <span class="inline-flex items-center gap-2">
          <ng-container [ngTemplateOutlet]="projectedContent" />
        </span>
      </button>
    }
  `,
})
export class MagneticButtonComponent {
  readonly variant = input<Variant>("primary");
  readonly href = input<string | undefined>(undefined);
  /** Saves the link's file instead of opening it, under the name the server gives. */
  readonly download = input(false);
  /** Only applies when rendering a `<button>` (no `href`). */
  readonly buttonType = input<ButtonType>("button");
  readonly disabled = input(false);
  /** Announced as busy (a form being sent). */
  readonly busy = input(false);
  readonly strength = input<number>(0.3);
  readonly radius = input<number>(100);

  readonly buttonClass = computed(() =>
    [
      "relative inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-6 font-mono text-sm font-medium transition-colors duration-200 ease-in-out disabled:cursor-not-allowed disabled:opacity-60",
      this.variant() === "primary"
        ? "border-transparent bg-accent-orange text-accent-orange-foreground hover:bg-accent-orange-hover"
        : "border-border bg-transparent text-foreground hover:border-accent-orange/60",
    ].join(" "),
  );

  readonly asAnchor = computed(() => !!this.href());
  readonly external = computed(() => {
    const h = this.href();
    return !!h && /^https?:/i.test(h);
  });

  readonly target = viewChild<ElementRef<HTMLElement>>("target");

  private enabled = false;
  private readonly x: Spring = { value: 0, velocity: 0 };
  private readonly y: Spring = { value: 0, velocity: 0 };
  private goal = { x: 0, y: 0 };
  private stop?: () => void;

  constructor() {
    const isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
    afterNextRender(() => {
      this.enabled = isBrowser && !prefersReducedMotion() && !coarsePointer();
    });
    inject(DestroyRef).onDestroy(() => this.stop?.());
  }

  onMove(event: PointerEvent): void {
    if (!this.enabled || event.pointerType !== "mouse") return;
    const el = this.target()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    if (Math.hypot(dx, dy) > this.radius()) {
      this.onLeave();
      return;
    }
    const s = this.strength();
    this.moveTo(dx * s, dy * s);
  }

  onLeave(): void {
    if (this.enabled) this.moveTo(0, 0);
  }

  private moveTo(x: number, y: number): void {
    this.goal = { x, y };
    if (this.stop) return;
    this.stop = runFrames((dt) => {
      stepSpring(this.x, this.goal.x, dt);
      stepSpring(this.y, this.goal.y, dt);
      const settled = atRest(this.x, this.goal.x) && atRest(this.y, this.goal.y);
      if (settled) {
        this.x.value = this.goal.x;
        this.y.value = this.goal.y;
      }
      this.paint();
      if (settled) this.stop = undefined;
      return !settled;
    });
  }

  /** The button leans; its label leans a little further, for depth. */
  private paint(): void {
    const el = this.target()?.nativeElement;
    if (!el) return;
    const { value: x } = this.x;
    const { value: y } = this.y;
    const still = x === 0 && y === 0;
    el.style.transform = still ? "" : `translate3d(${x}px, ${y}px, 0)`;
    const inner = el.firstElementChild as HTMLElement | null;
    if (inner) inner.style.transform = still ? "" : `translate3d(${x * 0.4}px, ${y * 0.4}px, 0)`;
  }
}
