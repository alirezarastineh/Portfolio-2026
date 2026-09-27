/**
 * Where a mouse is over `el`, as `--mx` / `--my` percentages, for a spotlight
 * that follows it (`radial-gradient(… at var(--mx) var(--my), …)`). Touch and
 * pen have no hover to follow, so they leave it where it is.
 */
export function trackPointer(el: HTMLElement, event: PointerEvent): void {
  if (event.pointerType !== "mouse") return;
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${((event.clientX - rect.left) / rect.width) * 100}%`);
  el.style.setProperty("--my", `${((event.clientY - rect.top) / rect.height) * 100}%`);
}
