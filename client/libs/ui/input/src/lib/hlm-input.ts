import { Directive, input, linkedSignal } from "@angular/core";
import { BrnFieldControlDescribedBy } from "@spartan-ng/brain/field";
import { BrnInput } from "@spartan-ng/brain/input";
import { classes } from "@spartan-ng/helm/utils";
import { cva, type VariantProps } from "class-variance-authority";

// 36px with a mouse; 44px on touch with 16px text, so iOS does not zoom. The edge clears 3:1.
export const inputVariants = cva(
  "file:text-foreground placeholder:text-faint-foreground selection:bg-primary selection:text-primary-foreground border-input-line flex h-9 pointer-coarse:h-11 w-full min-w-0 rounded-lg border bg-card px-2 py-1 text-sm pointer-coarse:text-base transition-[color,border-color] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      error: {
        auto: "data-[matches-spartan-invalid=true]:border-destructive",
        true: "border-destructive",
      },
    },
    defaultVariants: {
      error: "auto",
    },
  },
);
type InputVariants = VariantProps<typeof inputVariants>;

@Directive({
  selector: "[hlmInput]",
  hostDirectives: [
    { directive: BrnInput, inputs: ["id"] },
    // Exposed: brn owns the attribute, so a template's `[attr.aria-describedby]` loses to it.
    { directive: BrnFieldControlDescribedBy, inputs: ["aria-describedby"] },
  ],
})
export class HlmInput {
  /** Controls the error visual state of the input.
   * Defaults to 'auto', which infers the state from the associated form control.
   */
  public readonly error = input<InputVariants["error"]>("auto");

  protected readonly _state = linkedSignal(() => ({ error: this.error() }));

  constructor() {
    classes(() => inputVariants({ error: this._state().error }));
  }
}
