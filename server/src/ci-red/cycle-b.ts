// A deliberate import cycle for a scratch red (the GitHub Actions plan, Phase 3):
// cycle-a.ts imports this module back, at run time. Never merge.
import { ciRedA } from "./cycle-a.js";

export const ciRedB = (): unknown => ciRedA;
