import { provideZonelessChangeDetection, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { toast } from "@spartan-ng/brain/sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AdminApiService,
  type ApiResult,
  type SkillInput,
  type SkillRow,
} from "../../admin/admin-api.service";
import type { DraftMarks } from "../../admin/change-trace";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { LivePreviewService } from "../../admin/preview/live-preview.service";
import { AdminPulseService } from "../../admin/pulse.service";
import type { AppContent } from "../../content/schema";
import AdminSkillsPage from "./skills.page";

function skillRow(id: string, titleEn: string, updatedAt = "2026-01-01T00:00:00Z"): SkillRow {
  return {
    id,
    icon: "cpu",
    span: "sm",
    items: ["TypeScript"],
    position: 0,
    isVisible: true,
    updatedAt,
    translations: {
      en: { title: titleEn, caption: "// caption", narrative: `${titleEn} summary` },
      de: { title: `${titleEn} DE`, caption: "// caption", narrative: `${titleEn} DE summary` },
    },
  };
}

class StubApi {
  readonly writes = signal(0);
  rows: SkillRow[] = [];
  updates: { id: string; input: SkillInput }[] = [];
  updateResponses = new Map<string, ApiResult<{ ok: true }>>();

  listSkills(): Promise<ApiResult<{ skills: SkillRow[] }>> {
    return Promise.resolve({ ok: true, data: { skills: structuredClone(this.rows) } });
  }

  updateSkill(id: string, input: SkillInput): Promise<ApiResult<{ ok: true }>> {
    this.updates.push({ id, input });
    return Promise.resolve(this.updateResponses.get(id) ?? { ok: true, data: { ok: true } });
  }
}

class StubConfirm {
  answer = true;
  calls = 0;

  ask(): Promise<boolean> {
    this.calls += 1;
    return Promise.resolve(this.answer);
  }
}

async function setup(rows: SkillRow[]) {
  TestBed.resetTestingModule();
  const api = new StubApi();
  api.rows = rows;
  const confirm = new StubConfirm();
  const marks = signal<DraftMarks | null>(null);

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: AdminApiService, useValue: api },
      { provide: ConfirmService, useValue: confirm },
      { provide: AdminPulseService, useValue: { marks } },
      LivePreviewService,
    ],
  });

  const fixture = TestBed.createComponent(AdminSkillsPage);
  fixture.detectChanges();
  await fixture.componentInstance["load"]();
  fixture.detectChanges();
  return { fixture, page: fixture.componentInstance, api, confirm, marks };
}

function editText(
  page: AdminSkillsPage,
  id: string,
  key: "title" | "narrative",
  locale: "en" | "de",
  value: string,
): void {
  const control = page["control"](id, key, locale);
  control.setValue(value);
  control.markAsDirty();
}

describe("AdminSkillsPage.save", () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView",
  );

  beforeEach(() => {
    vi.restoreAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
    } else {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });

  it("saves changed groups, marks their controls pristine, and records draft timestamps", async () => {
    const { page, api } = await setup([skillRow("backend", "Backend"), skillRow("ops", "Ops")]);

    editText(page, "backend", "title", "en", "Backend APIs");
    expect(page["control"]("backend", "title", "en").dirty).toBe(true);
    expect(page["changedIds"]()).toEqual(["backend"]);

    await page["save"]();

    expect(api.updates.map((u) => u.id)).toEqual(["backend"]);
    expect(page["changedIds"]()).toEqual([]);
    expect(page["control"]("backend", "title", "en").dirty).toBe(false);
    expect(page["state"]("backend", "title")).toBe("draft");
    expect(page["state"]("backend", "narrative")).toBe("live");
    expect(page["savedAt"]()).not.toBeNull();
  });

  it("keeps edits and sets field errors on a failed group while still saving valid groups", async () => {
    const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { fixture, page, api } = await setup([
      skillRow("backend", "Backend"),
      skillRow("ops", "Ops"),
    ]);

    editText(page, "backend", "title", "en", "Backend APIs");
    editText(page, "ops", "title", "de", "");
    api.updateResponses.set("ops", {
      ok: false,
      error: "invalid_input",
      status: 400,
      issues: [{ path: ["translations", "de", "title"], message: "Required" }],
    });

    await page["save"]();
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(page["changedIds"]()).toEqual(["ops"]);
    expect(page["control"]("backend", "title", "en").dirty).toBe(false);
    expect(page["control"]("ops", "title", "de").dirty).toBe(true);
    expect(page["control"]("ops", "title", "de").errors).toEqual({ server: "Required" });
    expect(page["issues"].get("ops.translations.de.title")).toBe("Required");
    expect(toastSpy).toHaveBeenCalled();
  });

  it("shows an error toast and keeps edits when an update fails without field issues", async () => {
    const toastSpy = vi.spyOn(toast, "error").mockImplementation(() => "");
    const { page, api } = await setup([skillRow("backend", "Backend")]);

    editText(page, "backend", "title", "en", "Backend APIs");
    api.updateResponses.set("backend", { ok: false, error: "server_down", status: 500 });

    await page["save"]();

    expect(page["changedIds"]()).toEqual(["backend"]);
    expect(page["saving"]()).toBe(false);
    // A code the admin has no words for reads as a plain sentence, never the code (plan 5, U19).
    expect(toastSpy).toHaveBeenCalledWith("Not saved", {
      description: "The server refused this. Try again; if it happens again, its log says why.",
    });
  });

  it("aborts without updating when the overwrite confirmation is declined", async () => {
    const { page, api, confirm } = await setup([skillRow("backend", "Backend")]);

    editText(page, "backend", "title", "en", "Backend APIs");
    api.rows = [skillRow("backend", "Backend", "2026-01-02T00:00:00Z")];
    confirm.answer = false;

    await page["save"]();

    expect(confirm.calls).toBe(1);
    expect(api.updates).toEqual([]);
    expect(page["saving"]()).toBe(false);
    expect(page["changedIds"]()).toEqual(["backend"]);
  });

  it("is a no-op when already saving or when nothing changed", async () => {
    const { page, api } = await setup([skillRow("backend", "Backend")]);

    await page["save"]();
    expect(api.updates).toEqual([]);

    editText(page, "backend", "title", "en", "Backend APIs");
    page["saving"].set(true);
    await page["save"]();
    expect(api.updates).toEqual([]);
  });

  it("traces visibility against live skills before and after the first publish", async () => {
    const { page, marks } = await setup([skillRow("backend", "Backend")]);

    expect(page["state"]("backend", "isVisible")).toBe("live");

    marks.set({
      paths: { en: [], de: [] },
      live: { en: null, de: null },
      asked: 1,
    });
    expect(page["state"]("backend", "isVisible")).toBe("draft");

    marks.set({
      paths: { en: [], de: [] },
      live: {
        en: { skills: [{ id: "backend" }] } as unknown as AppContent,
        de: null,
      },
      asked: 1,
    });
    expect(page["state"]("backend", "isVisible")).toBe("live");

    marks.set({
      paths: { en: [], de: [] },
      live: {
        en: {} as unknown as AppContent,
        de: null,
      },
      asked: 1,
    });
    expect(page["state"]("backend", "isVisible")).toBe("live");
  });
});
