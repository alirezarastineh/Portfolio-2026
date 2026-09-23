import { describe, expect, it } from "vitest";

import { typingAt, type TerminalLine } from "./about-typing";

const LINES: TerminalLine[] = [
  { prompt: "$", command: "ab", output: "xyz" },
  { prompt: "$", command: "c", output: "" },
];
const T = { cmdCharMs: 10, outCharMs: 1, afterCmdMs: 5, afterOutMs: 5 };

describe("typingAt", () => {
  it("starts with nothing typed on the first line", () => {
    expect(typingAt(LINES, 0, T)).toEqual({ cmd: [0, 0], out: [0, 0], line: 0, part: "cmd" });
  });

  it("types the command, pauses, then prints the output", () => {
    expect(typingAt(LINES, 15, T)).toMatchObject({ cmd: [1, 0], part: "cmd" });
    // 20 ms typed "ab"; the pause after it still counts as the command.
    expect(typingAt(LINES, 22, T)).toMatchObject({ cmd: [2, 0], out: [0, 0], part: "cmd" });
    expect(typingAt(LINES, 27, T)).toMatchObject({ cmd: [2, 0], out: [2, 0], part: "out" });
  });

  it("moves on to the next line, and handles an empty output", () => {
    expect(typingAt(LINES, 34, T)).toMatchObject({ cmd: [2, 0], out: [3, 0], line: 1 });
    expect(typingAt(LINES, 60, T)).toEqual({
      cmd: [2, 1],
      out: [3, 0],
      line: 2,
      part: "done",
    });
  });

  it("is done at once with no lines", () => {
    expect(typingAt([], 0, T)).toEqual({ cmd: [], out: [], line: 0, part: "done" });
  });
});
