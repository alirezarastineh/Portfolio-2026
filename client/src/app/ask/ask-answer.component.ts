import { NgTemplateOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from "@angular/core";
import { Router } from "@angular/router";
import { isToolUIPart, type ChatStatus } from "ai";

import { fmt } from "../i18n/interpolate";
import { LanguageService } from "../services/language.service";
import { AskStore } from "./ask.store";
import type { AskMessage, Entry } from "./ask-types";
import { AskLinesComponent } from "./ask-lines.component";
import { citationOrder, plainText, renderMarkdown, type Block } from "./terminal-markdown";
import { track } from "./track";

type AskEntry = Extract<Entry, { kind: "ask" }>;

interface Footnote {
  id: string;
  n: number;
  url: string;
  title: string;
}

type Piece = { kind: "step"; text: string; pending: boolean } | { kind: "text"; blocks: Block[] };

/**
 * One answer as the terminal shows it: tool steps as dim shell output, the
 * text (safe Markdown, citations as footnote numbers), footnotes, follow-up
 * suggestions, an optional meta line, and feedback. While it is being
 * written: "thinking… 1.2 s", then a caret at the end of the text.
 */
@Component({
  selector: "app-ask-answer",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AskLinesComponent, NgTemplateOutlet],
  host: { class: "block" },
  template: `
    <ng-template #inline let-nodes>
      @for (node of nodes; track $index) {
        @switch (node.t) {
          @case ("text") {
            <ng-container>{{ node.v }}</ng-container>
          }
          @case ("strong") {
            <strong class="font-semibold text-foreground"
              ><ng-container *ngTemplateOutlet="inline; context: { $implicit: node.c }"
            /></strong>
          }
          @case ("em") {
            <em><ng-container *ngTemplateOutlet="inline; context: { $implicit: node.c }" /></em>
          }
          @case ("code") {
            <code class="rounded bg-muted px-1 py-px text-[0.92em]">{{ node.v }}</code>
          }
          @case ("link") {
            <a
              class="underline decoration-accent-indigo underline-offset-4 hover:decoration-accent-orange"
              [href]="node.href"
              [attr.rel]="node.internal ? null : 'noopener'"
              (click)="follow($event, node.href, node.internal)"
              ><ng-container *ngTemplateOutlet="inline; context: { $implicit: node.c }"
            /></a>
          }
          @case ("cite") {
            <a
              class="cite"
              [href]="footnoteHref(node.id)"
              [attr.aria-label]="citeLabel(node.id)"
              (click)="followCite($event, node.id)"
              ><sup>[{{ node.n }}]</sup></a
            >
          }
        }
      }
    </ng-template>

    <div class="flex flex-col gap-1.5 pb-3 text-foreground/90">
      @for (piece of pieces(); track $index) {
        @if (piece.kind === "step") {
          <p class="m-0 text-muted-foreground">
            <span aria-hidden="true">› </span>{{ piece.text }}
            @if (piece.pending) {
              <span aria-hidden="true">…</span>
            }
          </p>
        } @else {
          @for (block of piece.blocks; track $index; let last = $last) {
            @switch (block.t) {
              @case ("p") {
                <!-- prettier-ignore -->
                <p class="m-0 whitespace-pre-wrap wrap-break-word leading-relaxed"><ng-container *ngTemplateOutlet="inline; context: { $implicit: block.c }" />@if (writing() && last) {<span class="terminal-caret" aria-hidden="true"></span>}</p>
              }
              @case ("ul") {
                <ul class="m-0 list-none p-0">
                  @for (item of block.items; track $index) {
                    <li class="grid grid-cols-[1.5ch_1fr] gap-x-1">
                      <span class="text-accent-orange" aria-hidden="true">-</span
                      ><span class="wrap-break-word"
                        ><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }"
                      /></span>
                    </li>
                  }
                </ul>
              }
              @case ("ol") {
                <ol class="m-0 list-none p-0" [attr.start]="block.start">
                  @for (item of block.items; track $index; let i = $index) {
                    <li class="grid grid-cols-[3ch_1fr] gap-x-1">
                      <span class="text-accent-orange" aria-hidden="true"
                        >{{ block.start + i }}.</span
                      ><span class="wrap-break-word"
                        ><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }"
                      /></span>
                    </li>
                  }
                </ol>
              }
              @case ("pre") {
                <pre
                  class="m-0 overflow-x-auto rounded-md border border-border bg-background/60 p-3 text-[0.85em]"
                  tabindex="0"
                ><code>{{ block.v }}</code></pre>
              }
            }
          }
        }
      }

      @if (thinking()) {
        <p class="m-0 text-muted-foreground" role="status">
          {{ copy().thinking }} <span class="tabular-nums">{{ elapsed() }}</span>
          <span class="ml-2 hidden text-xs sm:inline">{{ copy().stopHint }}</span>
        </p>
      }

      @if (footnotes().length) {
        <div class="mt-1 border-t border-dashed border-border pt-2 text-xs">
          <span class="sr-only">{{ copy().sources }}</span>
          <ol class="m-0 list-none p-0">
            @for (note of footnotes(); track note.id) {
              <li [id]="noteId(note.id)" class="flex gap-2">
                <span class="text-muted-foreground" aria-hidden="true">[{{ note.n }}]</span>
                <a
                  class="underline decoration-border underline-offset-4 hover:decoration-accent-orange"
                  [href]="note.url"
                  (click)="followSource($event, note.url)"
                  >{{ note.title }}</a
                >
              </li>
            }
          </ol>
        </div>
      }

      @if (entry().failure; as failure) {
        <p class="m-0 text-destructive" role="status">{{ failureText() }}</p>
        @if (entry().offline; as lines) {
          <app-ask-lines [lines]="lines" />
        }
        @if (retryable()) {
          <button
            type="button"
            class="w-fit cursor-pointer font-mono text-xs text-accent-orange underline underline-offset-4"
            (click)="retry.emit()"
          >
            ↻ {{ copy().retry }}
          </button>
        }
      } @else if (interrupted()) {
        <p class="m-0 text-xs text-muted-foreground">{{ copy().interrupted }}</p>
      }

      @if (done() && followups().length && latest()) {
        <div class="mt-1 flex flex-wrap items-center gap-2 text-xs">
          <span class="text-muted-foreground">{{ copy().followups }}:</span>
          @for (item of followups(); track item) {
            <button
              type="button"
              class="cursor-pointer rounded-md border border-border px-2 py-1 text-left text-foreground/85 transition-colors hover:border-accent-orange hover:text-foreground"
              (click)="ask.emit(item)"
            >
              {{ item }}
            </button>
          }
        </div>
      }

      @if (done() && message()) {
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          @if (meta(); as m) {
            <span>── {{ m }} ──</span>
          }
          <span class="flex items-center gap-1">
            <button
              type="button"
              class="cursor-pointer rounded px-1 hover:text-foreground"
              [attr.aria-pressed]="rating() === 1"
              [attr.aria-label]="copy().helpful"
              [class.text-accent-orange]="rating() === 1"
              (click)="rate(1)"
            >
              +1
            </button>
            <button
              type="button"
              class="cursor-pointer rounded px-1 hover:text-foreground"
              [attr.aria-pressed]="rating() === -1"
              [attr.aria-label]="copy().notHelpful"
              [class.text-accent-orange]="rating() === -1"
              (click)="rate(-1)"
            >
              -1
            </button>
            <button
              type="button"
              class="cursor-pointer rounded px-1 hover:text-foreground"
              (click)="copyAnswer()"
            >
              {{ copied() ? copy().copied : copy().copy }}
            </button>
            @if (rating()) {
              <span>{{ copy().thanks }}</span>
            }
          </span>
        </div>
      }
    </div>
  `,
  styles: `
    .cite {
      color: var(--accent-orange);
      text-decoration: none;
    }
    .cite sup {
      font-size: 0.72em;
      line-height: 0;
      margin-left: 1px;
    }
    .cite:hover sup,
    .cite:focus-visible sup {
      text-decoration: underline;
    }
  `,
})
export class AskAnswerComponent {
  readonly entry = input.required<AskEntry>();
  readonly message = input<AskMessage | undefined>(undefined);
  /** True for the question being answered right now. */
  readonly live = input(false);
  readonly status = input<ChatStatus>("ready");
  /** The newest question: only its follow-ups and retry are offered. */
  readonly latest = input(false);

