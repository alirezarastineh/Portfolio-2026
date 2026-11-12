import { Directive } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";

@Directive({
  selector: "[hlmSidebarMenuBadge],hlm-sidebar-menu-badge",
  host: {
    "data-slot": "sidebar-menu-badge",
    "data-sidebar": "menu-badge",
  },
})
export class HlmSidebarMenuBadge {
  constructor() {
    // Centred on the entry at any height (32 px, or 44 on touch).
    classes(() => [
      "text-muted-foreground pointer-events-none absolute top-1/2 right-1 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center gap-1.5 px-1 text-xs font-medium tabular-nums select-none",
      "peer-hover/menu-button:text-foreground peer-data-[active=true]/menu-button:text-foreground",
      "group-data-[collapsible=icon]:hidden",
    ]);
  }
}
