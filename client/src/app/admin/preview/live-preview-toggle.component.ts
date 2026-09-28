import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePanelRight } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";

import { LivePreviewService } from "./live-preview.service";

/**
 * The page header's "Live preview" switch (from `lg`, where there is room for
 * the preview beside the form). It stays as set from one editor to the next.
 */
@Component({
  selector: "app-live-preview-toggle",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, NgIcon],
  viewProviders: [provideIcons({ lucidePanelRight })],
  host: { class: "hidden lg:contents" },
  template: `
    <button
      hlmBtn
      variant="outline"
      size="sm"
      type="button"
      [attr.aria-controls]="preview.open() && preview.wide() ? 'preview-panel' : null"
      [attr.aria-pressed]="preview.open()"
      (click)="preview.open.set(!preview.open())"
    >
      <ng-icon name="lucidePanelRight" size="14" aria-hidden="true" />
      <span class="ml-1.5">Live preview</span>
    </button>
  `,
})
export class LivePreviewToggleComponent {
  protected readonly preview = inject(LivePreviewService);
}
