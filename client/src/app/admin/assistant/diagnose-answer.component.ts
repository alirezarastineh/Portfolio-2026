import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import { leadingLine, refusal, symptomLabel, type JournalEntry } from "../journal";

/**
 * "Diagnose": why a visitor's answer failed, worked out by the server with no
 * model (plan phase 24), shown in one line under the answer, and opened in
 * the Journal for the evidence and the decisions. The result takes the
 * button's place, so focus moves to it and the live region says it.
 */
@Component({
  selector: "app-diagnose-answer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton],
  host: { class: "block" },
  template: `
    @if (entry(); as e) {
      <div
        #result
        tabindex="-1"
        class="flex flex-col gap-1 rounded-md border border-border p-3 text-xs"
      >
        <p class="m-0">
          <span class="font-medium">Diagnosis</span>
          <span class="text-muted-foreground"> ({{ symptom(e.category) }}):</span>
          {{ leading(e) }}
        </p>
        @if (e.fix) {
          <p class="m-0 text-muted-foreground">{{ e.fix }}</p>
        }
        <div>
          <button
            hlmBtn
            size="sm"
            variant="outline"
            type="button"
            [attr.aria-describedby]="describedBy()"
            (click)="opened.emit(e.id)"
          >
            Open in the journal
          </button>
        </div>
      </div>
    } @else {
      <button
        hlmBtn
        size="sm"
        variant="outline"
        type="button"
        [attr.aria-describedby]="describedBy()"
        [disabled]="busy()"
        (click)="diagnose()"
      >
        {{ busy() ? "Diagnosing…" : "Diagnose" }}
      </button>
    }
    <!-- Always in the page, so what is put in it is announced. -->
    <p class="sr-only" role="status">{{ said() }}</p>
  `,
})
export class DiagnoseAnswerComponent {
  private readonly api = inject(AdminApiService);
  private readonly injector = inject(Injector);

  readonly messageId = input.required<string>();
  /** The id of what the buttons act on (the answer's question), for their description. */
  readonly describedBy = input<string | null>(null);
  /** The journal entry to open. */
  readonly opened = output<string>();

  protected readonly busy = signal(false);
  protected readonly entry = signal<JournalEntry | null>(null);
  protected readonly said = signal("");
  private readonly result = viewChild<ElementRef<HTMLElement>>("result");

  protected async diagnose(): Promise<void> {
    this.busy.set(true);
    const result = await this.api.diagnoseAnswer(this.messageId());
    this.busy.set(false);
    if (result.ok) {
      this.entry.set(result.data.entry);
      this.said.set(`Diagnosis: ${this.leading(result.data.entry)}`);
      afterNextRender(() => this.result()?.nativeElement.focus(), { injector: this.injector });
      return;
    }
    const decided = (result.detail as { id?: string } | undefined)?.id;
    if (result.error === "already_journaled" && decided) {
      toast.info("Already in the journal, decided: opening it.");
      this.opened.emit(decided);
      return;
    }
    toast.error("Could not diagnose the answer", { description: refusal(result.error) });
  }

  protected leading(entry: JournalEntry): string {
    return leadingLine(entry.diagnosis);
  }

  protected readonly symptom = symptomLabel;
}
