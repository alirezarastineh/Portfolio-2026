import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { FormsModule } from "@angular/forms";
import { describe, expect, it, vi } from "vitest";

import { StringListComponent } from "./string-list.component";

@Component({
  imports: [FormsModule, StringListComponent],
  template: `
    <form>
      <app-string-list label="Skills" [(value)]="items" />
    </form>
  `,
})
class HostComponent {
  readonly items = signal(["TypeScript", "Postgres", "Hono"]);
}

describe("StringListComponent", () => {
  it("keeps its rows out of a page's form, each with its own value", async () => {
    // In a production build, nameless rows inside a form (the experience
    // sheet) registered with it as one control and all showed the last value;
    // a development build only warns (NG01354) about it.
    const warn = vi.spyOn(console, "warn");
    const error = vi.spyOn(console, "error");
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const values = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>("input"),
    ).map((input) => input.value);
    expect(values).toEqual(["TypeScript", "Postgres", "Hono"]);
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().map(String).join("\n");
    expect(logged).not.toContain("NG01354");
    warn.mockRestore();
    error.mockRestore();
  });
});
