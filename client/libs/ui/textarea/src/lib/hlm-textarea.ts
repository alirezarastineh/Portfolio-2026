import { Directive, input } from "@angular/core";
import { BrnFieldControlDescribedBy } from "@spartan-ng/brain/field";
import { BrnTextarea } from "@spartan-ng/brain/textarea";
import { classes } from "@spartan-ng/helm/utils";
import { cva, type VariantProps } from "class-variance-authority";

// As hlmInput: the edge at 3:1, 16px text on touch; it grows with its text.
export const textareaVariants = cva(
  "border-input-line placeholder:text-faint-foreground flex [field-sizing:content] min-h-16 w-full rounded-lg border bg-card px-2 py-2 text-sm pointer-coarse:text-base transition-[color,border-color] disabled:cursor-not-allowed disabled:opacity-50",
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
type TextareaVariants = VariantProps<typeof textareaVariants>;

@Directive({
  selector: "[hlmTextarea]",
  hostDirectives: [
    { directive: BrnTextarea, inputs: ["id"] },
    // Exposed: brn owns the attribute, so a template's `[attr.aria-describedby]` loses to it.
    { directive: BrnFieldControlDescribedBy, inputs: ["aria-describedby"] },
  ],
  host: {
    "data-slot": "textarea",
  },
})
export class HlmTextarea {
  /** Controls the error visual state of the textarea.
   * Defaults to 'auto', which infers the state from the associated form control.
   */
  public readonly error = input<TextareaVariants["error"]>("auto");

  constructor() {
    classes(() => textareaVariants({ error: this.error() }));
  }
}
