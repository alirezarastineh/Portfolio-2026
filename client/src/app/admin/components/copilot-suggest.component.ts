import { ChangeDetectionStrategy, Component, inject, input, output, signal } from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideSparkles } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import type { Locale } from "../../content/schema";
import { AdminApiService } from "../admin-api.service";

/**
 * "Suggest" for a search description: the editor copilot drafts one from the
 * page's own text, within the length limit. The draft only fills the field;
 * the editor still saves and publishes.
 */
@Component({
  selector: "app-copilot-suggest",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, NgIcon],
  viewProviders: [provideIcons({ lucideSparkles })],
  template: `
    <button
      hlmBtn
      variant="ghost"
      size="sm"
      type="button"
      class="h-6 px-2 font-mono text-[0.68rem] text-muted-foreground"
      [disabled]="busy()"
      (click)="run()"
      [attr.aria-label]="'Suggest a search description in ' + locale().toUpperCase() + ' with AI'"
    >
      <ng-icon name="lucideSparkles" size="12" aria-hidden="true" />
      <span class="ml-1">{{ busy() ? "…" : "suggest" }}</span>
    </button>
  `,
})
export class CopilotSuggestComponent {
  /** The page's text to describe (HTML is fine; tags are stripped server-side). */
  readonly source = input.required<() => string>();
  readonly locale = input.required<Locale>();
  readonly maxLength = input(155);
  readonly suggested = output<string>();

  private readonly api = inject(AdminApiService);
  protected readonly busy = signal(false);

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
    this.suggested.emit(result.data.text);
  }
}
