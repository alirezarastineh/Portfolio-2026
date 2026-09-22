import { Directive } from "@angular/core";
import { BrnSheetClose } from "@spartan-ng/brain/sheet";

@Directive({
  selector: "button[hlmSheetClose]",
  // The vendored source forwarded `inputs: ["delay"]`, but the installed
  // BrnSheetClose (brain 1.4.1) declares no inputs at all — a version skew between
  // the generated helm code and the package. It failed the template compile
  // for anything importing this directive. Do not re-add without checking the
  // installed brain version first.
  hostDirectives: [{ directive: BrnSheetClose }],
  host: {
    "data-slot": "sheet-close",
  },
})
export class HlmSheetClose {}
