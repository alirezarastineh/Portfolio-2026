import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { provideIcons } from "@ng-icons/core";
import { lucidePanelLeft } from "@ng-icons/lucide";
import { HlmButton, provideBrnButtonConfig } from "@spartan-ng/helm/button";
import { HlmIconImports } from "@spartan-ng/helm/icon";
import { HlmSidebarService } from "./hlm-sidebar.service";

// The icon button's own size: 32 px with a mouse, 44 on touch.
@Component({
  selector: "button[hlmSidebarTrigger]",
  imports: [HlmIconImports],
  providers: [
    provideIcons({ lucidePanelLeft }),
    provideBrnButtonConfig({ variant: "ghost", size: "icon" }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [
    {
      directive: HlmButton,
    },
  ],
  host: {
    "data-slot": "sidebar-trigger",
    "data-sidebar": "trigger",
    "(click)": "_onClick()",
  },
  template: ` <ng-icon hlm name="lucidePanelLeft" size="sm"></ng-icon> `,
})
export class HlmSidebarTrigger {
  private readonly _sidebarService = inject(HlmSidebarService);

  protected _onClick(): void {
    this._sidebarService.toggleSidebar();
  }
}
