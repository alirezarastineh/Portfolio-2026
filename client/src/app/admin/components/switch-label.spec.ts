import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { describe, expect, it } from "vitest";

/** Two rows, each switch inside its own label and given no id, as the admin's lists have them. */
@Component({
  imports: [HlmSwitch],
  template: `
    <label><hlm-switch [checked]="true" /><span>Show Atlas on the site</span></label>
    <label><hlm-switch /><span>Show Borealis on the site</span></label>
  `,
})
class TwoRows {}

describe("hlm-switch", () => {
  /**
   * Found in Part C: without an id, brn named every label `null-label`, so each
   * switch on a page was announced by the first one's label.
   */
  it("is named by its own label when given no id", async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(TwoRows);
    fixture.detectChanges();
    await fixture.whenStable();

    const root: HTMLElement = fixture.nativeElement;
    const names = Array.from(root.querySelectorAll('[role="switch"]'), (button) =>
      (button.getAttribute("aria-labelledby") ?? "")
        .split(" ")
        .map((ref) => root.querySelector(`#${ref}`)?.textContent?.trim())
        .join(" "),
    );
    expect(names).toEqual(["Show Atlas on the site", "Show Borealis on the site"]);
    expect(root.querySelector("#null-label")).toBeNull();
  });
});
