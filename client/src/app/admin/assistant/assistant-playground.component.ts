import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Chat } from "@ai-sdk/angular";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";

import type { Locale } from "../../content/schema";
import { AdminApiService } from "../admin-api.service";
import { readCsrfCookie } from "../admin-api.interceptor";

interface Meta {
  sig?: string;
  model?: string | null;
  fallback?: boolean;
  route?: string;
  totalMs?: number;
  tokens?: { input: number; cached: number; output: number };
}

type PlaygroundMessage = UIMessage<Meta>;

function sessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCodePoint(...bytes)).replace(/[+/=]/g, "x");
}

/**
 * The assistant against the draft content: what it would answer after the
 * next publish. Same agent, tools and fallback chain as visitors get; logged
 * apart (`source = playground`), no rate limits, cost counted.
 */
@Component({
  selector: "app-assistant-playground",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, HlmButton, HlmSwitch, HlmTextarea],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex flex-wrap items-center gap-4 text-sm">
        <label class="flex items-center gap-2">
          Language
          <select
            class="rounded-md border border-border bg-background px-2 py-1"
            [(ngModel)]="locale"
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
          </select>
        </label>
        <label class="flex items-center gap-2">
          <hlm-switch [checked]="deep()" (checkedChange)="deep.set($event)" />
          Deep model
        </label>
        <button hlmBtn variant="ghost" size="sm" (click)="clear()">New conversation</button>
      </div>

      <div
        class="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 font-mono text-sm"
        role="log"
        aria-live="off"
      >
        @for (m of messages(); track m.id) {
          @if (m.role === "user") {
            <p class="m-0 text-accent-orange">&gt; {{ text(m) }}</p>
          } @else {
            <div class="flex flex-col gap-1">
              @for (step of steps(m); track $index) {
                <p class="m-0 text-muted-foreground">› {{ step }}</p>
              }
              <p class="m-0 whitespace-pre-wrap">{{ text(m) }}</p>
              @if (sources(m).length) {
                <ol class="m-0 pl-5 text-xs text-muted-foreground">
                  @for (s of sources(m); track s.id) {
                    <li>{{ s.id }} — {{ s.title }} ({{ s.url }})</li>
                  }
                </ol>
              }
              @if (m.metadata; as meta) {
                @if (meta.model) {
                  <p class="m-0 text-xs text-muted-foreground">
                    ── {{ meta.model }}{{ meta.fallback ? " (fallback)" : "" }} · {{ meta.route }} ·
                    {{ ((meta.totalMs ?? 0) / 1000).toFixed(1) }} s · {{ meta.tokens?.input }} in /
                    {{ meta.tokens?.cached }} cached / {{ meta.tokens?.output }} out ──
                  </p>
                }
              }
            </div>
          }
        } @empty {
          <p class="m-0 text-muted-foreground">Ask something the draft should answer.</p>
        }
        @if (status() === "submitted") {
          <p class="m-0 text-muted-foreground">thinking…</p>
        }
        @if (error(); as e) {
          <p class="m-0 text-destructive">{{ e }}</p>
        }
      </div>

      <form class="flex flex-col gap-2" (submit)="$event.preventDefault(); send()">
        <textarea
          hlmTextarea
          rows="2"
          aria-label="Question for the draft assistant"
          [(ngModel)]="question"
          name="question"
          (keydown.enter)="onEnter($any($event))"
        ></textarea>
        <div class="flex gap-2">
          <button hlmBtn type="submit" [disabled]="busy()">Ask</button>
          @if (busy()) {
            <button hlmBtn variant="outline" type="button" (click)="chat.stop()">Stop</button>
          }
        </div>
      </form>
    </div>
  `,
})
export class AssistantPlaygroundComponent {
  private readonly api = inject(AdminApiService);

  protected locale: Locale = "en";
  protected question = "";
  protected readonly deep = signal(false);
  private session = sessionId();

  protected readonly chat = new Chat<PlaygroundMessage>({
    transport: new DefaultChatTransport<PlaygroundMessage>({
      api: `${this.api.baseUrl}/admin/assistant/playground`,
      credentials: "include",
      headers: () => ({ "X-CSRF-Token": readCsrfCookie() ?? "" }),
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          sessionId: this.session,
          locale: this.locale,
          ...(this.deep() ? { deep: true } : {}),
          messages: messages.slice(-16).map((m) => ({
            id: m.id,
            role: m.role,
            parts: m.parts.filter((p) => p.type === "text"),
            ...(m.role === "assistant" && m.metadata?.sig
              ? { metadata: { sig: m.metadata.sig } }
              : {}),
          })),
        },
      }),
    }),
  });

  protected readonly messages = computed(() => this.chat.messages);
  protected readonly status = computed(() => this.chat.status);
  protected readonly busy = computed(() => ["submitted", "streaming"].includes(this.status()));
  protected readonly error = computed(() => {
    const error = this.chat.error;
    if (!error) return null;
    const body = (error as { responseBody?: string }).responseBody;
    return body ? `Failed: ${body}` : `Failed: ${error.message}`;
  });

  protected send(): void {
    const text = this.question.trim();
    if (!text || this.busy()) return;
    this.question = "";
    void this.chat.sendMessage({ text });
  }

  /** Enter asks; Shift+Enter is a new line. */
  protected onEnter(event: KeyboardEvent): void {
    if (event.shiftKey) return;
    event.preventDefault();
    this.send();
  }

  protected clear(): void {
    void this.chat.stop();
    this.chat.messages = [];
    this.session = sessionId();
  }

  protected text(m: PlaygroundMessage): string {
    return m.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n\n");
  }

  protected steps(m: PlaygroundMessage): string[] {
    return m.parts.flatMap((p) =>
      isToolUIPart(p) ? [`${p.type.slice(5)} ${JSON.stringify(p.input ?? {})}`] : [],
    );
  }

  protected sources(m: PlaygroundMessage): { id: string; url: string; title: string }[] {
    return m.parts.flatMap((p) =>
      p.type === "source-url" ? [{ id: p.sourceId, url: p.url, title: p.title ?? "" }] : [],
    );
  }
}
