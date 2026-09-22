import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  inject,
  PLATFORM_ID,
  viewChild,
} from "@angular/core";
import { gsap } from "gsap";

@Component({
  selector: "app-grid-canvas",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "block",
    "aria-hidden": "true",
  },
  template: `
    @if (isBrowser) {
      <canvas #canvas class="block size-full"></canvas>
    } @else {
      <svg
        class="block size-full opacity-60"
        viewBox="0 0 400 600"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="grid-canvas-fallback" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="11" cy="11" r="1" fill="oklch(0.62 0.19 280 / 0.45)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid-canvas-fallback)" />
      </svg>
    }
  `,
})
export class GridCanvasComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly destroyRef = inject(DestroyRef);
  readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>("canvas");

  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver?: ResizeObserver;
  private tickerFn?: gsap.TickerCallback;
  private mediaQuery?: MediaQueryList;
  private mediaListener?: (e: MediaQueryListEvent) => void;
  private reduceMotion = false;

  private width = 0;
  private height = 0;
  private cols = 0;
  private rows = 0;
  private spacing = 0;
  private offsetX = 0;
  private offsetY = 0;
  private dpr = 1;

  private readonly cursor = { x: -9999, y: -9999 };
  private readonly activity = { value: 0 };
  private indigo = "oklch(0.62 0.19 280)";

  constructor() {
    afterNextRender(() => this.init());
    this.destroyRef.onDestroy(() => this.cleanup());
  }

  private init(): void {
    if (!this.isBrowser) return;
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    this.ctx = canvas.getContext("2d");
    if (!this.ctx) return;

    this.dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    this.readColor();
    this.detectReducedMotion();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host.nativeElement);
    this.resize();

    if (this.reduceMotion) {
      this.draw();
      return;
    }
    this.tickerFn = () => this.draw();
    gsap.ticker.add(this.tickerFn);
  }

  private detectReducedMotion(): void {
    this.mediaQuery = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
    this.reduceMotion = this.mediaQuery.matches;
    this.mediaListener = (e) => {
      this.reduceMotion = e.matches;
      if (this.reduceMotion && this.tickerFn) {
        gsap.ticker.remove(this.tickerFn);
        this.tickerFn = undefined;
        this.activity.value = 0;
        this.draw();
      } else if (!this.reduceMotion && !this.tickerFn) {
        this.tickerFn = () => this.draw();
        gsap.ticker.add(this.tickerFn);
      }
    };
    this.mediaQuery.addEventListener("change", this.mediaListener);
  }

  private readColor(): void {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent-indigo").trim();
    if (v) this.indigo = v;
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
    this.computeGrid();
    if (this.reduceMotion) this.draw();
  }

  private computeGrid(): void {
    const target = 30;
    this.spacing = Math.max(18, Math.min(36, this.width / target));
    this.cols = Math.floor(this.width / this.spacing) + 1;
    this.rows = Math.floor(this.height / this.spacing) + 1;
    this.offsetX = (this.width - (this.cols - 1) * this.spacing) / 2;
    this.offsetY = (this.height - (this.rows - 1) * this.spacing) / 2;
  }

  @HostListener("mousemove", ["$event"])
  onMove(e: MouseEvent): void {
    if (!this.isBrowser || this.reduceMotion) return;
    const rect = this.host.nativeElement.getBoundingClientRect();
    this.cursor.x = e.clientX - rect.left;
    this.cursor.y = e.clientY - rect.top;
    gsap.to(this.activity, {
      value: 1,
      duration: 0.4,
      ease: "power2.out",
      overwrite: true,
    });
  }

  @HostListener("mouseleave")
  onLeave(): void {
    if (!this.isBrowser) return;
    gsap.to(this.activity, {
      value: 0,
      duration: 0.8,
      ease: "power3.out",
      overwrite: true,
    });
  }

  private draw(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = this.indigo;

    const radius = this.spacing * 6;
    const a = this.activity.value;
    const cx = this.cursor.x;
    const cy = this.cursor.y;

    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const baseX = this.offsetX + i * this.spacing;
        const baseY = this.offsetY + j * this.spacing;
        const dx = cx - baseX;
        const dy = cy - baseY;
        const d = Math.hypot(dx, dy);
        let f = 0;
        if (d < radius && a > 0) {
          const t = 1 - d / radius;
          f = t * t * a;
        }
        const inv = d === 0 ? 0 : 1 / d;
        const px = baseX + dx * inv * f * this.spacing * 1.4;
        const py = baseY + dy * inv * f * this.spacing * 1.4;
        const size = 1 + f * 1.8;
        ctx.globalAlpha = 0.18 + f * 0.55;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private cleanup(): void {
    if (this.tickerFn) gsap.ticker.remove(this.tickerFn);
    this.resizeObserver?.disconnect();
    if (this.mediaQuery && this.mediaListener) {
      this.mediaQuery.removeEventListener("change", this.mediaListener);
    }
    gsap.killTweensOf(this.activity);
  }
}