  readonly ask = output<string>();
  readonly retry = output<void>();

  protected readonly store = inject(AskStore);
  private readonly lang = inject(LanguageService);
  private readonly router = inject(Router);

  protected readonly copy = this.store.copy;
  protected readonly copied = signal(false);
  private readonly now = signal(Date.now());

  protected readonly thinking = computed(
    () => this.live() && this.status() === "submitted" && !this.entry().failure,
  );
  protected readonly writing = computed(() => this.live() && this.status() === "streaming");
  protected readonly done = computed(
    () => !this.live() || this.status() === "ready" || this.status() === "error",
  );

  protected readonly text = computed(() =>
    (this.message()?.parts ?? [])
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n\n"),
  );

  protected readonly footnotes = computed<Footnote[]>(() => {
    const sources = (this.message()?.parts ?? []).flatMap((p) =>
      p.type === "source-url" ? [{ id: p.sourceId, url: p.url, title: p.title ?? p.url }] : [],
    );
    const order = citationOrder(this.text());
    const cited = order.flatMap((id) => sources.filter((s) => s.id === id));
    const rest = sources.filter((s) => !order.includes(s.id));
    return [...cited, ...rest].map((s, i) => ({ ...s, n: i + 1 }));
  });

  private readonly linkPolicy = computed(() => {
    const content = this.lang.content();
    const known = new Set([
      ...content.socials.map((s) => s.href),
      `mailto:${content.identity.contactEmail}`,
    ]);
    const site = content.identity.siteUrl.replace(/\/$/, "");
    return (href: string): "internal" | "external" | null => {
      if (href.startsWith("/") && !href.startsWith("//")) return "internal";
      if (known.has(href)) return "external";
      if (site && href.startsWith(`${site}/`)) return "internal";
      return null;
    };
  });

