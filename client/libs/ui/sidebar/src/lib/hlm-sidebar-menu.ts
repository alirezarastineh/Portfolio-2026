import { Directive } from "@angular/core";
import { classes } from "@spartan-ng/helm/utils";

@Directive({
  selector: "ul[hlmSidebarMenu]",
  host: {
    "data-slot": "sidebar-menu",
    "data-sidebar": "menu",
  },
})
export class HlmSidebarMenu {
  constructor() {
    // 2 px between entries, as the prototype: the rail fits a 1280×720 window.
    classes(() => "flex w-full min-w-0 flex-col gap-0.5");
  }
}
