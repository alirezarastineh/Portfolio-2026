import type { MessageStatus } from "./admin-api.service";

/** The inbox's filters: the inbox itself (new and read), or one status. */
export type InboxFilter = "inbox" | MessageStatus;

/** Whether a message with this status belongs in the list the filter shows. */
export function inFilter(filter: InboxFilter, status: MessageStatus): boolean {
  if (filter === "inbox") return status === "new" || status === "read";
  return filter === status;
}

/** What can be done with a message, by its status. */
export function actionsFor(status: MessageStatus): { status: MessageStatus; label: string }[] {
  switch (status) {
    case "new":
      return [
        { status: "read", label: "Mark read" },
        { status: "archived", label: "Archive" },
        { status: "spam", label: "Spam" },
      ];
    case "read":
      return [
        { status: "new", label: "Mark unread" },
        { status: "archived", label: "Archive" },
        { status: "spam", label: "Spam" },
      ];
    case "archived":
      return [
        { status: "read", label: "Move to inbox" },
        { status: "spam", label: "Spam" },
      ];
    case "spam":
      return [
        { status: "read", label: "Not spam" },
        { status: "archived", label: "Archive" },
      ];
  }
}

/** The list after a message left it, and the one to open in its place (the next, else the last). */
export function afterLeaving<T extends { id: string }>(
  list: readonly T[],
  id: string,
): { rest: T[]; next: T | null } {
  const at = list.findIndex((m) => m.id === id);
  const rest = list.filter((m) => m.id !== id);
  if (at < 0) return { rest, next: null };
  return { rest, next: rest[Math.min(at, rest.length - 1)] ?? null };
}

/** The message J (1) or K (-1) moves to from `current`; the first when none is open. */
export function stepFrom<T extends { id: string }>(
  list: readonly T[],
  current: string | null,
  by: 1 | -1,
): T | null {
  if (!list.length) return null;
  const at = list.findIndex((m) => m.id === current);
  if (at < 0) return list[0] ?? null;
  return list[Math.min(list.length - 1, Math.max(0, at + by))] ?? null;
}
