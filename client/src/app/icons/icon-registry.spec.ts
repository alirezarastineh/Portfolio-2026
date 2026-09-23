import { describe, expect, it } from "vitest";

import { iconKeySchema } from "../content/schema";
import { ICON_KEYS, iconFor } from "./icon-registry";

describe("icon registry", () => {
  it("maps every key the CMS may store to an icon", () => {
    expect(iconFor("github")).toBe("brandGithub");
    expect(iconFor("brain-circuit")).toBe("lucideBrainCircuit");
  });

  it("offers only keys the content schema accepts", () => {
    for (const key of ICON_KEYS) expect(iconKeySchema.safeParse(key).success, key).toBe(true);
  });

  it("still draws an icon for a key this build does not know", () => {
    expect(iconFor("added-later")).toBe("lucideLink");
    expect(iconFor("added-later", "lucideSparkles")).toBe("lucideSparkles");
  });

  it("covers every icon the v1 content used", () => {
    for (const key of [
      "github",
      "linkedin",
      "mail",
      "twitter",
      "cpu",
      "brain-circuit",
      "container",
      "database",
    ]) {
      expect(iconFor(key, "lucideLink"), key).not.toBe("lucideLink");
    }
  });
});
