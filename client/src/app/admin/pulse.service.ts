import { DOCUMENT } from "@angular/common";
import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from "@angular/core";

import {
  AdminApiService,
  type AdminStatus,
  type ApiResult,
  type I18nItem,
  type MessageRow,
} from "./admin-api.service";
import type { AssistantHealth } from "./assistant-types";
import { trustAlert } from "./trust";
import { summarizeReview, type PublishSummary } from "./publish-summary";

/** A save is often several requests: wait for them to settle before looking again. */
const SETTLE_MS = 600;
/** A tab brought back after this long looks again. */
const STALE_MS = 30_000;

export type PulsePart = "status" | "review" | "messages" | "i18n" | "assistant";

const ALL: readonly PulsePart[] = ["status", "review", "messages", "i18n", "assistant"];
/** What a write can change. The assistant's health is not among them. */
const AFTER_WRITE: readonly PulsePart[] = ["status", "review", "messages", "i18n"];

/** Why the assistant needs a look, or null while it is answering normally. */
export function assistantAlert(health: AssistantHealth | null): string | null {
  if (!health) return null;
  // An alert or a demotion waits for a person; a breaker heals by itself.
  const trust = trustAlert(health.trust);
  if (trust) return trust;
  const open = health.breakers.filter((b) => b.state === "open").length;
  if (open === 1) return "A model is failing: its breaker is open";
  if (open > 1) return `${open} models are failing: their breakers are open`;
  const failed = health.last24h.failures;
  if (failed === 1) return "1 answer failed in the last 24 hours";
  if (failed > 1) return `${failed} answers failed in the last 24 hours`;
  return null;
}

/**
 * The admin at a glance, shared by the sidebar and the dashboard: whether the
 * draft is ahead of the live site and by how much, new messages, translations
 * to check, and the assistant's health. Loaded once signed in, again after
 * every write (debounced), and when the tab comes back after a while.
 *
 * It also owns the review dialog's open state, so the sidebar's Publish and
 * the dashboard's button open the one dialog the layout holds.
 */
@Injectable()
export class AdminPulseService {
  private readonly api = inject(AdminApiService);
  private readonly doc = inject(DOCUMENT);

  readonly status = signal<AdminStatus | null>(null);
  readonly review = signal<PublishSummary | null>(null);
  /** The inbox (spam left out), newest first. */
  readonly messages = signal<MessageRow[] | null>(null);
  readonly i18n = signal<I18nItem[] | null>(null);
  readonly assistant = signal<AssistantHealth | null>(null);

  /** Parts whose last request failed: what they show is older, or nothing yet. */
  readonly failed = signal<ReadonlySet<PulsePart>>(new Set());

  readonly publishOpen = signal(false);
  /** Bumped after each publish that wrote something, for lists of publications to reload. */
  readonly publishes = signal(0);

  /** A draft that fails validation counts too: the review lists its problems. */
  readonly unpublished = computed(() => this.status()?.hasUnpublishedChanges === true);
  readonly newMessages = computed(
    () => this.messages()?.filter((m) => m.status === "new").length ?? 0,
  );
  readonly assistantAlert = computed(() => assistantAlert(this.assistant()));

  private started = false;
  private lastRefresh = 0;
  private settle: ReturnType<typeof setTimeout> | undefined;
  /** Per part, the latest request: an older answer arriving late is dropped. */
  private readonly latest: Record<PulsePart, number> = {
    status: 0,
    review: 0,
    messages: 0,
    i18n: 0,
    assistant: 0,
  };

  private readonly onVisibility = (): void => {
    if (this.doc.visibilityState === "visible" && Date.now() - this.lastRefresh > STALE_MS) {
      void this.refresh();
    }
  };

  constructor() {
    effect(() => {
      if (this.api.writes() > 0) untracked(() => this.afterWrite());
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.settle);
      this.doc.removeEventListener("visibilitychange", this.onVisibility);
    });
  }

  /** Called by the layout once someone is signed in. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.doc.addEventListener("visibilitychange", this.onVisibility);
    void this.refresh();
  }

  async refresh(parts: readonly PulsePart[] = ALL): Promise<void> {
    this.lastRefresh = Date.now();
    await Promise.all(parts.map((part) => this.load(part)));
  }

  /** For a page that shows these numbers: fresh ones, unless they just arrived. */
  refreshIfStale(ms = 5_000): Promise<void> {
    return Date.now() - this.lastRefresh > ms ? this.refresh() : Promise.resolve();
  }

  /** After a publish that wrote something (the write itself refreshes the counts). */
  published(): void {
    this.publishes.update((n) => n + 1);
  }

  /** Signing out: nothing of this session shows at the next sign-in. */
  reset(): void {
    clearTimeout(this.settle);
    this.started = false;
    this.lastRefresh = 0;
    this.doc.removeEventListener("visibilitychange", this.onVisibility);
    for (const part of ALL) this.latest[part]++;
    this.status.set(null);
    this.review.set(null);
    this.messages.set(null);
    this.i18n.set(null);
    this.assistant.set(null);
    this.failed.set(new Set());
    this.publishOpen.set(false);
  }

  private afterWrite(): void {
    if (!this.started) return;
    clearTimeout(this.settle);
    this.settle = setTimeout(() => void this.refresh(AFTER_WRITE), SETTLE_MS);
  }

  /** A failed request keeps what was there: a stale count beats a blank one. */
  private load(part: PulsePart): Promise<void> {
    switch (part) {
      case "status":
        return this.fetchAndSet(
          "status",
          () => this.api.status(),
          (d) => this.status.set(d),
        );
      case "review":
        return this.fetchAndSet(
          "review",
          () => this.api.publishReview(),
          (d) => this.review.set(summarizeReview(d)),
        );
      case "messages":
        return this.fetchAndSet(
          "messages",
          () => this.api.listMessages(),
          (d) => this.messages.set(d.messages.filter((m) => m.status !== "spam")),
        );
      case "i18n":
        return this.fetchAndSet(
          "i18n",
          () => this.api.i18nStatus(),
          (d) => this.i18n.set(d.items),
        );
      case "assistant":
        return this.fetchAndSet(
          "assistant",
          () => this.api.assistantHealth(),
          (d) => this.assistant.set(d),
        );
    }
  }

  private async fetchAndSet<T>(
    part: PulsePart,
    fetch: () => Promise<ApiResult<T>>,
    apply: (data: T) => void,
  ): Promise<void> {
    const request = ++this.latest[part];
    const result = await fetch();
    if (request !== this.latest[part]) return;
    if (result.ok) apply(result.data);
    this.failed.update((failed) => {
      if (failed.has(part) === !result.ok) return failed;
      const next = new Set(failed);
      if (result.ok) next.delete(part);
      else next.add(part);
      return next;
    });
  }
}
