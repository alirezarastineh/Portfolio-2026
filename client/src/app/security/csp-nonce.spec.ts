import { CSP_NONCE, DOCUMENT } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BEFORE_APP_SERIALIZED } from "@angular/platform-server";
import { REQUEST } from "@analogjs/router/tokens";
import { afterEach, describe, expect, it } from "vitest";

import {
  EVENT_DISPATCH_SCRIPT_ID,
  provideRequestCspNonce,
  stampKnownScripts,
  THEME_SCRIPT_ID,
} from "./csp-nonce";
import { readRequestNonce, writeRequestNonce } from "./request-nonce";

function addScript(doc: Document, attrs: Record<string, string>, text = ""): HTMLScriptElement {
  const script = doc.createElement("script");
  for (const [name, value] of Object.entries(attrs)) script.setAttribute(name, value);
  script.textContent = text;
  doc.body.appendChild(script);
  return script;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("request nonce", () => {
  it("round-trips through the request object", () => {
    const req = {};
    writeRequestNonce(req, "abc");
    expect(readRequestNonce(req)).toBe("abc");
  });

  it("is null without a request or a nonce", () => {
    expect(readRequestNonce(null)).toBeNull();
    expect(readRequestNonce(undefined)).toBeNull();
    expect(readRequestNonce({})).toBeNull();
    expect(readRequestNonce({ cspNonce: "" })).toBeNull();
    expect(readRequestNonce({ cspNonce: 42 })).toBeNull();
  });
});

describe("stampKnownScripts", () => {
  it("nonces the event-dispatch contract and the theme script, and nothing else", () => {
    const contract = addScript(document, { id: EVENT_DISPATCH_SCRIPT_ID }, "/* contract */");
    const theme = addScript(document, { id: THEME_SCRIPT_ID }, "/* theme */");
    const other = addScript(document, {}, "void 0");
    const data = addScript(document, { type: "application/ld+json" }, "{}");

    stampKnownScripts(document, "n0nce");

    expect(contract.getAttribute("nonce")).toBe("n0nce");
    expect(theme.getAttribute("nonce")).toBe("n0nce");
    expect(other.hasAttribute("nonce")).toBe(false);
    expect(data.hasAttribute("nonce")).toBe(false);
  });

  it("never nonces an element that is not a script, even with a known id", () => {
    const impostor = document.createElement("div");
    impostor.id = THEME_SCRIPT_ID;
    document.body.appendChild(impostor);
    stampKnownScripts(document, "n0nce");
    expect(impostor.hasAttribute("nonce")).toBe(false);
  });

  it("does nothing without a nonce or without the scripts", () => {
    const contract = addScript(document, { id: EVENT_DISPATCH_SCRIPT_ID });
    stampKnownScripts(document, null);
    expect(contract.hasAttribute("nonce")).toBe(false);

    contract.remove();
    expect(() => stampKnownScripts(document, "n")).not.toThrow();
  });
});

describe("provideRequestCspNonce", () => {
  function setUp(request: object | null) {
    TestBed.configureTestingModule({
      providers: [
        ...(request ? [{ provide: REQUEST, useValue: request }] : []),
        provideRequestCspNonce(),
      ],
    });
  }

  it("gives Angular the nonce Nitro stored on the request", () => {
    const req = {};
    writeRequestNonce(req, "from-nitro");
    setUp(req);
    expect(TestBed.inject(CSP_NONCE)).toBe("from-nitro");
  });

  it("stamps the contract script before the HTML is serialized", () => {
    const req = {};
    writeRequestNonce(req, "from-nitro");
    setUp(req);
    const contract = addScript(TestBed.inject(DOCUMENT), { id: EVENT_DISPATCH_SCRIPT_ID });

    for (const callback of TestBed.inject(BEFORE_APP_SERIALIZED)) callback();

    expect(contract.getAttribute("nonce")).toBe("from-nitro");
  });

  it("provides no nonce outside a Nitro request", () => {
    setUp(null);
    expect(TestBed.inject(CSP_NONCE)).toBeNull();
  });
});
