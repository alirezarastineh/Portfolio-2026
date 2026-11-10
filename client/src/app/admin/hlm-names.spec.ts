import { hlm } from "@spartan-ng/helm/utils";
import { describe, expect, it } from "vitest";

describe("helm's class merge knows the admin's own names", () => {
  it("keeps a colour beside a type size", () => {
    expect(hlm("text-muted-foreground text-hint")).toBe("text-muted-foreground text-hint");
    expect(hlm("text-section-title text-foreground")).toBe("text-section-title text-foreground");
  });

  it("lets a later size replace an earlier one", () => {
    expect(hlm("text-section-title text-sm")).toBe("text-sm");
    expect(hlm("text-xs text-data")).toBe("text-data");
  });

  it("reads the overlay radius as a radius", () => {
    expect(hlm("rounded-lg rounded-overlay")).toBe("rounded-overlay");
  });
});
