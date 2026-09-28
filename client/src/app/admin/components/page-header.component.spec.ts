import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import type { LocaleView } from "./field-pair.component";
import { AdminPageHeaderComponent } from "./page-header.component";

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AdminPageHeaderComponent],
  template: `
    <div class="flex flex-col gap-6">
      <app-page-header
        title="Projects"
        description="The cards on the home page."
        meta="/work/atlas"
        preview="/admin/preview/en#projects"
        [(view)]="view"
      >
        <span headerStatus>featured</span>
        <button headerActions type="button">Add project</button>
      </app-page-header>
    </div>
  `,
})
class BilingualHost {
  readonly view = signal<LocaleView>("both");
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AdminPageHeaderComponent],
  template: `<app-page-header title="Inbox" />`,
})
class PlainHost {}

function render<T>(host: new () => T) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe("AdminPageHeaderComponent", () => {
  it("is the page's one h1, with the line under it and the slots filled", () => {
    const { root } = render(BilingualHost);

    expect(root.querySelectorAll("h1")).toHaveLength(1);
    expect(root.querySelector("h1")?.textContent?.trim()).toBe("Projects");
    expect(root.textContent).toContain("/work/atlas");
    expect(root.textContent).toContain("The cards on the home page.");
    expect(root.textContent).toContain("featured");
    expect(root.querySelector("button")?.textContent).toContain("Add project");
  });

  /** A `contents` host: the row is a child of the page's column, which it sticks within. */
  it("puts the sticky row straight into the page's column", () => {
    const { root } = render(BilingualHost);
    const column = root.querySelector(".flex.flex-col.gap-6");
    const row = root.querySelector("h1")?.closest(".sticky");

    expect(root.querySelector("app-page-header")?.classList).toContain("contents");
    expect(row?.parentElement?.parentElement).toBe(column);
  });

  it("opens the draft in a new tab, and says so", () => {
    const { root } = render(BilingualHost);
    const link = root.querySelector<HTMLAnchorElement>('a[href="/admin/preview/en#projects"]');

    expect(link?.target).toBe("_blank");
    expect(link?.textContent).toContain("(opens in a new tab)");
  });

  it("switches the language view when bound, and has no switch when not", async () => {
    const bilingual = render(BilingualHost);
    const group = bilingual.root.querySelector('[role=group][aria-label="Language view"]');
    const options = group?.querySelectorAll<HTMLButtonElement>("button") ?? [];
    expect([...options].map((b) => b.textContent?.trim())).toEqual(["en", "de", "both"]);
    expect(options[2]?.getAttribute("aria-pressed")).toBe("true");

    options[1]?.click();
    await bilingual.fixture.whenStable();
    expect(bilingual.fixture.componentInstance.view()).toBe("de");
    expect(options[1]?.getAttribute("aria-pressed")).toBe("true");

    const plain = render(PlainHost);
    expect(plain.root.querySelector("[role=group]")).toBeNull();
    expect(plain.root.querySelector("a")).toBeNull();
  });
});
