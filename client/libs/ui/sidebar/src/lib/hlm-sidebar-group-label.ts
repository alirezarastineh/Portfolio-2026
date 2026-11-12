import { Directive } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";

@Directive({
  selector: "div[hlmSidebarGroupLabel], button[hlmSidebarGroupLabel]",
  host: {
    "data-slot": "sidebar-group-label",
    "data-sidebar": "group-label",
  },
})
export class HlmSidebarGroupLabel {
  constructor() {
    classes(() => [
      // Closer to the entries it heads than to the group above.
      "text-faint-foreground flex h-7 shrink-0 items-end rounded-lg px-2 pb-1 text-hint transition-[margin,opacity] duration-200 ease-linear motion-reduce:transition-none [&>_ng-icon]:size-4 [&>_ng-icon]:shrink-0",
      "group-data-[collapsible=icon]:-mt-7 group-data-[collapsible=icon]:opacity-0",
    ]);
  }
}
