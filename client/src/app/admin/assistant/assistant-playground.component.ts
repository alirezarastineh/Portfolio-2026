import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injectable,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Chat } from "@ai-sdk/angular";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";

import type { Locale } from "../../content/schema";
import { AdminApiService } from "../admin-api.service";
import { readCsrfCookie } from "../admin-api.interceptor";
import { seconds, usd } from "../outcomes";
import { AdminPulseService } from "../pulse.service";
import { featureStop } from "../spending";
import { FeatureStopComponent } from "./feature-stop.component";

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
  return btoa(String.fromCodePoint(...bytes)).replaceAll(/[+/=]/g, "x");
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

const NUMBER = new Intl.NumberFormat("en");

/** How long to wait each time for an answer's log: it is written just after its stream ends. */
const COST_WAITS = [0, 1000, 3000];

/**
 * The Playground's conversation (plan 5, U18). It outlives the panel's sheet: closing it or
 * switching views keeps the question, the answers and their costs until New conversation, a
 * reload or leaving the Assistant. The panel provides it; not root, which cannot see the layout's
 * `AdminApiService`.
 */
@Injectable()
export class PlaygroundSession {
  private readonly api = inject(AdminApiService);

  readonly locale = signal<Locale>("en");
  readonly question = signal("");
  readonly deep = signal(false);
  /** Each answer's cost from the answers' log; null once it was looked for and not found. */
  readonly costs = signal<ReadonlyMap<string, number | null>>(new Map());
  private session = sessionId();

  readonly chat = new Chat<PlaygroundMessage>({
    transport: new DefaultChatTransport<PlaygroundMessage>({
      api: `${this.api.baseUrl}/admin/assistant/playground`,
      credentials: "include",
      headers: () => ({ "X-CSRF-Token": readCsrfCookie() ?? "" }),
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          sessionId: this.session,
          locale: this.locale(),
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
    onFinish: ({ message }) => void this.findCost(message.id),
  });

  send(): void {
    const text = this.question().trim();
    if (!text || ["submitted", "streaming"].includes(this.chat.status)) {
      return;
    }
    this.question.set("");
    void this.chat.sendMessage({ text });
  }

  clear(): void {
    void this.chat.stop();
    this.chat.messages = [];
    this.costs.set(new Map());
    this.session = sessionId();
  }

  /** The stream carries tokens, not dollars: the cost comes from the answer's log, by its id. */
  private async findCost(id: string, waits: readonly number[] = COST_WAITS): Promise<void> {
    if (waits.length === 0) {
      this.costs.update((all) => new Map(all).set(id, null));
      return;
    }
    const [wait, ...later] = waits;
    await pause(wait);
    const result = await this.api.assistantConversations("all", "playground");
    const row = result.ok ? result.data.messages.find((m) => m.id === id) : undefined;
    if (row) {
      this.costs.update((all) => new Map(all).set(id, row.usd));
      return;
    }
    await this.findCost(id, later);
  }
}

/**
 * The assistant against the draft content: what it would answer after the
 * next publish. Same agent, tools and fallback chain as visitors get; logged
 * apart (`source = playground`), no rate limits, cost counted. Each question
 * is a paid call: Ask says so, and each answer ends with its cost.
 */
@Component({
  selector: "app-assistant-playground",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FeatureStopComponent, FormsModule, HlmButton, HlmSwitch, HlmTextarea],
  host: { class: "flex flex-col gap-4" },
  template: `
    <div class="flex flex-wrap items-center gap-4 text-sm">
      <label class="flex items-center gap-2">
        Language
        <select
          class="h-9 rounded-lg border border-input-line bg-card px-2 text-sm text-foreground pointer-coarse:h-11 pointer-coarse:text-base"
          [ngModel]="s.locale()"
          (ngModelChange)="s.locale.set($event)"
        >
          <option value="en">English</option>
          <option value="de">German</option>
        </select>
      </label>
      <label class="flex items-center gap-2">
        <hlm-switch [checked]="s.deep()" (checkedChange)="s.deep.set($event)" />
        Deep model
      </label>
      <button hlmBtn type="button" variant="ghost" size="sm" (click)="s.clear()">
        New conversation
      </button>
    </div>

    <div class="flex flex-col gap-4 text-sm" role="log" aria-live="off">
      @for (m of messages(); track m.id) {
        @if (m.role === "user") {
          <p class="m-0 font-medium">{{ text(m) }}</p>
        } @else {
          <div class="flex flex-col gap-1">
            @if (reasoning(m); as thought) {
              <!-- Plan phase 23: the model's thoughts, for the admin only; evidence, not proof. -->
              <details class="rounded-md border border-border px-2 py-1 text-xs">
                <summary class="cursor-pointer text-muted-foreground">Reasoning</summary>
                <p class="m-0 mt-1 whitespace-pre-wrap text-muted-foreground">{{ thought }}</p>
              </details>
            }
            @for (step of steps(m); track $index) {
              <p class="m-0 font-data text-xs text-muted-foreground">{{ step }}</p>
            }
            <p class="m-0 whitespace-pre-wrap" [textContent]="text(m)"></p>
            @if (sources(m).length) {
              <ol class="m-0 pl-5 text-xs text-muted-foreground">
                @for (source of sources(m); track source.id) {
                  <li>
                    <span class="font-data">{{ source.id }}</span>: {{ source.title }},
                    {{ source.url }}
                  </li>
                }
              </ol>
            }
            @if (metaLine(m); as line) {
              <p class="m-0 text-hint text-muted-foreground">{{ line }}</p>
            }
          </div>
        }
      } @empty {
        <p class="m-0 text-muted-foreground">Ask something the draft should answer.</p>
      }
      @if (status() === "submitted") {
        <p class="m-0 text-muted-foreground">Thinking…</p>
      }
      @if (error(); as e) {
        <p class="m-0 text-destructive">{{ e }}</p>
      }
    </div>

    <form class="flex flex-col gap-2" (submit)="$event.preventDefault(); ask()">
      <label for="playground-question" class="text-sm font-medium">
        Question for the draft assistant
      </label>
      <textarea
        id="playground-question"
        hlmTextarea
        rows="2"
        name="question"
        autocomplete="off"
        [ngModel]="s.question()"
        (ngModelChange)="s.question.set($event)"
        (keydown.enter)="onEnter($event)"
      ></textarea>
      <div class="flex gap-2">
        <!-- Paid: off while the Playground would be refused; Enter in the question sends nothing then. -->
        <button
          hlmBtn
          type="submit"
          class="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          [attr.aria-disabled]="stop() ? 'true' : null"
          [attr.aria-describedby]="stop() ? 'stop-playground' : null"
          [disabled]="busy()"
        >
          Ask (paid)
        </button>
        @if (busy()) {
          <button hlmBtn variant="outline" type="button" (click)="s.chat.stop()">Stop</button>
        }
      </div>
      @if (stop(); as reason) {
        <!-- Settings is behind this panel: following the link closes it. -->
        <app-feature-stop
          noteId="stop-playground"
          [reason]="reason"
          (followed)="pulse.playgroundOpen.set(false)"
        />
      }
    </form>
  `,
})
export class AssistantPlaygroundComponent {
  protected readonly s = inject(PlaygroundSession);
  protected readonly pulse = inject(AdminPulseService);
  /** Why a question would be refused now, or null: Ask says so, and nothing is sent. */
  protected readonly stop = computed(() =>
    featureStop(this.pulse.assistant()?.spend, "playground"),
  );

