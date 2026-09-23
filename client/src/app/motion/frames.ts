/**
 * The little animation the site needs, on requestAnimationFrame: a frame loop
 * that stops itself, time-based easing, and a spring. (GSAP did this before;
 * it was the largest part of the home page's script for four small effects.)
 * Browser-only: call these from `afterNextRender` or event handlers.
 */

/** True when the visitor asked for less motion. */
export function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

/** True on touch-first devices, where hover effects never end. */
export function coarsePointer(): boolean {
  return globalThis.matchMedia?.("(pointer: coarse)").matches ?? false;
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

export interface Spring {
  value: number;
  velocity: number;
}

/**
 * One step of a damped spring toward `target`. The defaults overshoot a
 * little on release, like a magnet letting go. Sub-stepped for stability.
 */
export function stepSpring(
  spring: Spring,
  target: number,
  dt: number,
  stiffness = 170,
  damping = 15,
): void {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const force = stiffness * (target - spring.value) - damping * spring.velocity;
    spring.velocity += force * h;
    spring.value += spring.velocity * h;
  }
}

/** True once a spring has settled on its target. */
export function atRest(spring: Spring, target: number): boolean {
  return Math.abs(spring.value - target) < 0.05 && Math.abs(spring.velocity) < 0.05;
}
