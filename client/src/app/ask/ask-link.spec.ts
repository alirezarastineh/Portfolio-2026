import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ASK_LINK_CHARS, cleanLinkQuestion, shareLink, takeLinkQuestion } from "./ask-link";

/** A shared question (visitor plan V17): read once, cleaned and capped; never sent by itself. */

describe("a link's question", () => {
  it("is cleaned: control characters and bidi overrides out, trimmed, at most 600 characters", () => {
    expect(cleanLinkQuestion("  What did he build?\u0007 ")).toBe("What did he build?");
    expect(cleanLinkQuestion("Line one\r\nline two")).toBe("Line one\nline two");
    expect(cleanLinkQuestion("abc\u202Edef")).toBe("abcdef");
    expect(cleanLinkQuestion("x".repeat(700))).toHaveLength(ASK_LINK_CHARS);
    expect(cleanLinkQuestion("   ")).toBeNull();
    expect(cleanLinkQuestion("\u0000\u0001")).toBeNull();
    expect(cleanLinkQuestion(42)).toBeNull();
    expect(cleanLinkQuestion(undefined)).toBeNull();
  });

  it("is taken once", () => {
    const holder: { __askFromLink?: unknown } = { __askFromLink: "Is he available?" };
    expect(takeLinkQuestion(holder)).toBe("Is he available?");
    expect(holder).not.toHaveProperty("__askFromLink");
    expect(takeLinkQuestion(holder)).toBeNull();
  });

  it("is shared as this page's address, without its own query or hash", () => {
    expect(shareLink("https://site.test", "/en/work/atlas?x=1#problem", "What is Atlas?")).toBe(
      "https://site.test/en/work/atlas?ask=What%20is%20Atlas%3F",
    );
    expect(shareLink("https://site.test", "", "Hi & bye")).toBe(
      "https://site.test/?ask=Hi%20%26%20bye",
    );
  });
});

describe("index.html's ask-link script", () => {
  const html = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../index.html"),
    "utf8",
  );
  const source = /<script id="ask-link">([\s\S]*?)<\/script>/.exec(html)![1]!;

  /** Runs the script at parse time, as the browser would, against stand-ins. */
  function run(href: string) {
    const replaced: string[] = [];
    const win: Record<string, unknown> = {};
    const location = new URL(href);
    new Function("window", "location", "history", source)(win, location, {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url),
    });
    return { replaced, win };
  }

  it("lifts the question out of the address, keeping the rest, before anything reads it", () => {
    const { replaced, win } = run(
      "https://site.test/en/work/atlas?utm_source=news&ask=What%20is%20Atlas%3F#problem",
    );
    expect(win["__askFromLink"]).toBe("What is Atlas?");
    expect(replaced).toEqual(["/en/work/atlas?utm_source=news#problem"]);
  });

  it("leaves an address without one as it is", () => {
    const { replaced, win } = run("https://site.test/en?utm_source=news");
    expect(replaced).toEqual([]);
    expect(win).not.toHaveProperty("__askFromLink");
  });

  it("gives Umami a hook that strips the question from every address it sends, the referrer too", () => {
    const { win } = run("https://site.test/en");
    const hook = win["umamiBeforeSend"] as (type: string, payload: unknown) => unknown;
    expect(
      hook("event", {
        url: "/en?ask=secret%20question&utm_campaign=x",
        referrer: "https://site.test/de?ask=frage",
        title: "t",
      }),
    ).toEqual({ url: "/en?utm_campaign=x", referrer: "https://site.test/de", title: "t" });
    expect(hook("event", { url: "/en/writing" })).toEqual({ url: "/en/writing" });
    expect(hook("event", { url: "/en", referrer: "https://elsewhere.test/?ask=x" })).toEqual({
      url: "/en",
      referrer: "https://elsewhere.test/",
    });
  });
});
