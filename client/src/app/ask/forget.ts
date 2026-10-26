import { LEVEL_STORAGE_KEY } from "./ask-level";
import { NEWS_STORAGE_KEY } from "./news";

/**
 * `forget` (visitor plan V14): after the visitor's yes, the server deletes
 * what its log keeps of this tab's conversation (`POST /v1/ask/forget`), and
 * the browser clears what it kept for the assistant on this device. The tab
 * then starts a new session.
 */

/**
 * What the terminal keeps in this browser beyond the tab, all of it cleared
 * by `forget`: the reading level (V10) and what's new's day (V15). A key
 * added later joins this list.
 */
export const DEVICE_KEYS: readonly string[] = [LEVEL_STORAGE_KEY, NEWS_STORAGE_KEY];

/** The tab's sessions before its resets that `forget` also takes; the server takes ten. */
export const MAX_EARLIER = 10;

export function clearDeviceKeys(
  storage: Pick<Storage, "removeItem"> | null = localStorageOrNull(),
): void {
  for (const key of DEVICE_KEYS) {
    try {
      storage?.removeItem(key);
    } catch {
      // Storage may be blocked: then nothing was kept there either.
    }
  }
}

/** The request: this session, and the tab's earlier ones, the newest ten. */
export function forgetBody(
  sessionId: string,
  earlier: readonly string[],
): { sessionId: string; earlier?: string[] } {
  const kept = earlier.filter((id) => id !== sessionId).slice(-MAX_EARLIER);
  return kept.length ? { sessionId, earlier: kept } : { sessionId };
}

/** How many answers the log deleted, or why it could not: a limit's wait, or a failure. */
export async function forgetConversation(
  post: () => Promise<Response>,
): Promise<{ ok: true; deleted: number } | { ok: false; retryAfter: number | null }> {
  let res: Response;
  try {
    res = await post();
  } catch {
    return { ok: false, retryAfter: null };
  }
  const body = (await res.json().catch(() => ({}))) as { deleted?: unknown; retryAfter?: unknown };
  if (res.status === 429) {
    return { ok: false, retryAfter: typeof body.retryAfter === "number" ? body.retryAfter : 60 };
  }
  if (!res.ok || typeof body.deleted !== "number") return { ok: false, retryAfter: null };
  return { ok: true, deleted: body.deleted };
}

function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
