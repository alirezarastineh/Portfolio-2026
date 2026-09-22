import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  PLATFORM_ID,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";

@Component({
  selector: "app-spotlight-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: {
    class:
      "relative isolate block overflow-hidden rounded-xl border border-border bg-card transition-colors duration-200 ease-in-out before:pointer-events-none before:absolute before:inset-0 before:z-0 before:bg-[radial-gradient(240px_circle_at_var(--mx,_50%)_var(--my,_50%),oklch(0.62_0.19_280_/_0.18),transparent_60%)] before:opacity-0 before:content-[''] before:transition-opacity before:duration-200 before:ease-in-out hover:border-accent-indigo/35 hover:before:opacity-100 [&>*]:relative [&>*]:z-[1]",
  },
})
export class SpotlightCardComponent {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  @HostListener("mousemove", ["$event"])
  onMove(event: MouseEvent): void {
    if (!this.isBrowser) return;
    const el = this.host.nativeElement;
    const rect = el.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty("--mx", `${x}%`);
    el.style.setProperty("--my", `${y}%`);
  }
}
