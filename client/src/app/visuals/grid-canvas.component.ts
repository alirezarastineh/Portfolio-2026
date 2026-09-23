import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  PLATFORM_ID,
  signal,
  viewChild,
} from "@angular/core";

import { approach, prefersReducedMotion, runFrames } from "../motion/frames";
import { ThemeService } from "../services/theme.service";

/**
 * The hero's dot grid, which bends away from the pointer (or a tap). It draws
 * only when something changed — a move, the bend easing in or out, a resize,
 * a theme switch — and not at all while scrolled out of view. Server and
 * browser render the same markup: static SVG dots, with the canvas on top
 * taking over once it has drawn.
 */
@Component({
  selector: "app-grid-canvas",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "block",
    "aria-hidden": "true",
    "(pointermove)": "onPointer($event)",
    "(pointerdown)": "onPointer($event)",
    "(pointerleave)": "onLeave()",
  },
  template: `
    <svg
      class="absolute inset-0 block size-full text-accent-indigo opacity-60"
      [class.invisible]="live()"
      preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern id="grid-canvas-fallback" width="22" height="22" patternUnits="userSpaceOnUse">
          <circle cx="11" cy="11" r="1" fill="currentColor" fill-opacity="0.45" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-canvas-fallback)" />
    </svg>
    <canvas #canvas class="absolute inset-0 block size-full"></canvas>
  `,
})
export class GridCanvasComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly theme = inject(ThemeService);
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>("canvas");

  /** True once the canvas has drawn; the SVG then hides. */
  protected readonly live = signal(false);

  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver?: ResizeObserver;
  private intersection?: IntersectionObserver;
  private stop?: () => void;
  private releaseTimer?: ReturnType<typeof setTimeout>;
  private still = false;
  private visible = false;
  private dirty = true;

  private width = 0;
  private height = 0;
  private cols = 0;
  private rows = 0;
  private spacing = 0;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;

  private readonly cursor = { x: -9999, y: -9999 };
  private moved = false;
  private activity = 0;
  private target = 0;
  private color = "";

  constructor() {
    afterNextRender(() => this.init());

    // The dots take the theme's indigo.
    effect(() => {
      this.theme.theme();
      if (!this.ctx) return;
      this.readColor();
      this.invalidate();
    });

    inject(DestroyRef).onDestroy(() => this.cleanup());
  }

  onPointer(event: PointerEvent): void {
    if (!this.ctx || this.still) return;
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.cursor.x = event.clientX - rect.left;
    this.cursor.y = event.clientY - rect.top;
    this.moved = true;
    this.target = 1;
    // A tap has no "leave": let the bend ease back out on its own.
    clearTimeout(this.releaseTimer);
    if (event.pointerType !== "mouse") {
      this.releaseTimer = setTimeout(() => this.onLeave(), 600);
    }
    this.wake();
  }

  onLeave(): void {
    this.target = 0;
    this.wake();
  }

  private init(): void {
    if (!this.isBrowser) return;
    const canvas = this.canvasRef()?.nativeElement;
    this.ctx = canvas?.getContext("2d") ?? null;
    if (!this.ctx) return;

    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.still = prefersReducedMotion();
    this.readColor();

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.invalidate();
    });
    this.resizeObserver.observe(this.host.nativeElement);

    this.intersection = new IntersectionObserver(([entry]) => {
      this.visible = entry?.isIntersecting ?? false;
      if (this.visible) this.wake();
      else this.halt();
    });
    this.intersection.observe(this.host.nativeElement);
  }

  private readColor(): void {
    this.color =
      getComputedStyle(document.documentElement).getPropertyValue("--accent-indigo").trim() ||
      "oklch(0.62 0.19 280)";
  }

  private invalidate(): void {
    this.dirty = true;
    this.wake();
  }

  /** Runs frames until nothing changes, then stops. */
  private wake(): void {
    if (this.stop || !this.visible || !this.ctx) return;
    this.stop = runFrames((dt) => {
      const before = this.activity;
      this.activity = approach(this.activity, this.target, dt, this.target > before ? 0.12 : 0.3);
      if (Math.abs(this.activity - this.target) < 0.002) this.activity = this.target;

      const bending = this.activity > 0 && this.moved;
      if (this.dirty || this.activity !== before || bending) {
        this.draw();
        this.dirty = false;
        this.moved = false;
      }
      const busy = this.activity !== this.target;
      if (!busy) this.stop = undefined;
      return busy;
    });
  }

  private halt(): void {
    this.stop?.();
    this.stop = undefined;
  }

  private resize(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.ctx) return;
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    canvas.width = Math.floor(this.width * this.dpr);
    canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.spacing = Math.max(18, Math.min(36, this.width / 30));
    this.cols = Math.floor(this.width / this.spacing) + 1;
    this.rows = Math.floor(this.height / this.spacing) + 1;
    this.offsetX = (this.width - (this.cols - 1) * this.spacing) / 2;
    this.offsetY = (this.height - (this.rows - 1) * this.spacing) / 2;
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = this.color;

    const radius = this.spacing * 6;
    const a = this.activity;
    const { x: cx, y: cy } = this.cursor;

    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const baseX = this.offsetX + i * this.spacing;
        const baseY = this.offsetY + j * this.spacing;
        const dx = cx - baseX;
        const dy = cy - baseY;
        const d = Math.hypot(dx, dy);
        let f = 0;
        if (a > 0 && d < radius) {
          const t = 1 - d / radius;
          f = t * t * a;
        }
        const inv = d === 0 ? 0 : 1 / d;
        const px = baseX + dx * inv * f * this.spacing * 1.4;
        const py = baseY + dy * inv * f * this.spacing * 1.4;
        ctx.globalAlpha = 0.18 + f * 0.55;
        ctx.beginPath();
        ctx.arc(px, py, 1 + f * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (!this.live()) this.live.set(true);
  }

  private cleanup(): void {
    this.halt();
    clearTimeout(this.releaseTimer);
    this.resizeObserver?.disconnect();
    this.intersection?.disconnect();
  }
}
