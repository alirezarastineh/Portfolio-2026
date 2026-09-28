import { ChangeDetectionStrategy, Component, provideZonelessChangeDetection } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { describe, expect, it } from "vitest";

import {
  FormSkeletonComponent,
  LoadErrorComponent,
  NotFoundStateComponent,
} from "./load-state.component";

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormSkeletonComponent, LoadErrorComponent, NotFoundStateComponent],
  template: `
    <app-load-error
      id="page"
      title="Could not load the posts"
      reason="http_502"
      (retry)="retries = retries + 1"
    />
    <app-load-error id="tile" compact title="Could not load" (retry)="retries = retries + 1" />
    <app-form-skeleton id="fields" [rows]="4" />
    <app-form-skeleton id="list" kind="list" [rows]="3" label="Loading posts…" />
    <app-not-found-state what="post" back="/admin/writing" backLabel="All posts" />
  `,
})
class Host {
  retries = 0;
}

function render() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideRouter([])],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

describe("load states", () => {
  it("says what failed and why, and asks again on Try again", () => {
    const { fixture, root } = render();
    const page = root.querySelector("#page")!;

    expect(page.querySelector("[role=alert]")).not.toBeNull();
    expect(page.querySelector("h2")?.textContent).toBe("Could not load the posts");
    expect(page.textContent).toContain("http_502");

    page.querySelector("button")!.click();
    root.querySelector<HTMLButtonElement>("#tile button")!.click();
    expect(fixture.componentInstance.retries).toBe(2);
  });

  it("fits a tile in one line, without a heading of its own", () => {
    const tile = render().root.querySelector("#tile")!;
    expect(tile.querySelector("h2")).toBeNull();
    expect(tile.textContent).toContain("Could not load");
  });

  it("draws placeholders shaped like the rows that come, announcing only the label", () => {
    const { root } = render();
    const fields = root.querySelector("#fields [role=status]")!;
    const list = root.querySelector("#list [role=status]")!;

    expect(fields.querySelectorAll(":scope > [aria-hidden=true]")).toHaveLength(4);
    expect(list.querySelectorAll(":scope > [aria-hidden=true]")).toHaveLength(3);
    expect(list.querySelector(".sr-only")?.textContent).toBe("Loading posts…");
  });

  it("leads back to the list from something that is not there", () => {
    const back = render().root.querySelector<HTMLAnchorElement>("app-not-found-state a");
    expect(back?.getAttribute("href")).toBe("/admin/writing");
    expect(back?.textContent).toContain("All posts");
  });
});