  protected readonly pieces = computed<Piece[]>(() => {
    const copy = this.copy();
    const numbers = new Map(this.footnotes().map((f) => [f.id, f.n]));
    const options = {
      cite: (id: string) => numbers.get(id) ?? null,
      link: this.linkPolicy(),
    };
    const pieces: Piece[] = [];
    for (const part of this.message()?.parts ?? []) {
      if (part.type === "text") {
        if (part.text) pieces.push({ kind: "text", blocks: renderMarkdown(part.text, options) });
      } else if (isToolUIPart(part)) {
        const name = part.type.slice("tool-".length);
        const input = (part.input ?? {}) as Record<string, unknown>;
        const label = stepLabel(name, input, copy.tool);
        if (label) {
          pieces.push({
            kind: "step",
            text: label,
            pending: part.state === "input-streaming" || part.state === "input-available",
          });
        }
      }
    }
    return pieces;
  });

  protected readonly followups = computed(() => {
    for (const part of this.message()?.parts ?? []) {
      if (part.type === "tool-suggest_followups" && part.input) {
        const items = (part.input as { items?: unknown }).items;
        if (Array.isArray(items))
          return items.filter((i): i is string => typeof i === "string").slice(0, 3);
      }
    }
    return [];
  });

  protected readonly interrupted = computed(
    () =>
      this.done() && !!this.message() && !this.message()?.metadata?.sig && !this.entry().failure,
  );

  protected readonly retryable = computed(() => {
    const failure = this.entry().failure;
    return (
      this.latest() && !!failure && !["resting", "off", "invalid", "tooLong"].includes(failure)
    );
  });

