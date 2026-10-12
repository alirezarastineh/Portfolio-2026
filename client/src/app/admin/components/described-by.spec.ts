import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmTextarea } from "@spartan-ng/helm/textarea";
import { describe, expect, it } from "vitest";

/** A field with a hint that is always there, and one whose notes come and go, as the admin has them. */
@Component({
  imports: [HlmInput, HlmTextarea],
  template: `
    <input hlmInput aria-label="Date" [aria-describedby]="'date-hint'" />
    <p id="date-hint">Leave empty while it is a draft.</p>
    <textarea hlmTextarea aria-label="Answer" [aria-describedby]="notes()"></textarea>
    <p id="answer-draft">Needs your eye.</p>
  `,
})
class Fields {
  readonly notes = signal<string | null>("answer-draft");
}

/** An element's opening tag, its quoted attribute values read whole (a `>` or `<` inside one is no end). */
const TAG = /<[a-z][\w-]*(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
/** The old binding, bracketed or interpolated. */
const OLD_BINDING = /\battr\.aria-describedby\b/;

/** The hlm fields given the old binding, in a source. */
const offendersIn = (text: string): string[] =>
  [...text.matchAll(TAG)]
    .map(([tag]) => tag)
    .filter((tag) => /\bhlm(?:Input|Textarea)\b/.test(tag) && OLD_BINDING.test(tag));

/** The app's sources under src/app, specs aside. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

describe("hlmInput and hlmTextarea", () => {
  /**
   * Found in Phase 28: brn's described-by directive owns the attribute, so its
   * first pass removed a constant `[attr.aria-describedby]`: the hint was never
   * read. Its input is exposed, and the admin binds `[aria-describedby]`.
   */
  it("keep the aria-describedby they are given, from the first render on", async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(Fields);
    fixture.detectChanges();
    await fixture.whenStable();

    const root: HTMLElement = fixture.nativeElement;
    const input = root.querySelector("input")!;
    const textarea = root.querySelector("textarea")!;
    expect(input.getAttribute("aria-describedby")).toBe("date-hint");
    expect(textarea.getAttribute("aria-describedby")).toBe("answer-draft");

    fixture.componentInstance.notes.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(textarea.hasAttribute("aria-describedby")).toBe(false);
  });

  it("are never given [attr.aria-describedby] in the app, which brn's first pass would undo", () => {
    // The scan finds the old binding wherever a tag hides it.
    for (const tag of [
      `<input hlmInput [attr.aria-describedby]="'x'" />`,
      `<input hlmInput [disabled]="rows().length > 50" [attr.aria-describedby]="'x'" />`,
      `<input [attr.aria-invalid]="n < 3 ? true : null" [attr.aria-describedby]="'x'" hlmInput />`,
      `<textarea hlmTextarea attr.aria-describedby="{{ hint }}"></textarea>`,
    ]) {
      expect(offendersIn(tag), tag).toHaveLength(1);
    }
    expect(offendersIn(`<input hlmInput [aria-describedby]="'x'" />`)).toEqual([]);

    const app = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const offenders = sources(app).flatMap((file) =>
      offendersIn(readFileSync(file, "utf8")).map(
        (tag) => `${file}: ${tag.replace(/\s+/g, " ").slice(0, 120)}`,
      ),
    );
    expect(offenders).toEqual([]);
  });
});
