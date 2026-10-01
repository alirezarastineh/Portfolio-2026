/**
 * Posts the visitor's yes to a hand-off offer. The offer (and its yes button)
 * can arrive before the answer is logged, which happens once the stream has
 * ended, so a 404 is tried again a few times. Anything else ends it: this is
 * best effort, counting the hand-off funnel, and never blocks the visitor.
 */
export async function confirmHandoff(
  post: () => Promise<{ status: number }>,
  options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const maxAttempts = options.attempts ?? 4;
  const delayMs = options.delayMs ?? 2000;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));

  async function step(attempt: number): Promise<boolean> {
    if (attempt > maxAttempts) return false;
    let status: number;
    try {
      status = (await post()).status;
    } catch {
      return false;
    }
    if (status !== 404) return status >= 200 && status < 300;
    if (attempt === maxAttempts) return false;
    await sleep(delayMs);
    return step(attempt + 1);
  }

  return step(1);
}
