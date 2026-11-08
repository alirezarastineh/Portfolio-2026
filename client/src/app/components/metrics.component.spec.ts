import { TestBed } from "@angular/core/testing";
import { describe, expect, it } from "vitest";

import { MetricsComponent } from "./metrics.component";

describe("MetricsComponent", () => {
  it("sizes the row by its longest value, counting characters", () => {
    const fixture = TestBed.createComponent(MetricsComponent);
    fixture.componentRef.setInput("metrics", [
      { value: "−42%", label: "latency", context: "" },
      { value: "1,204,330", label: "documents", context: "indexed" },
    ]);
    fixture.detectChanges();

    const row = (fixture.nativeElement as HTMLElement).querySelector("dl")!;
    expect(row.style.getPropertyValue("--metric-chars")).toBe("9");
    expect(row.querySelectorAll(".metric-context")).toHaveLength(1);
  });
});
