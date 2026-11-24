import { ChangeDetectionStrategy, Component, input } from "@angular/core";

/**
 * A home section's heading: the section's name as a real `<h2>` in the display face, with its node
 * on the page's line (motion.css), which fills as the line reaches it. Its first letter is
 * capitalised in CSS. Anything projected sits at the end of the heading's row (a link to more).
 */
@Component({
  selector: "app-section-heading",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block" },
  template: `
    <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <h2
        class="relative m-0 text-balance text-h2 text-foreground hyphens-auto first-letter:uppercase"
        [id]="headingId()"
      >
        <span class="page-line-node" aria-hidden="true"></span>{{ heading() }}
      </h2>
      <ng-content />
    </header>
  `,
})
export class SectionHeadingComponent {
  /** The section's name, from the CMS. */
  readonly heading = input.required<string>();
  /** For the section's `aria-labelledby`. */
  readonly headingId = input.required<string>();
}
