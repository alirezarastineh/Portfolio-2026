import { NgTemplateOutlet } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef, // NOSONAR
  ElementRef,
  inject, // NOSONAR
  input,
  viewChild,
} from "@angular/core";
import { gsap } from "gsap";

type Variant = "primary" | "secondary";
type ButtonType = "button" | "submit";

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
        (mousemove)="onMove($event)"
        (mouseleave)="onLeave()"
      >
        <span class="inline-flex items-center gap-2 will-change-transform">
          <ng-container [ngTemplateOutlet]="projectedContent" />
        </span>
      </a>
    } @else {
      <button
        #target
        [attr.type]="buttonType()"
        [class]="buttonClass()"
        (mousemove)="onMove($event)"
        (mouseleave)="onLeave()"
      >
        <span class="inline-flex items-center gap-2 will-change-transform">
          <ng-container [ngTemplateOutlet]="projectedContent" />
        </span>
      </button>
    }
  `,
})
export class MagneticButtonComponent {
  readonly variant = input<Variant>("primary");
  readonly href = input<string | undefined>(undefined);
  /** Only applies when rendering a `<button>` (no `href`). */
  readonly buttonType = input<ButtonType>("button");
  readonly strength = input<number>(0.3);
  readonly radius = input<number>(100);

  readonly buttonClass = computed(() =>
    [
      "relative inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border px-6 font-mono text-sm font-medium tracking-[0.02em] transition-colors duration-200 ease-in-out will-change-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-indigo",
      this.variant() === "primary"
        ? "border-transparent bg-accent-orange text-[oklch(0.05_0_0)] hover:bg-[oklch(0.78_0.2_45)]"
        : "border-border bg-transparent text-foreground hover:border-accent-indigo/50",
    ].join(" "),
  );

  readonly asAnchor = computed(() => !!this.href());
  readonly external = computed(() => {
    const h = this.href();
    return !!h && /^https?:/i.test(h);
  });

  readonly target = viewChild<ElementRef<HTMLElement>>("target");

  private readonly destroyRef = inject(DestroyRef);

  private quickX?: gsap.QuickToFunc;
  private quickY?: gsap.QuickToFunc;
  private innerQuickX?: gsap.QuickToFunc;
  private innerQuickY?: gsap.QuickToFunc;

  constructor() {
    afterNextRender(() => {
      const el = this.target()?.nativeElement;
      if (!el) return;
      const inner = el.querySelector("span") as HTMLElement | null;
      this.quickX = gsap.quickTo(el, "x", { duration: 0.4, ease: "power3.out" });
      this.quickY = gsap.quickTo(el, "y", { duration: 0.4, ease: "power3.out" });
      if (inner) {
        this.innerQuickX = gsap.quickTo(inner, "x", { duration: 0.5, ease: "power3.out" });
        this.innerQuickY = gsap.quickTo(inner, "y", { duration: 0.5, ease: "power3.out" });
      }
    });
    this.destroyRef.onDestroy(() => {
      const el = this.target()?.nativeElement;
      if (el) {
        gsap.killTweensOf(el);
        const inner = el.querySelector("span") as HTMLElement | null;
        if (inner) gsap.killTweensOf(inner);
      }
    });
  }

  onMove(event: MouseEvent): void {
    const el = this.target()?.nativeElement;
    if (!el || !this.quickX || !this.quickY) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const r = this.radius();
    if (dist > r) {
      this.onLeave();
      return;
    }
    const s = this.strength();
    this.quickX(dx * s);
    this.quickY(dy * s);
    this.innerQuickX?.(dx * s * 0.4);
    this.innerQuickY?.(dy * s * 0.4);
  }

  onLeave(): void {
    const el = this.target()?.nativeElement;
    if (!el) return;
    gsap.to(el, { x: 0, y: 0, duration: 0.6, ease: "back.out(2)" });
    const inner = el.querySelector("span") as HTMLElement | null;
    if (inner) {
      gsap.to(inner, { x: 0, y: 0, duration: 0.6, ease: "back.out(2)" });
    }
  }
}
