import { Directive, input, signal } from "@angular/core";
import { BrnButton } from "@spartan-ng/brain/button";
import { classes } from "@spartan-ng/helm/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { ClassValue } from "clsx";
import { injectBrnButtonConfig } from "./hlm-button.token";

// The admin's density (plan 5): 32px with a mouse, 44px on touch, 4px corners. Focus draws the
// site's ring, the 2px accent outline from styles.css's `:focus-visible`, which forced colours keep.
export const buttonVariants = cva(
  "data-[matches-spartan-invalid=true]:ring-destructive/20 dark:data-[matches-spartan-invalid=true]:ring-destructive/40 data-[matches-spartan-invalid=true]:border-destructive dark:data-[matches-spartan-invalid=true]:border-destructive/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium data-[matches-spartan-invalid=true]:ring-3 [&_ng-icon:not([class*='text-'])]:text-[calc(var(--spacing)*4)] group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap cursor-pointer touch-manipulation transition-[color,background-color,border-color,opacity] select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_ng-icon]:pointer-events-none [&_ng-icon]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-input-line bg-transparent hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        // `/15` on hover in light: `/20` puts the text under 4.5:1.
        destructive:
          "bg-destructive/10 hover:bg-destructive/15 dark:bg-destructive/20 dark:hover:bg-destructive/30 text-destructive",
        link: "text-primary underline-offset-4 hover:underline",
        // The one orange fill: Publish, while changes wait (plan 5, rule 5). 8% lighter on hover.
        signal:
          "bg-signal text-signal-foreground hover:bg-[color-mix(in_srgb,var(--signal)_92%,white)]",
      },
      size: {
        default:
          "h-8 pointer-coarse:h-11 gap-1.5 px-3 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),8px)] px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_ng-icon:not([class*='text-'])]:text-[calc(var(--spacing)*3)]",
        sm: "h-8 pointer-coarse:h-11 gap-1 px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-10 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-8 pointer-coarse:size-11",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),8px)] in-data-[slot=button-group]:rounded-md [&_ng-icon:not([class*='text-'])]:text-[calc(var(--spacing)*3)]",
        "icon-sm": "size-8 pointer-coarse:size-11 in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

@Directive({
  selector: "button[hlmBtn], a[hlmBtn]",
  exportAs: "hlmBtn",
  hostDirectives: [{ directive: BrnButton, inputs: ["disabled"] }],
  host: {
    "data-slot": "button",
  },
})
export class HlmButton {
  private readonly _config = injectBrnButtonConfig();

  private readonly _additionalClasses = signal<ClassValue>("");

  public readonly variant = input<ButtonVariants["variant"]>(this._config.variant);

  public readonly size = input<ButtonVariants["size"]>(this._config.size);

  constructor() {
    classes(() => [
      buttonVariants({ variant: this.variant(), size: this.size() }),
      this._additionalClasses(),
    ]);
  }

  setClass(classes: string): void {
    this._additionalClasses.set(classes);
  }
}