  protected readonly messages = computed(() => this.s.chat.messages);
  protected readonly status = computed(() => this.s.chat.status);
  protected readonly busy = computed(() => ["submitted", "streaming"].includes(this.status()));
  protected readonly error = computed(() => {
    const error = this.s.chat.error;
    if (!error) {
      return null;
    }
    const body =
      "responseBody" in error && typeof error.responseBody === "string" ? error.responseBody : "";
    return `Failed: ${body || error.message}`;
  });

  /** Enter asks; Shift+Enter is a new line, and Enter while composing ends the word. */
  protected onEnter(event: Event): void {
    if (!(event instanceof KeyboardEvent) || event.shiftKey || event.isComposing) {
      return;
    }
    event.preventDefault();
    this.ask();
  }

  /** Ask and Enter both come here: a stopped Playground sends nothing. */
  protected ask(): void {
    if (!this.stop()) {
      this.s.send();
    }
  }

  protected text(m: PlaygroundMessage): string {
    return m.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("\n\n");
  }

  /** The model's thought summaries (plan phase 23), or null without any. */
  protected reasoning(m: PlaygroundMessage): string | null {
    const thought = m.parts
      .filter((p) => p.type === "reasoning")
      .map((p) => p.text.trim())
      .filter(Boolean)
      .join("\n\n");
    return thought || null;
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

  /** "gemini-flash, lite route, 1.4 s; 1,203 tokens in, 900 cached, 80 out; $0.0004". */
  protected metaLine(m: PlaygroundMessage): string | null {
    const meta = m.metadata;
    if (!meta?.model) {
      return null;
    }
    const answered = [
      `${meta.model}${meta.fallback ? " (a fallback)" : ""}`,
      meta.route ? `${meta.route} route` : "",
      meta.totalMs === undefined ? "" : seconds(meta.totalMs),
    ];
    const tokens = meta.tokens
      ? `${NUMBER.format(meta.tokens.input)} tokens in, ${NUMBER.format(meta.tokens.cached)} cached, ${NUMBER.format(meta.tokens.output)} out`
      : "";
    return [answered.filter(Boolean).join(", "), tokens, this.costWords(m.id)]
      .filter(Boolean)
      .join("; ");
  }

  /** The answer's cost once its log is found; nothing while it is looked for. */
  private costWords(id: string): string {
    const cost = this.s.costs().get(id);
    if (cost === undefined) {
      return "";
    }
    return cost === null ? "cost not logged" : usd(cost);
  }
}
