import { afterEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));
vi.mock("@sentry/node", () => sdk);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.resetModules();
});

async function load() {
  return import("./sentry.js");
}

describe("sentry", () => {
  it("does nothing at all without a DSN", async () => {
    vi.stubEnv("SENTRY_DSN", "");
    const { initSentry, captureError } = await load();
    await initSentry();
    captureError(new Error("x"));
    expect(sdk.init).not.toHaveBeenCalled();
    expect(sdk.captureException).not.toHaveBeenCalled();
  });

  it("initializes errors-only, without PII or OpenTelemetry", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    const { initSentry } = await load();
    await initSentry();
    expect(sdk.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@o1.ingest.sentry.io/1",
        enableOpenTelemetrySetup: false,
      }),
    );
    // SDK 11 collects everything unless told not to (it replaced `sendDefaultPii`).
    expect(sdk.init.mock.calls[0]![0]).toMatchObject({
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        urlQueryParams: false,
        genAI: { inputs: false, outputs: false },
        stackFrameVariables: false,
      },
    });
    expect(sdk.init.mock.calls[0]![0]).not.toHaveProperty("tracesSampleRate");
  });

  it("reports captured errors with their tags once configured", async () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    const { initSentry, captureError } = await load();
    await initSentry();
    const error = new Error("boom");
    captureError(error, { path: "/x" });
    expect(sdk.captureException).toHaveBeenCalledWith(error, { tags: { path: "/x" } });
  });
});
