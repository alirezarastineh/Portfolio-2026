import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injector,
  input,
  output,
} from "@angular/core";
import { HlmButton } from "@spartan-ng/helm/button";

import { leadName, type DraftOffer } from "../copilot-skills";

/**
 * Beside a field the copilot fills (plan phase 28): what the draft in the
 * field still fails or what a second reading found ("Needs your eye: …"), and
 * the other drafts, each with "Use this". Rendered before any draft arrives,
 * so its notes sit in a polite live region that is read out when one lands;
 * the field points at them too (`aria-describedby` on `<fieldId>-draft`).
 * "Use this" puts a draft in the field and its button goes: the field takes
 * focus.
 */
@Component({
  selector: "app-draft-offer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton],
  host: { class: "block" },
  template: `
    <div aria-live="polite" class="text-xs">
      <p
        [attr.id]="fieldId() + '-draft'"
        class="m-0 text-accent-orange"
        [class.mt-1]="notes().length > 0"
      >
        {{ notes().join(" ") }}
      </p>
      @if (others()) {
        <span class="sr-only">
          {{ others() === 1 ? "One other draft" : others() + " other drafts" }} below.
        </span>
      }
    </div>
    @if (offer(); as shown) {
      @if (others()) {
        <ul
          class="m-0 mt-1 flex list-none flex-col gap-1 p-0 text-xs"
          [attr.aria-label]="'Other drafts for ' + field()"
        >
          @for (draft of shown.drafts; track $index) {
            @if ($index !== shown.chosen) {
              <li class="flex items-start gap-2 rounded-md border border-border px-2 py-1">
                <span class="min-w-0 flex-1 whitespace-pre-wrap">{{ draft.text }}</span>
                <button
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  type="button"
                  class="h-6 shrink-0 px-2 font-mono text-xs"
                  [attr.aria-label]="'Use this draft (' + lead(draft.lead) + ') for ' + field()"
                  (click)="choose($index)"
                >
                  Use this
                </button>
              </li>
            }
          }
        </ul>
      }
    }
  `,
})
export class DraftOfferComponent {
  /** Null while there is nothing to offer: the live region stays, empty. */
  readonly offer = input.required<DraftOffer | null>();
  /** The field, as the buttons and the list name it ("Page title EN"). */
  readonly field = input.required<string>();
  /** The field's id: the notes are `<fieldId>-draft`, and "Use this" focuses the field. */
  readonly fieldId = input.required<string>();
  /** The index of the draft to put in the field. */
  readonly use = output<number>();

  private readonly injector = inject(Injector);
  protected readonly lead = leadName;
  /** The notes of the draft in the field now. */
  protected readonly notes = computed(() => {
    const offer = this.offer();
    return offer?.drafts[offer.chosen]?.notes ?? [];
  });
  protected readonly others = computed(() => Math.max((this.offer()?.drafts.length ?? 0) - 1, 0));

  protected choose(index: number): void {
    this.use.emit(index);
    // The button clicked goes with the choice: the field the draft went into takes focus.
    afterNextRender(() => document.getElementById(this.fieldId())?.focus(), {
      injector: this.injector,
    });
  }
}
