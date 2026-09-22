import { FormControl } from "@angular/forms";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { FieldPairComponent } from "./field-pair.component";

function setup(maxLength = 0) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});

  const en = new FormControl("Hello", { nonNullable: true });
  const de = new FormControl("Hallo", { nonNullable: true });

  const fixture = TestBed.createComponent(FieldPairComponent);
  fixture.componentRef.setInput("id", "greeting");
  fixture.componentRef.setInput("label", "Greeting");
  fixture.componentRef.setInput("controlEn", en);
  fixture.componentRef.setInput("controlDe", de);
  fixture.componentRef.setInput("maxLength", maxLength);
  fixture.detectChanges();

  return { fixture, en, de };
}

/** Mirrors what the DOM value accessor does on a keystroke: dirty, then set. */
function type(control: FormControl<string>, value: string): void {
  control.markAsDirty();
  control.setValue(value);
}

const text = (fixture: ReturnType<typeof setup>["fixture"]): string =>
  fixture.nativeElement.textContent ?? "";

describe("FieldPairComponent", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  it("shows no stale warning for freshly loaded content", () => {
    expect(text(ctx.fixture)).not.toContain("DE may be stale");
  });

  /**
   * The point of the badge: an English edit that nobody carried over to German
   * is the most common way a bilingual site quietly drifts.
   */
  it("warns when English changes after German", () => {
    type(ctx.en, "Hello there");
    ctx.fixture.detectChanges();
    expect(text(ctx.fixture)).toContain("DE may be stale");
  });

  it("clears the warning once German is edited too", () => {
    type(ctx.en, "Hello there");
    type(ctx.de, "Hallo zusammen");
    ctx.fixture.detectChanges();
    expect(text(ctx.fixture)).not.toContain("DE may be stale");
  });

  it("clears the warning when copying English to German", () => {
    type(ctx.en, "Hello there");
    ctx.fixture.detectChanges();

    const copy = Array.from(
      ctx.fixture.nativeElement.querySelectorAll("button") as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.includes("EN → DE"));
    copy?.click();
    ctx.fixture.detectChanges();

    expect(ctx.de.value).toBe("Hello there");
    expect(ctx.de.dirty).toBe(true);
    expect(text(ctx.fixture)).not.toContain("DE may be stale");
  });

  /** A discard resets the form programmatically; that is not an edit. */
  it("does not treat a programmatic reset as an edit", () => {
    type(ctx.en, "Hello there");
    ctx.en.reset("Hello");
    ctx.fixture.detectChanges();
    expect(text(ctx.fixture)).not.toContain("DE may be stale");
  });

  it("shows a length counter and caps input when maxLength is set", () => {
    const { fixture } = setup(20);
    expect(text(fixture)).toContain("5 / 20");

    const input = fixture.nativeElement.querySelector("#greeting-en") as HTMLInputElement;
    expect(input.getAttribute("maxlength")).toBe("20");
  });

  it("renders no counter or cap without maxLength", () => {
    const input = ctx.fixture.nativeElement.querySelector("#greeting-en") as HTMLInputElement;
    expect(input.getAttribute("maxlength")).toBeNull();
    expect(text(ctx.fixture)).not.toContain("/ ");
  });
});
