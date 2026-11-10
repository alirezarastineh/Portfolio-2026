import { Directive, input } from "@angular/core";
import { BrnToggle } from "@spartan-ng/brain/toggle";
import { classes } from "@spartan-ng/helm/utils";
import { cva, type VariantProps } from "class-variance-authority";

export const toggleVariants = cva(
  // Pressed is inverted, as the prototype's switches: a fill in the muted grey read 1.2:1 on the page.
  "hover:text-foreground hover:bg-muted aria-pressed:bg-foreground aria-pressed:text-background data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 gap-1 rounded-lg text-sm font-medium transition-colors [&_ng-icon:not([class*='text-'])]:text-[calc(var(--spacing)*4)] group/toggle inline-flex items-center justify-center whitespace-nowrap cursor-pointer touch-manipulation disabled:pointer-events-none disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border-input-line hover:bg-muted border bg-transparent",
      },
      size: {
        default: "h-8 pointer-coarse:h-11 min-w-8 pointer-coarse:min-w-11 px-2.5",
        sm: "h-8 pointer-coarse:h-11 min-w-8 pointer-coarse:min-w-11 px-2.5",
        lg: "h-10 min-w-10 px-2.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
export type ToggleVariants = VariantProps<typeof toggleVariants>;

@Directive({
  selector: "button[hlmToggle]",
  hostDirectives: [
    {
      directive: BrnToggle,
      inputs: ["id", "value", "disabled", "state", "aria-label", "type"],
      outputs: ["stateChange"],
    },
  ],
  host: {
    "data-slot": "toggle",
  },
})
export class HlmToggle {
  public readonly variant = input<ToggleVariants["variant"]>("default");
  public readonly size = input<ToggleVariants["size"]>("default");
  constructor() {
    classes(() =>
      toggleVariants({
        variant: this.variant(),
        size: this.size(),
      }),
    );
  }
}
