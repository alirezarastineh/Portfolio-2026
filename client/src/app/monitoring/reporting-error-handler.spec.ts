import { PLATFORM_ID } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ init: vi.fn(), captureException: vi.fn() }));
vi.mock("@sentry/browser", () => sentry);

import { ReportingErrorHandler, SENTRY_DSN } from "./reporting-error-handler";

const DSN = "https://key@o1.ingest.sentry.io/1";

function handler(platform: "browser" | "server", dsn: string | undefined): ReportingErrorHandler {
  TestBed.configureTestingModule({
    providers: [
      ReportingErrorHandler,
      { provide: PLATFORM_ID, useValue: platform },
      { provide: SENTRY_DSN, useValue: dsn },
    ],
  });
  return TestBed.inject(ReportingErrorHandler);
}

/** Long enough for a dynamic import that is going to happen to have happened. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  TestBed.resetTestingModule();
});

describe("ReportingErrorHandler", () => {
  it("still logs errors to the console", () => {
    const error = new Error("boom");
    handler("browser", undefined).handleError(error);
    expect(console.error).toHaveBeenCalledWith(error);
  });

  it("reports to Sentry in the browser when a DSN is configured", async () => {
    const error = new Error("boom");
    handler("browser", DSN).handleError(error);
    await vi.waitFor(() => expect(sentry.captureException).toHaveBeenCalledWith(error));
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: DSN, sendDefaultPii: false }),
    );
  });

  it("never loads Sentry during server rendering", async () => {
    handler("server", DSN).handleError(new Error("boom"));
    await settle();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("does nothing beyond logging without a DSN", async () => {
    handler("browser", "").handleError(new Error("boom"));
    await settle();
    expect(sentry.captureException).not.toHaveBeenCalled();
  });
});
