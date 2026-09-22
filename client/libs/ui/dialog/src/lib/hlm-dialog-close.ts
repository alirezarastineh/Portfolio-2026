import { Directive } from "@angular/core";
import { BrnDialogClose } from "@spartan-ng/brain/dialog";

@Directive({
  selector: "button[hlmDialogClose]",
  // The vendored source forwarded `inputs: ["delay"]`, but the installed
  // BrnDialogClose (brain 1.4.1) declares no inputs at all — a version skew between
  // the generated helm code and the package. It failed the template compile
  // for anything importing this directive. Do not re-add without checking the
  // installed brain version first.
  hostDirectives: [{ directive: BrnDialogClose }],
  host: {
    "data-slot": "dialog-close",
  },
})
export class HlmDialogClose {}
