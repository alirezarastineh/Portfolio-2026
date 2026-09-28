import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/**
 * One figure at a glance, as the dashboard shows what needs a look: the label
 * on top (the tile's heading), then whatever the page puts in (the number in
 * `text-h3`, a line or two under it, a link). An attribute component, so the
 * host keeps its own element: an `<li>` in a list of tiles.
 */
@Component({
  selector: "[appKpiTile]",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "surface-card flex min-w-0 flex-col gap-1.5 p-4" },
  template: `
    @if (level() === 2) {
      <h2 class="eyebrow m-0 text-muted-foreground">{{ label() }}</h2>
    } @else {
      <h3 class="eyebrow m-0 text-muted-foreground">{{ label() }}</h3>
    }
    <ng-content />
  `,
})
export class KpiTileComponent {
  readonly label = input.required<string>({ alias: "appKpiTile" });
  /** The heading's level: 3 under a section's own heading, 2 at the top of a page's content. */
  readonly level = input<2 | 3>(3);
}
