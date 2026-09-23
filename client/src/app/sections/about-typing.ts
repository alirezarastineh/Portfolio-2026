/** One prompt: a command, then what it printed. */
export interface TerminalLine {
  prompt: string;
  command: string;
  output: string;
}

/** How far the typewriter has got: characters shown per command and output. */
export interface TypingState {
  cmd: number[];
  out: number[];
  /** The line being typed; `lines.length` once everything is shown. */
  line: number;
  part: "cmd" | "out" | "done";
}

export const TYPING = {
  /** A person typing the command… */
  cmdCharMs: 45,
  /** …and the machine printing its output, much faster. */
  outCharMs: 6,
  afterCmdMs: 180,
  afterOutMs: 320,
};

/** Where the typewriter is `elapsedMs` after it started. Pure, for testing. */
export function typingAt(
  lines: readonly TerminalLine[],
  elapsedMs: number,
  timing = TYPING,
): TypingState {
  const cmd = lines.map(() => 0);
  const out = lines.map(() => 0);
  let clock = 0;

  for (let i = 0; i < lines.length; i++) {
    const { command, output } = lines[i]!;
    const typing = command.length * timing.cmdCharMs;
    if (elapsedMs < clock + typing) {
      cmd[i] = Math.floor((elapsedMs - clock) / timing.cmdCharMs);
      return { cmd, out, line: i, part: "cmd" };
    }
    cmd[i] = command.length;
    clock += typing + timing.afterCmdMs;
    if (elapsedMs < clock) return { cmd, out, line: i, part: "cmd" };

    const printing = output.length * timing.outCharMs;
    if (elapsedMs < clock + printing) {
      out[i] = Math.floor((elapsedMs - clock) / timing.outCharMs);
      return { cmd, out, line: i, part: "out" };
    }
    out[i] = output.length;
    clock += printing + timing.afterOutMs;
    if (elapsedMs < clock) return { cmd, out, line: i, part: "out" };
  }
  return { cmd, out, line: lines.length, part: "done" };
}
