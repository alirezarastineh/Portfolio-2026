import { provideZonelessChangeDetection, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminApiService, type MessageRow } from "./admin-api.service";
import type { AssistantHealth } from "./assistant-types";
import { AdminPulseService, assistantAlert } from "./pulse.service";

const ok = <T>(data: T) => ({ ok: true as const, data });

function message(id: string, status: MessageRow["status"]): MessageRow {
  return {
    id,
    createdAt: "2026-09-28T10:00:00.000Z",
    locale: "en",
    name: "Ada",
    email: "ada@example.com",
    message: "Hello",
    status,
    mailStatus: "sent",
    mailError: null,
  };
}

function health(overrides: Partial<AssistantHealth> = {}): AssistantHealth {
  return {
    state: { state: "ok", deepAllowed: true, spentUsd: 0.1, budgetUsd: 2 },
    inFlight: 0,
    breakers: [],
    last24h: { answers: 4, failures: 0, fallbackRate: 0, models: [] },
    corpus: null,
    ...overrides,
  };
}

class StubApi {
  readonly writes = signal(0);
  readonly calls: string[] = [];

  async status() {
    this.calls.push("status");
    return ok({
      user: { id: "u", email: "a@b.c", totpEnrolled: true },
      pointers: [],
      lastEdit: null,
      lastPublish: null,
      hasUnpublishedChanges: true,
    });
  }
  async publishReview() {
    this.calls.push("review");
    return ok({ canPublish: true, locales: [] });
  }
  async listMessages() {
    this.calls.push("messages");
    return ok({ messages: [message("1", "new"), message("2", "spam"), message("3", "read")] });
  }
  async i18nStatus() {
    this.calls.push("i18n");
    return ok({ items: [] });
  }
  async assistantHealth() {
    this.calls.push("assistant");
    return ok(health());
  }
}

function setup() {
  TestBed.resetTestingModule();
  const api = new StubApi();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      { provide: AdminApiService, useValue: api },
      AdminPulseService,
    ],
  });
  return { api, pulse: TestBed.inject(AdminPulseService) };
}

describe("assistantAlert", () => {
  it("is quiet while the assistant answers normally", () => {
    expect(assistantAlert(null)).toBeNull();
    expect(assistantAlert(health())).toBeNull();
  });

  it("names an open breaker first, then failed answers", () => {
    const breaker = {
      model: "m",
      state: "open" as const,
      openUntil: null,
      consecutiveFailures: 3,
      lastSuccessAt: null,
      lastFailureAt: null,
      lastError: "boom",
      p50TtftMs: null,
    };
    const failures = { answers: 4, failures: 2, fallbackRate: 0, models: [] };
    expect(assistantAlert(health({ breakers: [breaker], last24h: failures }))).toBe(
      "A model is failing: its breaker is open",
    );
    expect(assistantAlert(health({ last24h: failures }))).toBe(
      "2 answers failed in the last 24 hours",
    );
  });
});

describe("AdminPulseService", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads every part once started, and leaves spam out of the inbox", async () => {
    const { api, pulse } = setup();
    await pulse.refresh();

    expect(api.calls.sort()).toEqual(["assistant", "i18n", "messages", "review", "status"]);
    expect(pulse.unpublished()).toBe(true);
    expect(pulse.messages()?.map((m) => m.id)).toEqual(["1", "3"]);
    expect(pulse.newMessages()).toBe(1);
    expect(pulse.review()?.total).toBe(0);
  });

  it("looks again once a burst of writes settles, but not at the assistant", async () => {
    vi.useFakeTimers();
    const { api, pulse } = setup();
    pulse.start();
    await vi.advanceTimersByTimeAsync(0);
    api.calls.length = 0;

    api.writes.update((n) => n + 1);
    TestBed.tick();
    api.writes.update((n) => n + 1);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(300);
    expect(api.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(600);
    expect(api.calls.sort()).toEqual(["i18n", "messages", "review", "status"]);
  });

  it("ignores writes before anyone is signed in", async () => {
    vi.useFakeTimers();
    const { api } = setup();
    api.writes.update((n) => n + 1);
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.calls).toEqual([]);
  });

  it("marks a part whose request failed, keeps what it had, and clears the mark once it loads", async () => {
    const { api, pulse } = setup();
    await pulse.refresh(["i18n"]);
    const working = api.i18nStatus.bind(api);
    api.i18nStatus = async () => ({ ok: false as const, error: "http_502", status: 502 }) as never;

    await pulse.refresh(["i18n"]);
    expect(pulse.failed().has("i18n")).toBe(true);
    expect(pulse.i18n()).toEqual([]);

    api.i18nStatus = working;
    await pulse.refresh(["i18n"]);
    expect(pulse.failed().has("i18n")).toBe(false);
  });

  it("forgets everything on sign-out", async () => {
    const { pulse } = setup();
    await pulse.refresh();
    pulse.publishOpen.set(true);
    pulse.reset();

    expect(pulse.status()).toBeNull();
    expect(pulse.messages()).toBeNull();
    expect(pulse.publishOpen()).toBe(false);
  });
});
