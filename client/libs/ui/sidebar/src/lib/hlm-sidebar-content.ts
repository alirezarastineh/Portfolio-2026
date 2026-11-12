import { Directive } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";

// The list scrolls in both states: collapsed to icons on a short window, its last entries
// would be out of reach. A thin scrollbar in the theme's colours; none in the 56 px rail,
// where the fade at the edge says there is more.
@Directive({
  selector: "[hlmSidebarContent],hlm-sidebar-content",
  host: {
    "data-slot": "sidebar-content",
    "data-sidebar": "content",
  },
})
export class HlmSidebarContent {
  constructor() {
    classes(
      () =>
        "flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:var(--border-strong)_transparent] [scrollbar-width:thin] group-data-[collapsible=icon]:[scrollbar-width:none]",
    );
  }
}
