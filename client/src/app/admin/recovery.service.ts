import { DestroyRef, effect, inject, Injectable, signal, untracked } from "@angular/core";

import { changedFields, isRecord, sameValue, type ChangedField } from "./changed-fields";

const DATABASE = "admin-recovery";
const STORE = "copies";
/** A second after the last keystroke. */
const WAIT_MS = 1_000;
/** How every admin tab's title ends; the dashboard's list shows what comes before it. */
export const TITLE_END = " · Admin";

const TIME = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const DAY_AND_TIME = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** When a copy was typed, in the browser's own format: "22:14" today, "8 Nov, 22:14" before. */
export function typedAt(at: number): string {
  const date = new Date(at);
  const today = date.toDateString() === new Date().toDateString();
  return (today ? TIME : DAY_AND_TIME).format(date);
}

/** One changed field, kept in the browser until it is saved or thrown away. */
export interface RecoveryCopy {
  editor: string;
  /** The row or document; "" on a page of one. */
  item: string;
  /** Its path in the editor's value (`translations.en.hook`); a row's path starts after its id. */
  field: string;
  value: unknown;
  /** The saved value it was typed over: a different one later means it changed since. */
  base: unknown;
  at: number;
  /** The page's title when it was typed, and its address. */
  page: string;
  href: string;
}

/** What an editor gives the service: all it needs to mirror and to bring back. */
export interface RecoverySource<T> {
  editor: string | (() => string);
  /** The row or document open now, null while none is. Left out on a page of one. */
  item?: () => string | null;
  /** A list saved row by row: the value is keyed by row id, and so is the copy. */
  rows?: boolean;
  saved: () => T | null;
  current: () => T | null;
  restore: (value: T) => void;
}

/** One editor's edits that came back and wait for Keep or Discard. */
export interface RecoveryBack {
  at: number;
  changedSince: boolean;
  /** Back to what is saved; returns the way back to these edits. */
  discard: () => () => void;
}

/** An editor's hold on its copy: dropped when its edits are thrown away or saved and closed. */
export interface RecoveryHandle {
  drop(item?: string): void;
}

interface Live {
  flush(): void;
  drop(item?: string): void;
}

/**
 * Unsaved edits kept in the browser, for what `beforeunload` cannot cover: a
 * crash, a killed tab, a lost session. IndexedDB rather than `localStorage`:
 * a legal page in two languages would strain its 5 MB, and it never makes
 * typing wait. Only the fields that differ from what is saved are kept.
 */
@Injectable({ providedIn: "root" })
export class RecoveryService {
  private database: Promise<IDBDatabase> | undefined;
  /** Open once any editor has looked: a write can then start in the task that asks for it. */
  private db: IDBDatabase | undefined;
  private readonly live = new Set<Live>();
  private listening = false;

  readonly back = signal<readonly RecoveryBack[]>([]);
  /** The last write failed: the page header says so. */
  readonly full = signal(false);

