import { ChangeDetectionStrategy, Component, input } from "@angular/core";

import type { Metric } from "../content/schema";

/** Key numbers, each with its label and, where there is one, its context (components.css). */
@Component({
  selector: "app-metrics",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block" },
  template: `
    <dl class="metrics">
      @for (metric of metrics(); track $index) {
        <div class="metric">
          <dt>{{ metric.label }}</dt>
          <dd class="metric-value">{{ metric.value }}</dd>
          @if (metric.context) {
            <dd class="metric-context">{{ metric.context }}</dd>
          }
        </div>
      }
    </dl>
  `,
})
export class MetricsComponent {
  readonly metrics = input.required<readonly Metric[]>();
}
