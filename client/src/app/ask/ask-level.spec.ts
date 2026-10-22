import { describe, expect, it } from "vitest";

import { isLevel, LEVEL_STORAGE_KEY, readLevel, storeLevel } from "./ask-level";

/** Visitor plan V10: the level is the visitor's own choice, kept in this browser only. */

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("the reader's level", () => {
  it("is plain, standard or expert, and nothing else", () => {
    expect(["plain", "standard", "expert"].every(isLevel)).toBe(true);
    expect(isLevel("simple")).toBe(false);
    expect(isLevel(undefined)).toBe(false);
  });

  it("is kept in the browser once set, and standard keeps nothing", () => {
    const storage = memoryStorage();
    expect(readLevel(storage)).toBe("standard");
    storeLevel("expert", storage);
    expect(storage.getItem(LEVEL_STORAGE_KEY)).toBe("expert");
    expect(readLevel(storage)).toBe("expert");
    storeLevel("standard", storage);
    expect(storage.getItem(LEVEL_STORAGE_KEY)).toBeNull();
    expect(readLevel(storage)).toBe("standard");
  });

  it("reads standard from a value it does not know, or a storage that refuses", () => {
    const storage = memoryStorage();
    storage.setItem(LEVEL_STORAGE_KEY, "genius");
    expect(readLevel(storage)).toBe("standard");
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLevel(blocked)).toBe("standard");
    expect(() => storeLevel("plain", blocked)).not.toThrow();
    expect(readLevel(null)).toBe("standard");
  });
});
