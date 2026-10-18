// A deliberate import cycle for a scratch red (the GitHub Actions plan, Phase 3):
// cycle-b.ts imports this module back, at run time. Never merge.
import { ciRedB } from "./cycle-b.js";

export const ciRedA = (): unknown => ciRedB;