  protected readonly failureText = computed(() => {
    const entry = this.entry();
    if (!entry.failure) return "";
    if (entry.failure === "rateLimited") {
      const until = this.store.limitedUntil();
      const left = until
        ? Math.max(0, Math.ceil((until - this.now()) / 1000))
        : (entry.retryAfter ?? 60);
      return fmt(this.copy().errors.rateLimited, { s: left });
    }
    return this.store.messageFor(entry.failure, entry.retryAfter);
  });

  protected readonly meta = computed(() => {
    const m = this.message()?.metadata;
    if (!m?.model) return null;
    const copy = this.copy();
    const fallback = m.fallback ? ` (${copy.fallback})` : "";
    if (!this.store.stats()) return m.fallback ? `${m.model}${fallback}` : null;
    const parts = [`${m.model}${m.route === "deep" ? " · deep" : ""}${fallback}`];
    if (typeof m.totalMs === "number") parts.push(`${(m.totalMs / 1000).toFixed(1)} s`);
    if (m.tokens && m.tokens.input > 0) {
      parts.push(fmt(copy.cached, { p: Math.round((m.tokens.cached / m.tokens.input) * 100) }));
    }
    return parts.join(" · ");
  });

  protected readonly rating = computed(() => {
    const id = this.message()?.id;
    return id ? (this.store.feedback()[id] ?? 0) : 0;
  });

  protected readonly elapsed = computed(() => {
    const started = this.message()?.metadata?.createdAt ?? this.startedAt;
    return `${((this.now() - started) / 1000).toFixed(1)} s`;
  });

  private readonly startedAt = Date.now();

  constructor() {
    // A clock for "thinking… 1.2 s" and the rate-limit countdown, only while needed.
    let timer: ReturnType<typeof setInterval> | undefined;
    effect(() => {
      const ticking = this.thinking() || this.entry().failure === "rateLimited";
      if (ticking && !timer) {
        timer = setInterval(() => this.now.set(Date.now()), 100);
      } else if (!ticking && timer) {
        clearInterval(timer);
        timer = undefined;
      }
    });
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected noteId(id: string): string {
    return `ask-note-${this.message()?.id ?? "x"}-${id.replace(/[^a-z0-9]/gi, "-")}`;
  }

  protected footnoteHref(id: string): string {
    return this.footnotes().find((f) => f.id === id)?.url ?? "#";
  }

  protected citeLabel(id: string): string {
    const note = this.footnotes().find((f) => f.id === id);
    return note ? `${this.copy().sources} ${note.n}: ${note.title}` : "";
  }

  protected follow(event: MouseEvent, href: string, internal: boolean): void {
    if (!internal || modified(event)) return;
    event.preventDefault();
    void this.router.navigateByUrl(href.replace(/^https?:\/\/[^/]+/, ""));
  }

  protected followCite(event: MouseEvent, id: string): void {
    track("ask_citation_click");
    this.followSource(event, this.footnoteHref(id));
  }

  protected followSource(event: MouseEvent, url: string): void {
    if (modified(event) || !url.startsWith("/") || url.startsWith("/media/")) return;
    event.preventDefault();
    void this.router.navigateByUrl(url);
  }

  protected rate(value: 1 | -1): void {
    const id = this.message()?.id;
    if (id && this.rating() !== value) void this.store.rate(id, value);
  }

  protected async copyAnswer(): Promise<void> {
    try {
      await navigator.clipboard.writeText(plainText(this.text()));
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      // Clipboard refused (permissions): nothing to do.
    }
  }
}

function modified(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

function stepLabel(
  name: string,
  input: Record<string, unknown>,
  labels: Record<string, string>,
): string | null {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  switch (name) {
    case "search_portfolio":
      return fmt(labels["search_portfolio"]!, { q: str("query") });
    case "get_document":
      return fmt(labels["get_document"]!, { id: str("id") });
    case "list_projects":
      return fmt(labels["list_projects"]!, { q: str("text") }).trim();
    case "get_resume":
      return labels["get_resume"]!;
    case "navigate":
      return fmt(labels["navigate"]!, { to: str("to") });
    default:
      // Follow-ups and the hand-off have their own rendering.
      return null;
  }
}
