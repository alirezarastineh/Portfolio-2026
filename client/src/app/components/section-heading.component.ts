import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import { splitCommentMark } from "../i18n/comment-mark";
import { ScrambleTextComponent } from "./scramble-text.component";

/**
 * A home section's heading: a full-width rule with the section's number at the
 * left (`01`) and a mono eyebrow at the right (`// case · studies`), then the
 * section's name as a real `<h2>` in the display face. The CMS writes names
 * as comments (`// projects`); the slashes are dropped from the heading and
 * its first letter is capitalised in CSS, so screen readers hear "projects".
 * The number is decoration: the order already says it. Anything projected sits
 * at the end of the heading's row (a link to more).
 */
@Component({
  selector: "app-section-heading",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ScrambleTextComponent],
  host: { class: "block" },
  template: `
    <header class="flex flex-col gap-6">
      <div class="flex items-center gap-4">
        @if (index()) {
          <span class="font-mono text-label tabular-nums text-accent-orange" aria-hidden="true">{{
            index()
          }}</span>
        }
        <!-- Fills what the number and eyebrow leave (not the full width). -->
        <div class="hairline hairline-draw w-auto min-w-8 grow" aria-hidden="true"></div>
        <p class="eyebrow m-0 text-right text-muted-foreground">
          <span aria-hidden="true">// </span><app-scramble-text [text]="eyebrow()" />
        </p>
      </div>
      <div class="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <h2
          class="m-0 text-balance text-h2 text-foreground hyphens-auto first-letter:uppercase"
          [id]="headingId()"
        >
          {{ title() }}
        </h2>
        <ng-content />
      </div>
    </header>
  `,
})
export class SectionHeadingComponent {
  /** The CMS heading, `// projects` or plain. */
  readonly heading = input.required<string>();
  readonly eyebrow = input.required<string>();
  /** For the section's `aria-labelledby`. */
  readonly headingId = input.required<string>();
  /** The section's place on the page, `01`; none outside the home page. */
  readonly index = input("");

  protected readonly title = computed(() => splitCommentMark(this.heading()).text);
}
