import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { splitCommentMark } from "../i18n/comment-mark";
import { ScrambleTextComponent } from "./scramble-text.component";

/**
 * A home section's heading: a mono eyebrow (`// case · studies`), then the
 * section's name as a real `<h2>` in the display face. The CMS writes names
 * as comments (`// projects`); the slashes are dropped from the heading and
 * its first letter is capitalised in CSS, so screen readers hear "projects".
 * Anything projected sits at the end of the row (a link to more).
 */
@Component({
  selector: "app-section-heading",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrambleTextComponent],
  host: { class: "block" },
  template: `
    <header class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div class="flex flex-col gap-3">
        <p class="m-0 font-mono text-xs uppercase tracking-[0.22em] text-accent-orange">
          <span aria-hidden="true">// </span><app-scramble-text [text]="eyebrow()" />
        </p>
        <h2
          class="m-0 text-balance text-4xl font-semibold leading-[1.05] tracking-tight text-foreground first-letter:uppercase sm:text-5xl"
          [id]="headingId()"
        >
          {{ title() }}
        </h2>
      </div>
      <ng-content />
    </header>
  `,
})
export class SectionHeadingComponent {
  /** The CMS heading, `// projects` or plain. */
  readonly heading = input.required<string>();
  readonly eyebrow = input.required<string>();
  /** For the section's `aria-labelledby`. */
  readonly headingId = input.required<string>();

  protected readonly title = computed(() => splitCommentMark(this.heading()).text);
}
