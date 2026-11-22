import {
  ChangeDetectionStrategy,
  Component,
  provideZonelessChangeDetection,
  signal,
} from "@angular/core";
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
    <app-load-error id="why" compact title="Could not load the runs" reason="network_error" />
    <app-form-skeleton id="fields" [rows]="4" />
    <app-form-skeleton id="list" kind="list" [rows]="3" label="Loading posts…" />
    <app-not-found-state what="post" back="/admin/writing" backLabel="All posts" />
  `,
})
class Host {
  retries = 0;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadErrorComponent],
  template: `
    <h2 #heading tabindex="-1">The runs</h2>
    @if (failed()) {
      <app-load-error
        compact
        title="Could not load the runs"
        [refocus]="heading"
        (retry)="failed.set(false)"
      />
    }
  `,
})
class Report {
  readonly failed = signal(true);
}

function query<T extends Element = HTMLElement>(parent: ParentNode, selector: string): T {
  const el = parent.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Expected element matching ${selector}`);
  }
  return el;
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
  it("says what failed and why in words, never the code, and asks again on Try again", () => {
    const { fixture, root } = render();
    const page = query(root, "#page");

    expect(page.querySelector("[role=alert]")).not.toBeNull();
    expect(page.querySelector("h2")?.textContent).toBe("Could not load the posts");
    expect(page.textContent).toContain("The API failed (HTTP 502): try again; its log says why.");
    expect(page.textContent).not.toContain("http_502");

    query<HTMLButtonElement>(page, "button").click();
    query<HTMLButtonElement>(root, "#tile button").click();
    expect(fixture.componentInstance.retries).toBe(2);
  });

  it("fits a tile in one line, without a heading of its own, the reason in words under it", () => {
    const { root } = render();
    const tile = query(root, "#tile");
    expect(tile.querySelector("h2")).toBeNull();
    expect(tile.textContent?.trim().replaceAll(/\s+/g, " ")).toBe("Could not load Try again");

    const why = query(root, "#why [role=alert]");
    expect(why.textContent).toContain("Could not load the runs");
    expect(why.textContent).toContain(
      "The API did not answer: check the connection, then try again.",
    );
    expect(why.textContent).not.toContain("network_error");
  });

  it("gives the focus to the section's heading when Try again brings it back", async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(Report);
    document.body.append(fixture.nativeElement as HTMLElement);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const again = query<HTMLButtonElement>(root, "button");
    again.focus();
    again.click();
    await fixture.whenStable();

    expect(root.querySelector("[role=alert]")).toBeNull();
    expect(document.activeElement).toBe(query(root, "h2"));
    fixture.destroy();
  });

  it("draws placeholders shaped like the rows that come, announcing only the label", () => {
    const { root } = render();
    const fields = query(root, "#fields [role=status]");
    const list = query(root, "#list [role=status]");

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