  /** Called from an editor's constructor: mirrors its changed fields until it goes. */
  track<T extends object>(source: RecoverySource<T>): RecoveryHandle {
    const rows = source.rows ?? false;
    const editor = (): string =>
      typeof source.editor === "string" ? source.editor : source.editor();

    let looked: string | null = null;
    let looking: string | null = null;
    let ready = false;
    /** What the store holds of the item looked at: a write needs no read first. */
    let written = new Map<string, RecoveryCopy>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pending: (() => void) | null = null;
    let entry: RecoveryBack | null = null;
    /** The editor went: a look that answers after that brings nothing back. */
    let gone = false;

    const forget = (): void => {
      const shown = entry;
      if (shown) this.back.update((all) => all.filter((one) => one !== shown));
      entry = null;
    };
    const live: Live = {
      flush: () => {
        clearTimeout(timer);
        const write = pending;
        pending = null;
        write?.();
      },
      // One row's copy, or everything this editor has of what is open now.
      drop: (item) => {
        clearTimeout(timer);
        pending = null;
        forget();
        const target = item ?? (rows ? null : looked);
        if (target === null && !rows) return;
        written = new Map([...written].filter(([, c]) => target !== null && c.item !== target));
        void this.write((store) => store.delete(rangeOf(editor(), target)));
      },
    };
    this.live.add(live);
    this.listen();

    const schedule = (item: string, saved: T, current: T): void => {
      clearTimeout(timer);
      pending = () => {
        // Here, off the keystroke's path: the walk reads every field. A row gone from either
        // side was added or deleted on the server at once, so it is no edit.
        const changes = rows
          ? changedFields(onlyIn(saved, current), onlyIn(current, saved))
          : changedFields(saved, current);
        if (!changes.length) forget();
        if (!changes.length && !written.size) return;
        void this.replace(editor(), rows ? null : item, changes, written).then((kept) => {
          if (kept) written = kept;
        });
      };
      timer = setTimeout(() => live.flush(), WAIT_MS);
    };

    const look = (item: string): void => {
      void this.list(editor(), rows ? null : item).then((found) => {
        if (gone || looked !== item) return;
        ready = true;
        written = new Map(found.map((copy) => [keyOf(copy), copy]));
        const saved = untracked(source.saved);
        const current = untracked(source.current);
        if (saved === null || current === null) return;
        const back = overlay(saved, current, found, rows);
        if (back.restored.length) {
          source.restore(back.value);
          const shown: RecoveryBack = {
            at: Math.max(...back.restored.map((copy) => copy.at)),
            changedSince: back.changedSince,
            discard: () => {
              const edits = untracked(source.current);
              const now = untracked(source.saved);
              if (now) source.restore(structuredClone(now));
              return () => {
                if (edits) source.restore(edits);
              };
            },
          };
          entry = shown;
          this.back.update((all) => [...all, shown]);
        }
        // Copies of what was saved meanwhile go too, even if nothing is typed now.
        schedule(item, untracked(source.saved) ?? saved, untracked(source.current) ?? current);
      });
    };

    effect(() => {
      const item = rows || !source.item ? "" : source.item();
      const saved = source.saved();
      const current = source.current();
      untracked(() => {
        if (item !== looked) {
          // Another row, or none: what the last one had typed goes in now, and its copy stays.
          live.flush();
          forget();
          looked = item;
          looking = null;
          ready = false;
          written = new Map();
        }
        if (item === null || saved === null || current === null) return;
        if (ready) schedule(item, saved, current);
        else if (looking !== item) {
          looking = item;
          look(item);
        }
      });
    });

    inject(DestroyRef).onDestroy(() => {
      gone = true;
      live.flush();
      this.live.delete(live);
      forget();
      this.full.set(false);
    });
    return { drop: (item) => live.drop(item) };
  }

  /**
   * Every copy there is, or those of one editor or item; none when the store cannot be read.
   * shortcut: a copy of a row deleted elsewhere (another browser, the content agent) stays until
   * a sign-out clears the store; prune by age if one ever lingers on the dashboard.
   */
  async list(editor?: string, item?: string | null): Promise<RecoveryCopy[]> {
    try {
      const db = await this.open();
      return await new Promise((resolve, reject) => {
        const request = db
          .transaction(STORE)
          .objectStore(STORE)
          .getAll(editor === undefined ? undefined : rangeOf(editor, item ?? null));
        request.onsuccess = () => resolve(request.result as RecoveryCopy[]);
        request.onerror = () => reject(request.error);
      });
    } catch {
      this.reopenNextTime();
      return [];
    }
  }

  /** The rows of an editor that have a copy: a panel opens by itself on the way back. */
  async items(editor: string): Promise<string[]> {
    return [...new Set((await this.list(editor)).map((copy) => copy.item))];
  }

  /** The row was deleted: a copy of it could only mislead. */
  forget(editor: string, item: string): void {
    void this.write((store) => store.delete(rangeOf(editor, item)));
  }

  /** The edits on this page were thrown away on purpose: their copies go too. */
  dropLive(): void {
    for (const live of this.live) live.drop();
    this.back.set([]);
  }

  /** A deliberate sign-out: nothing typed stays on this device. */
  async clearAll(): Promise<void> {
    this.dropLive();
    await this.write((store) => store.clear());
  }

