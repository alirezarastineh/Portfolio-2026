import { FormControl, FormGroup } from "@angular/forms";
import { TestBed } from "@angular/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { AdminApiService } from "../admin-api.service";
import { CopilotLedger } from "../copilot-ledger";
import type { CopilotDraft, DraftVerdict } from "../copilot-skills";
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

  /** Spartan's label owns `for`: a plain `[attr.for]` binding was overwritten, and nothing was named. */
  it("names each field by its label, and its language when both show", () => {
    const root: HTMLElement = ctx.fixture.nativeElement;
    const name = (id: string) =>
      (root.querySelector(`#${id}`)?.getAttribute("aria-labelledby") ?? "")
        .split(" ")
        .map((ref) => root.querySelector(`#${ref}`)?.textContent?.trim())
        .join(" ");

    expect(name("greeting-en")).toBe("Greeting EN");
    expect(name("greeting-de")).toBe("Greeting DE");

    ctx.fixture.componentRef.setInput("view", "de");
    ctx.fixture.detectChanges();
    expect(root.querySelector("label")?.getAttribute("for")).toBe("greeting-de");
    expect(root.querySelector("#greeting-de")?.hasAttribute("aria-labelledby")).toBe(false);
  });

  it("renders no counter or cap without maxLength", () => {
    const input = ctx.fixture.nativeElement.querySelector("#greeting-en") as HTMLInputElement;
    expect(input.getAttribute("maxlength")).toBeNull();
    expect(text(ctx.fixture)).not.toContain("/ ");
  });
});

