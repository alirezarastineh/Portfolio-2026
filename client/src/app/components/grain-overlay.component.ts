import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
  selector: "app-grain-overlay",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "contents",
  },
  template: `
    <svg
      class="pointer-events-none fixed inset-0 z-50 h-screen w-screen opacity-[0.02] mix-blend-overlay"
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
    >
      <filter id="grain-noise">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves="2"
          stitchTiles="stitch"
        ></feTurbulence>
        <feColorMatrix type="saturate" values="0"></feColorMatrix>
      </filter>
      <rect width="100%" height="100%" filter="url(#grain-noise)"></rect>
    </svg>
  `,
})
export class GrainOverlayComponent {}
