import { describe, expect, it } from "vitest";

import { overlay, type RecoveryCopy } from "./recovery.service";

const copy = (field: string, value: unknown, base: unknown, item = ""): RecoveryCopy => ({
  editor: "e",
  item,
  field,
  value,
  base,
  at: 1,
  page: "Legal pages",
  href: "/admin/legal",
});

describe("overlay", () => {
  const saved = { title: "Imprint", body: { en: "Who runs it.", de: "Wer sie betreibt." } };

  it("puts each copy back on its own field", () => {
    const back = overlay(
      saved,
      structuredClone(saved),
      [copy("body.de", "Neu.", "Wer sie betreibt.")],
      false,
    );
    expect(back.value).toEqual({ ...saved, body: { ...saved.body, de: "Neu." } });
    expect(back.restored).toHaveLength(1);
    expect(back.changedSince).toBe(false);
  });

  it("tells when the saved field changed since it was typed over", () => {
    const now = { ...saved, title: "Impressum, neu" };
    const back = overlay(now, structuredClone(now), [copy("title", "Mine", "Imprint")], false);
    expect(back.value.title).toBe("Mine");
    expect(back.changedSince).toBe(true);
  });

  it("leaves out a copy saved as typed, or already on screen", () => {
    const typed = { ...saved, title: "Typed" };
    expect(
      overlay(typed, structuredClone(typed), [copy("title", "Typed", "Imprint")], false).restored,
    ).toEqual([]);
    expect(overlay(saved, typed, [copy("title", "Typed", "Imprint")], false).restored).toEqual([]);
  });

  it("lays a row's copy on that row wherever it stands, and skips a row that is gone", () => {
    const rows = { gamma: { title: "Gamma" }, alpha: { title: "Alpha" } };
    const back = overlay(
      rows,
      structuredClone(rows),
      [
        copy("title", "Alpha, edited", "Alpha", "alpha"),
        copy("title", "Beta, edited", "Beta", "beta"),
      ],
      true,
    );
    expect(back.value).toEqual({ gamma: { title: "Gamma" }, alpha: { title: "Alpha, edited" } });
    expect(back.restored.map((c) => c.item)).toEqual(["alpha"]);
  });
});
