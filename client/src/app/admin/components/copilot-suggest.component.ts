import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideSparkles } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import type { Locale } from "../../content/schema";
import { AdminApiService } from "../admin-api.service";
import { CopilotLedger } from "../copilot-ledger";
import { draftOffer, type DraftOffer } from "../copilot-skills";
import { DraftOfferComponent } from "./draft-offer.component";

/**
 * "Suggest" for a search description: the editor copilot drafts one from the
 * page's own text, within the length limit. The draft only fills the field;
 * the editor still saves and publishes, and settles the draft's verdict in
 * the ledger when it saves or discards (`target`, `current`; plan phase 27).
 */
@Component({
  selector: "app-copilot-suggest",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DraftOfferComponent, HlmButton, NgIcon],
  viewProviders: [provideIcons({ lucideSparkles })],
  template: `
    <button
      hlmBtn
      variant="ghost"
      size="sm"
      type="button"
      class="h-6 px-2 font-mono text-xs text-muted-foreground"
      [disabled]="busy()"
      (click)="run()"
      [attr.aria-label]="'Suggest a search description in ' + locale().toUpperCase() + ' with AI'"
    >
      <ng-icon name="lucideSparkles" size="12" aria-hidden="true" />
      <span class="ml-1">{{ busy() ? "…" : "suggest" }}</span>
    </button>
    <app-draft-offer
      [offer]="shownOffer()"
      [field]="'Search description ' + locale().toUpperCase()"
      [fieldId]="fieldId()"
      (use)="use($event)"
    />
  `,
})
export class CopilotSuggestComponent {
  /** The page's text to describe (HTML is fine; tags are stripped server-side). */
  readonly source = input.required<() => string>();
  readonly locale = input.required<Locale>();
  readonly maxLength = input(155);
  /** The field it fills: its notes are `<fieldId>-draft` (for the field's `aria-describedby`). */
  readonly fieldId = input.required<string>();
  /** The field's name in the ledger (with its project or post): the editor's save names it. */
  readonly target = input.required<string>();
  /** The field's value now, for the draft's verdict. */
  readonly current = input.required<() => string>();
  readonly suggested = output<string>();

  private readonly api = inject(AdminApiService);
  private readonly ledger = inject(CopilotLedger);
  protected readonly busy = signal(false);
  /** Destroyed: a draft that comes back after that never lands. */
  private gone = false;
  /** The last draft's notes and alternatives (plan phase 28); `tracked`: the ledger knows it. */
  private readonly offer = signal<{ value: DraftOffer; tracked: boolean } | null>(null);
  /** Shown while its draft waits for the editor's save: gone once it is saved or discarded. */
  protected readonly shownOffer = computed(() => {
    const offer = this.offer();
    if (!offer) return null;
    return !offer.tracked || this.ledger.waits(this.target()) ? offer.value : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.gone = true));
  }

  protected async run(): Promise<void> {
    const text = this.source()().trim();
    if (!text) {
      toast.info("Write the page's text first; the suggestion is drawn from it.");
      return;
    }
    this.busy.set(true);
    const result = await this.api.copilot({
      task: "seo",
      text,
      locale: this.locale(),
      maxLength: this.maxLength(),
    });
    this.busy.set(false);
    if (!result.ok) {
      toast.error("No suggestion", { description: result.error });
      return;
    }
    // Back after the editor closed: the draft never lands.
    if (this.gone) {
      this.ledger.drop(result.data);
      return;
    }
    const read = this.current();
    const before = read();
    this.suggested.emit(result.data.text);
    this.ledger.propose(this.target(), result.data, { read, before });
    const offer = draftOffer(result.data);
    this.offer.set(offer ? { value: offer, tracked: Boolean(result.data.suggestionId) } : null);
  }

  /** Another of the drafts offered, into the field: the one judged at the save. */
  protected use(index: number): void {
    const offer = this.offer();
    const draft = offer?.value.drafts[index];
    if (!offer || !draft) return;
    this.suggested.emit(draft.text);
    this.ledger.use(this.target(), index);
    this.offer.set({ ...offer, value: { ...offer.value, chosen: index } });
  }
}
