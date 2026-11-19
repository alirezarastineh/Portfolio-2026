import type { MessageRow, MessageStatus } from "./admin-api.service";

/** The inbox's filters: the inbox itself (new and read), or one status. */
export type InboxFilter = "inbox" | MessageStatus;

const FILTERS: ReadonlySet<string> = new Set(["inbox", "new", "read", "archived", "spam"]);

/** The filter an address names (`?filter=spam`); the inbox when it names none it knows. */
export const filterFrom = (value: string | null): InboxFilter =>
  FILTERS.has(value ?? "") ? (value as InboxFilter) : "inbox";

/** A reply in the message's own language: the subject is the first thing the sender reads. */
export function replyHref(message: Pick<MessageRow, "email" | "locale">): string {
  const subject = message.locale === "de" ? "Re: Ihre Nachricht" : "Re: your message";
  return `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(subject)}`;
}

/** An answer as a person reads it: its citation marks (`[^project:atlas@en]`) left out. */
export function withoutMarks(answer: string): string {
  let out = "";
  let pos = 0;
  while (pos < answer.length) {
    const start = answer.indexOf("[^", pos);
    if (start < 0) {
      out += answer.slice(pos);
      break;
    }
    const end = answer.indexOf("]", start + 2);
    if (end < 0) {
      out += answer.slice(pos);
      break;
    }
    // Trim whitespace immediately before this citation mark, in linear time.
    let keepEnd = start;
    while (keepEnd > pos && /\s/.test(answer[keepEnd - 1])) {
      keepEnd--;
    }
    out += answer.slice(pos, keepEnd);
    pos = end + 1;
  }
  return out;
}

const KEY_STATUS = new Map<string, MessageStatus>([
  ["e", "archived"],
  ["u", "new"],
  ["#", "spam"],
]);

/** The status E (archive), U (unread) or # (spam) gives a message, or null where it does nothing. */
export function statusForKey(key: string, status: MessageStatus): MessageStatus | null {
  const next = KEY_STATUS.get(key) ?? null;
  return next && actionsFor(status).some((action) => action.status === next) ? next : null;
}

/** Whether a message with this status belongs in the list the filter shows. */
export function inFilter(filter: InboxFilter, status: MessageStatus): boolean {
  if (filter === "inbox") {
    return status === "new" || status === "read";
  }
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
  if (at < 0) {
    return { rest, next: null };
  }
  return { rest, next: rest[Math.min(at, rest.length - 1)] ?? null };
}

/** The message J (1) or K (-1) moves to from `current`; the first when none is open. */
export function stepFrom<T extends { id: string }>(
  list: readonly T[],
  current: string | null,
  by: 1 | -1,
): T | null {
  if (!list.length) {
    return null;
  }
  const at = list.findIndex((m) => m.id === current);
  if (at < 0) {
    return list[0] ?? null;
  }
  return list[Math.min(list.length - 1, Math.max(0, at + by))] ?? null;
}
