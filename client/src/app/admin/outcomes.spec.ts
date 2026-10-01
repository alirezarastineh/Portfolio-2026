import { describe, expect, it } from "vitest";

import { funnelLine, share, usd } from "./outcomes";

describe("outcomes in the admin", () => {
  it("shows shares and costs, or a dash when there is nothing to divide", () => {
    expect(share(0.456)).toBe("46 %");
    expect(share(null)).toBe("–");
    expect(usd(0.00276)).toBe("$0.0028");
    expect(usd(null)).toBe("–");
  });

  it("reads the hand-off funnel with the share that made each step", () => {
    expect(funnelLine({ offered: 4, confirmed: 2, sent: 1 })).toBe(
      "4 offered → 2 confirmed (50 %) → 1 sent (50 %)",
    );
    expect(funnelLine({ offered: 0, confirmed: 0, sent: 0 })).toBe(
      "0 offered → 0 confirmed → 0 sent",
    );
  });
});
