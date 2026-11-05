import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
  selector: "app-spotlight-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  host: {
    class:
      "surface-card relative isolate block overflow-hidden transition-colors duration-200 ease-in-out hover:border-border-strong",
  },
})
export class SpotlightCardComponent {}