/** The copilot's drafts in a field pair: judged when the editor saves or discards (plan phase 27). */
describe("FieldPairComponent's drafts", () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  /** A field pair in a section editor's form, its copilot answering as `copilot` does. */
  function mounted(copilot: (input?: unknown) => Promise<unknown>, german = "", maxLength = 0) {
    TestBed.resetTestingModule();
    const reported: DraftVerdict[][] = [];
    TestBed.configureTestingModule({
      providers: [
        CopilotLedger,
        {
          provide: AdminApiService,
          useValue: {
            copilot,
            reportDrafts: async (outcomes: DraftVerdict[]) => {
              reported.push(outcomes);
              return { ok: true, data: { recorded: outcomes.length } };
            },
          },
        },
      ],
    });
    // As a section editor holds them: one form, saved and discarded whole.
    const form = new FormGroup({
      en: new FormControl("Hello world", { nonNullable: true }),
      de: new FormControl(german, { nonNullable: true }),
    });
    const fixture = TestBed.createComponent(FieldPairComponent);
    fixture.componentRef.setInput("id", "greeting");
    fixture.componentRef.setInput("label", "Greeting");
    fixture.componentRef.setInput("controlEn", form.controls.en);
    fixture.componentRef.setInput("controlDe", form.controls.de);
    fixture.componentRef.setInput("maxLength", maxLength);
    fixture.detectChanges();
    const button = Array.from(
      fixture.nativeElement.querySelectorAll("button") as NodeListOf<HTMLButtonElement>,
    ).find(
      (b) =>
        b.getAttribute("aria-label") ===
        "Translate → DE: the English Greeting into German, with AI",
    )!;
    return { fixture, form, reported, button };
  }

  async function translated(
    draft: CopilotDraft = { text: "Hallo Welt", model: "m", suggestionId: "s1" },
    german = "",
    /** German typed and not saved before the translation. */
    typed?: string,
  ) {
    const mount = mounted(async () => ({ ok: true, data: draft }), german);
    if (typed !== undefined) type(mount.form.controls.de, typed);
    mount.button.click();
    await tick();
    expect(mount.form.controls.de.value).toBe(draft.text);
    expect(mount.form.controls.de.dirty).toBe(true);
    return mount;
  }

  it("drops a draft that comes back after the field pair closed, and leaves the field alone", async () => {
    let answer!: (result: unknown) => void;
    const { fixture, form, reported, button } = mounted(
      () => new Promise((resolve) => (answer = resolve)),
    );
    button.click();
    fixture.destroy(); // the admin left before the model answered
    answer({ ok: true, data: { text: "Hallo Welt", model: "m", suggestionId: "s9" } });
    await tick();
    expect(form.controls.de.value).toBe("");
    expect(form.controls.de.dirty).toBe(false);
    expect(reported).toEqual([[{ id: "s9", outcome: "discarded", distance: null }]]);
  });

  it("reports a draft saved as it came as kept", async () => {
    const { form, reported } = await translated();
    form.markAsPristine(); // the editor's save
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "kept" }]]);
  });

  it("reports a draft changed before the save as edited, with the change in words", async () => {
    const { form, reported } = await translated();
    type(form.controls.de, "Hallo schöne Welt");
    form.markAsPristine();
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "edited", distance: 1 }]]);
  });

  it("reports a draft the editor's discard took back as discarded", async () => {
    const { form, reported } = await translated();
    form.reset({ en: "Hello world", de: "" }); // the editor's discard
    form.markAsPristine();
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "discarded", distance: null }]]);
  });

  it("reports a discarded draft as discarded even when it was close to the old text", async () => {
    const { form, reported } = await translated(
      { text: "Hallo Welt", model: "m", suggestionId: "s1" },
      "Hallo Welt!",
    );
    form.reset({ en: "Hello world", de: "Hallo Welt!" });
    form.markAsPristine();
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "discarded", distance: null }]]);
  });

  it("reports a draft over unsaved edits as discarded when the discard brings back a text like it", async () => {
    // Saved "Hallo Welt"; "Servus" typed; the draft "Hallo Welt!" over it; then Discard.
    const { form, reported } = await translated(
      { text: "Hallo Welt!", model: "m", suggestionId: "s1" },
      "Hallo Welt",
      "Servus",
    );
    form.reset({ en: "Hello world", de: "Hallo Welt" });
    form.markAsPristine();
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "discarded", distance: null }]]);
  });

  it("reports both drafts discarded when a second replaced the first and Discard took it back", async () => {
    const { form, reported, button } = await translated();
    button.click(); // the same draft again: it replaces the first, unsaved
    await tick();
    form.reset({ en: "Hello world", de: "" });
    form.markAsPristine();
    await tick();
    expect(reported.flat()).toEqual([
      { id: "s1", outcome: "discarded", distance: null },
      { id: "s1", outcome: "discarded", distance: null },
    ]);
  });

  it("reports a draft left unsaved as discarded when the field goes", async () => {
    const { fixture, reported } = await translated();
    fixture.destroy();
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "discarded", distance: null }]]);
  });

  it("sends the field's limit, lands a draft over it whole, and says why it needs a look (plan phase 28)", async () => {
    const draft = {
      text: "Hallo zusammen, Welt",
      model: "m",
      suggestionId: "s1",
      needsReview: ["8 characters over the limit of 12"],
    };
    const sent: unknown[] = [];
    const mount = mounted(
      async (input?: unknown) => {
        sent.push(input);
        return { ok: true, data: draft };
      },
      "",
      12,
    );
    const root: HTMLElement = mount.fixture.nativeElement;
    // The notes' live region is there before any draft, so a draft's notes are read out.
    expect(root.querySelector("#greeting-de-draft")?.closest("[aria-live=polite]")).not.toBeNull();
    mount.button.click();
    await tick();
    mount.fixture.detectChanges();
    // The limit is the server's check to run: the request carries it.
    expect(sent).toEqual([
      { task: "translate", text: "Hello world", from: "en", to: "de", html: false, maxLength: 12 },
    ]);
    // Never cut: the whole draft, with what it fails beside the field and read with it.
    expect(mount.form.controls.de.value).toBe("Hallo zusammen, Welt");
    expect(root.querySelector("#greeting-de-draft")?.textContent?.trim()).toBe(
      "Needs your eye: 8 characters over the limit of 12.",
    );
    expect(root.querySelector("#greeting-de")?.getAttribute("aria-describedby")).toBe(
      "greeting-de-draft",
    );
  });

  it("offers the other drafts, and judges the one the admin used", async () => {
    const { fixture, form, reported } = await translated({
      text: "Erster Entwurf.",
      model: "m",
      suggestionId: "s1",
      lead: "outcome",
      alternatives: [{ text: "Zweiter Entwurf.", lead: "problem" }],
    });
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const use = Array.from(root.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Use this draft (problem first) for Greeting DE",
    );
    use!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(form.controls.de.value).toBe("Zweiter Entwurf.");
    // Its button went with the choice: the field it filled has the focus.
    expect(document.activeElement?.id).toBe("greeting-de");
    // The draft it replaced is offered in turn.
    expect(root.textContent).toContain("Erster Entwurf.");
    form.markAsPristine();
    await tick();
    expect(reported).toEqual([[{ id: "s1", outcome: "kept", pick: 1 }]]);
    fixture.detectChanges();
    expect(root.textContent).not.toContain("Use this");
  });

  it("reports nothing for a draft that came without an id", async () => {
    const { form, reported } = await translated({ text: "Hallo Welt", model: "m" });
    form.markAsPristine();
    await tick();
    expect(reported).toEqual([]);
  });
});
