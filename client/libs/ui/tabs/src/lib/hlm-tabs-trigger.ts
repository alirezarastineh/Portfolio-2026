import { Directive, input } from "@angular/core";
import { BrnTabsTrigger } from "@spartan-ng/brain/tabs";
import { classes } from "@spartan-ng/helm/utils";

@Directive({
  selector: "[hlmTabsTrigger]",
  hostDirectives: [
    { directive: BrnTabsTrigger, inputs: ["brnTabsTrigger: hlmTabsTrigger", "disabled"] },
  ],
  host: {
    "data-slot": "tabs-trigger",
  },
})
export class HlmTabsTrigger {
  public readonly triggerFor = input.required<string>({ alias: "hlmTabsTrigger" });
  constructor() {
    classes(() => [
      // 32px with a mouse, 44px on touch; the chosen tab's edge clears 3:1 on the list.
      `text-muted-foreground hover:text-foreground relative inline-flex cursor-pointer touch-manipulation h-8 pointer-coarse:h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-colors group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start disabled:pointer-events-none disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0 [&_ng-icon:not([class*='text-'])]:text-base`,
      "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent group-data-[variant=line]/tabs-list:data-active:border-transparent",
      "data-active:bg-background data-active:border-input-line data-active:text-foreground",
      "after:bg-foreground after:absolute after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100",
    ]);
  }
}
