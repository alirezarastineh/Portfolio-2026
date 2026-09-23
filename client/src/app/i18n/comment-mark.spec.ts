import { describe, expect, it } from "vitest";

import { splitCommentMark } from "./comment-mark";

describe("splitCommentMark", () => {
  it("splits the decorative slashes from the words", () => {
    expect(splitCommentMark("// skills")).toEqual({ marked: true, text: "skills" });
    expect(splitCommentMark("  //über mich")).toEqual({ marked: true, text: "über mich" });
  });

  it("leaves text without them alone, slashes elsewhere included", () => {
    expect(splitCommentMark("Experience")).toEqual({ marked: false, text: "Experience" });
    expect(splitCommentMark("frontend // backend")).toEqual({
      marked: false,
      text: "frontend // backend",
    });
  });
});
