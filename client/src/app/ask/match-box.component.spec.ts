import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { LanguageService } from "../services/language.service";
import { MatchBoxComponent } from "./match-box.component";

/** The brief's paste box (visitor plan V20): its label, counter and keys, and nothing sent unasked. */
function mount(lang: "en" | "de" = "en") {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [{ provide: LanguageService, useValue: { lang: signal(lang) } }],
  });
  const fixture = TestBed.createComponent(MatchBoxComponent);
  fixture.componentRef.setInput("kind", "project");
  const sent: string[] = [];
  let dismissed = 0;
  fixture.componentInstance.sent.subscribe((brief) => sent.push(brief));
  fixture.componentInstance.dismissed.subscribe(() => dismissed++);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const box = el.querySelector("textarea")!;
  const type = (text: string) => {
    box.value = text;
    box.dispatchEvent(new Event("input"));
    fixture.detectChanges();
  };
  const key = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    box.dispatchEvent(event);
    return event;
  };
  return { fixture, el, box, type, key, sent, dismissed: () => dismissed };
}

describe("the brief's paste box (visitor plan V20)", () => {
  it("names the kind's box, tells where the text goes, and counts it to 4,000", () => {
    const { el, box, type } = mount();
    const label = el.querySelector("label")!;
    expect(label.textContent?.trim()).toBe("Describe your project");
    expect(label.htmlFor).toBe(box.id);
    expect(box.getAttribute("maxlength")).toBe("4000");
    const described = (box.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described.map((id) => el.querySelector(`#${id}`)?.textContent?.trim())).toEqual([
      "Don't paste confidential details: the text goes to the model provider.",
      `0 / ${new Intl.NumberFormat("en").format(4000)} characters`,
    ]);
    type("A data platform");
    expect(el.querySelector(`#${described[1]}`)?.textContent?.trim()).toBe(
      `15 / ${new Intl.NumberFormat("en").format(4000)} characters`,
    );
  });

  it("sends the brief trimmed on its button or Ctrl+Enter, never an empty one", () => {
    const { el, type, key, sent } = mount();
    const send = el.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(send.disabled).toBe(true);
    type("   ");
    expect(send.disabled).toBe(true);
    expect(key({ key: "Enter", ctrlKey: true }).defaultPrevented).toBe(true);
    expect(sent).toEqual([]);
    type("  Needs: OCR and a review queue.  ");
    expect(send.disabled).toBe(false);
    key({ key: "Enter", metaKey: true });
    send.click();
    expect(sent).toEqual(["Needs: OCR and a review queue.", "Needs: OCR and a review queue."]);
    // A plain Enter is a new line in a brief.
    expect(key({ key: "Enter" }).defaultPrevented).toBe(false);
  });

  it("puts itself away on Esc or cancel, the sheet around it left open", () => {
    const { el, key, dismissed } = mount();
    let reached = false;
    el.parentElement?.addEventListener("keydown", () => (reached = true));
    expect(key({ key: "Escape" }).defaultPrevented).toBe(true);
    expect(reached).toBe(false);
    el.querySelector<HTMLButtonElement>('button[type="button"]')!.click();
    expect(dismissed()).toBe(2);
  });

  it("speaks German on a German page", () => {
    const { el } = mount("de");
    expect(el.querySelector("label")?.textContent?.trim()).toBe("Beschreibe dein Projekt");
    expect(el.querySelector('button[type="submit"]')?.textContent?.trim()).toBe("abgleichen");
  });
});
