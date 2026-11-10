import type { NumberInput } from "@angular/cdk/coercion";
import { ChangeDetectionStrategy, Component, input, numberAttribute } from "@angular/core";
import { BrnInputOtpSlot } from "@spartan-ng/brain/input-otp";
import { classes } from "@spartan-ng/helm/utils";
import { HlmInputOtpFakeCaret } from "./hlm-input-otp-fake-caret";

@Component({
  selector: "hlm-input-otp-slot",
  imports: [BrnInputOtpSlot, HlmInputOtpFakeCaret],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    "data-slot": "input-otp-slot",
  },
  template: `
    <brn-input-otp-slot [index]="index()">
      <hlm-input-otp-fake-caret />
    </brn-input-otp-slot>
  `,
})
export class HlmInputOtpSlot {
  /** The index of the slot to render the char or a fake caret */
  public readonly index = input.required<number, NumberInput>({ transform: numberAttribute });

  constructor() {
    classes(() => [
      "bg-card border-input-line relative flex h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 items-center justify-center border-y border-r text-sm pointer-coarse:text-base transition-colors first:rounded-l-lg first:border-l last:rounded-r-lg",
      // The slot being typed in carries the site's ring: the input it stands for is hidden.
      'has-[brn-input-otp-slot[data-active="true"]]:z-10 has-[brn-input-otp-slot[data-active="true"]]:outline-2 has-[brn-input-otp-slot[data-active="true"]]:outline-accent-orange',
    ]);
  }
}