  /**
   * Puts the store in step with these changes, from what this editor knows it wrote: a field
   * typed the same keeps its time and base. What the store now holds, or null if it refused.
   */
  private async replace(
    editor: string,
    item: string | null,
    changes: ChangedField[],
    written: ReadonlyMap<string, RecoveryCopy>,
  ): Promise<Map<string, RecoveryCopy> | null> {
    const at = Date.now();
    const page = document.title.replace(TITLE_END, "");
    const href = location.pathname;
    const kept = new Map<string, RecoveryCopy>();
    const stored = await this.write((store) => {
      for (const { path, before, after } of changes) {
        const copy: RecoveryCopy = {
          editor,
          item: item ?? path[0]!,
          field: (item === null ? path.slice(1) : path).join("."),
          value: after,
          base: before,
          at,
          page,
          href,
        };
        const old = written.get(keyOf(copy));
        const same = old !== undefined && sameValue(old.value, copy.value);
        if (!same) store.put(copy);
        kept.set(keyOf(copy), same ? old : copy);
      }
      for (const [key, copy] of written) {
        if (!kept.has(key)) store.delete([copy.editor, copy.item, copy.field]);
      }
    });
    return stored ? kept : null;
  }

  /**
   * Starts in this very task once the store is open, with no read before its writes, and
   * commits at once: a page that is going away runs no more callbacks.
   */
  private async write(work: (store: IDBObjectStore) => void): Promise<boolean> {
    try {
      const db = this.db ?? (await this.open());
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
        work(transaction.objectStore(STORE));
        transaction.commit();
      });
      this.full.set(false);
      return true;
    } catch {
      this.reopenNextTime();
      this.full.set(true);
      return false;
    }
  }

  /** The connection may be gone (site data cleared): the next call opens a new one. */
  private reopenNextTime(): void {
    this.db = undefined;
    this.database = undefined;
  }

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore(STORE, { keyPath: ["editor", "item", "field"] });
      request.onsuccess = () => {
        this.db = request.result;
        resolve(request.result);
      };
      request.onerror = () => reject(request.error);
    }).catch((error: unknown) => {
      this.database = undefined;
      throw error;
    });
    return this.database;
  }

  /**
   * A tab hidden or closed: what was typed goes in now, not a second later. Best effort: a page
   * being torn down can lose its last transaction (4 of 5 reloads kept it, 2026-11-09).
   */
  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    const flush = (): void => {
      for (const live of this.live) live.flush();
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    addEventListener("pagehide", flush);
  }
}

function keyOf(copy: RecoveryCopy): string {
  return `${copy.item}\n${copy.field}`;
}

/** All of an editor's copies, or one item's. */
function rangeOf(editor: string, item: string | null): IDBKeyRange {
  return item === null
    ? IDBKeyRange.bound([editor], [editor, "￿"])
    : IDBKeyRange.bound([editor, item], [editor, item, "￿"]);
}

/** The rows of `a` that `b` has too. */
function onlyIn<T extends object>(a: T, b: T): T {
  return Object.fromEntries(Object.entries(a).filter(([id]) => id in b)) as T;
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((at, key) => (isRecord(at) ? at[key] : undefined), value);
}

/**
 * The copies laid over what is on screen, field by field. A field saved as typed, or on
 * screen as typed already, is left as it is.
 */
export function overlay<T extends object>(
  saved: T,
  current: T,
  copies: readonly RecoveryCopy[],
  rows: boolean,
): { value: T; restored: RecoveryCopy[]; changedSince: boolean } {
  const value = structuredClone(current);
  const restored: RecoveryCopy[] = [];
  let changedSince = false;
  for (const copy of copies) {
    const path = [...(rows ? [copy.item] : []), ...(copy.field ? copy.field.split(".") : [])];
    const key = path.at(-1);
    const parent = valueAt(value, path.slice(0, -1));
    const savedNow = valueAt(saved, path);
    if (key === undefined || !isRecord(parent)) continue;
    if (sameValue(savedNow, copy.value) || sameValue(parent[key], copy.value)) continue;
    parent[key] = structuredClone(copy.value);
    restored.push(copy);
    changedSince ||= !sameValue(savedNow, copy.base);
  }
  return { value, restored, changedSince };
}
