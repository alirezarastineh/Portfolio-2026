import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SaveBarComponent } from "./editor-chrome.component";

@Component({
  imports: [SaveBarComponent],
  template: `
    <app-save-bar
      [dirty]="dirty()"
      [saving]="saving()"
      [problems]="problems()"
      (save)="saves = saves + 1"
      (discard)="discards = discards + 1"
    />
  `,
})
class HostComponent {
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly problems = signal(0);
  saves = 0;
  discards = 0;
}

function setup() {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const status = () =>
    (fixture.nativeElement as HTMLElement).querySelector('[role="status"]')?.textContent?.trim();
  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent("keydown", { cancelable: true, ...init });
    document.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  return { fixture, host: fixture.componentInstance, status, press };
}

describe("SaveBarComponent", () => {
  afterEach(() => vi.useRealTimers());

  it("saves on Ctrl+S or ⌘S only when there is something to save", () => {
    vi.useFakeTimers();
    const { host, fixture, press } = setup();

    const idle = press({ key: "s", ctrlKey: true });
    // Never the browser's "Save page as", even with nothing to save.
    expect(idle.defaultPrevented).toBe(true);
    vi.advanceTimersByTime(100);
    expect(host.saves).toBe(0);

    host.dirty.set(true);
    fixture.detectChanges();
    press({ key: "s", ctrlKey: true });
    press({ key: "S", metaKey: true });
    expect(host.saves).toBe(2);

    // Other shortcuts are left alone.
    const other = press({ key: "s", ctrlKey: true, shiftKey: true });
    expect(other.defaultPrevented).toBe(false);
    expect(host.saves).toBe(2);
  });

  it("still saves an edit made just before the shortcut, once the view catches up", () => {
    vi.useFakeTimers();
    const { host, fixture } = setup();

    // The keystroke's edit has not reached the bar's input yet.
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }),
    );
    host.dirty.set(true);
    fixture.detectChanges();
    expect(host.saves).toBe(0);

    vi.advanceTimersByTime(60);
    expect(host.saves).toBe(1);
  });

  it("says whether the editor is unsaved, saving, saved or has problems", () => {
    const { host, fixture, status } = setup();
    expect(status()).toMatch(/^saved — /);

    host.dirty.set(true);
    fixture.detectChanges();
    expect(status()).toBe("unsaved changes");

    host.saving.set(true);
    fixture.detectChanges();
    expect(status()).toBe("saving…");

    host.saving.set(false);
    host.dirty.set(false);
    fixture.detectChanges();
    expect(status()).toMatch(/^saved at .+ — publish from the dashboard/);

    host.problems.set(2);
    fixture.detectChanges();
    expect(status()).toBe("2 fields need attention");
  });
});
