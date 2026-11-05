/**
 * The little animation the site needs, on requestAnimationFrame: a frame loop
 * that stops itself and time-based easing. (GSAP did this before;
 * it was the largest part of the home page's script for four small effects.)
 * Browser-only: call these from `afterNextRender` or event handlers.
 */

/** True when the visitor asked for less motion. */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/**
 * Calls `step(dt)` once per frame, `dt` in seconds (capped, so a background
 * tab does not jump), until it returns false or the returned stop is called.
 */
export function runFrames(step: (dt: number) => boolean): () => void {
  let id = 0;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    id = step(dt) ? requestAnimationFrame(tick) : 0;
  };
  id = requestAnimationFrame(tick);
  return () => {
    if (id) cancelAnimationFrame(id);
    id = 0;
  };
}

/** Moves `current` toward `target`, covering ~63% of the gap every `tau` seconds. */
export function approach(current: number, target: number, dt: number, tau: number): number {
  return target + (current - target) * Math.exp(-dt / tau);
}
