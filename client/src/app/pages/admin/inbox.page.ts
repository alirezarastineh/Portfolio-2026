import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router, type Params } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowLeft, lucideMail, lucideTriangleAlert } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmToggleGroupImports } from "@spartan-ng/helm/toggle-group";

import {
  AdminApiService,
  type MessageRow,
  type MessageStatus,
} from "../../admin/admin-api.service";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../admin/components/load-state.component";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import { isShortcutTarget } from "../../admin/components/shortcut-sheet.component";
import {
  actionsFor,
  afterLeaving,
  filterFrom,
  inFilter,
  replyHref,
  statusForKey,
  stepFrom,
  withoutMarks,
  type InboxFilter,
} from "../../admin/inbox";
import { absoluteTime, relativeTime } from "../../admin/relative-time";

type Filter = InboxFilter;

/** The filters, and what each says when it holds nothing. */
const FILTERS: { id: Filter; label: string; empty: string }[] = [
  { id: "inbox", label: "Inbox", empty: "No messages yet." },
  { id: "new", label: "New", empty: "No new messages." },
  { id: "read", label: "Read", empty: "No read messages." },
  { id: "archived", label: "Archived", empty: "Nothing archived." },
  { id: "spam", label: "Spam", empty: "No spam." },
];

const MOVED: Partial<Record<MessageStatus, string>> = {
  archived: "Archived",
  spam: "Marked as spam",
};

/** Each action's key, shown on its button. */
const KEYS: Partial<Record<MessageStatus, string>> = { archived: "E", new: "U", spam: "#" };

/**
 * Messages from the contact form. Every one is stored before its email is
 * sent, so this is also where a message whose email failed still arrives.
 * Kept for 180 days.
 *
 * A list and a reader: from `lg`, side by side, the reader staying in view down
 * a long list; below, the list, then the reader as its own view with a way back.
 * The address holds the filter and the open message (`?filter=new&m=…`), so a
 * reload, a link or the rail's Inbox puts the page where it says. Opening a new
 * message marks it read. J / K move, E archives, U marks unread, R replies,
 * # marks spam (`?` lists them); never in a field, a dialog or a menu.
 */
@Component({
  selector: "app-admin-inbox",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    FormSkeletonComponent,
    HlmBadge,
    HlmButton,
    HlmToggleGroupImports,
    LoadErrorComponent,
    NgIcon,
  ],
  viewProviders: [provideIcons({ lucideArrowLeft, lucideMail, lucideTriangleAlert })],
  host: { class: "block", "(document:keydown)": "onKeydown($event)" },
  template: `
    <div class="flex max-w-7xl flex-col gap-6 pb-12">
      <app-page-header
        title="Inbox"
        description="Messages from the contact form, newest first, kept for 180 days. J and K move through the list."
      >
        <span headerStatus>
          @if (fresh(); as n) {
            <span hlmBadge>{{ n }} new</span>
          }
        </span>
      </app-page-header>

      <!-- A filter over one list, not tabs: there are no panels to switch between. On a
           phone the open message has the screen to itself. -->
      <div [class]="selected() ? 'max-lg:hidden' : ''">
        <div
          hlmToggleGroup
          type="single"
          variant="outline"
          size="sm"
          aria-label="Message filter"
          [nullable]="false"
          [value]="filter()"
          (valueChange)="onFilter($event)"
        >
          @for (option of filters; track option.id) {
            <button hlmToggleGroupItem type="button" [value]="option.id">{{ option.label }}</button>
          }
        </div>
      </div>

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="3" label="Loading messages…" />
      } @else if (loadError(); as reason) {
        <app-load-error title="Could not load the messages" [reason]="reason" (retry)="load()" />
      } @else if (!messages().length) {
        <div class="flex flex-col items-start gap-2">
          <h2 id="inbox-empty-title" tabindex="-1" class="m-0 text-section-title outline-none">
            {{ empty().empty }}
          </h2>
          @if (filter() === "inbox") {
            <p class="m-0 text-hint text-muted-foreground">
              Whatever arrives through the contact form lands here.
            </p>
          } @else {
            <button hlmBtn variant="outline" size="sm" type="button" (click)="onFilter('inbox')">
              Show the inbox
            </button>
          }
        </div>
      } @else {
        <div class="grid items-start gap-x-6 gap-y-4 lg:grid-cols-[22.5rem_minmax(0,1fr)]">
          <section
            aria-labelledby="inbox-list-title"
            class="min-w-0"
            [class]="selected() ? 'max-lg:hidden' : ''"
          >
            <h2 id="inbox-list-title" class="sr-only">Messages</h2>
            <!-- Hung 12px into the gutter, as Today's rows: names share the headings' edge. -->
            <ul class="m-0 -ml-3 flex list-none flex-col border-t border-border p-0" role="list">
              @for (message of messages(); track message.id) {
                @let current = message.id === selectedId();
                <li class="border-b border-border">
                  <button
                    type="button"
                    class="flex w-full min-w-0 flex-col gap-1 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:-outline-offset-2"
                    [class.bg-surface-2]="current"
                    [attr.data-message]="message.id"
                    [attr.aria-current]="current ? 'true' : null"
                    (click)="open(message)"
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      @if (message.status === "new") {
                        <span
                          class="size-2 shrink-0 rounded-full bg-foreground forced-color-adjust-none forced-colors:bg-[Highlight]"
                          aria-hidden="true"
                        ></span>
                        <span class="sr-only">New:</span>
                      }
                      <span
                        class="min-w-0 flex-1 truncate text-sm"
                        [class.font-semibold]="message.status === 'new'"
                        >{{ message.name }}</span
                      >
                      <time
                        class="shrink-0 font-data text-xs text-faint-foreground"
                        [attr.datetime]="message.createdAt"
                        >{{ relative(message.createdAt) }}</time
                      >
                    </span>
                    <span
                      class="line-clamp-2 text-hint text-muted-foreground"
                      [class.text-foreground]="message.status === 'new'"
                      >{{ message.message }}</span
                    >
                    @if (message.mailStatus === "failed") {
                      <span class="text-xs text-destructive">Not forwarded to your email</span>
                    }
                  </button>
                </li>
              }
            </ul>
          </section>

          <section
            aria-labelledby="inbox-reader-title"
            class="min-w-0 lg:sticky lg:top-26 lg:max-h-[calc(100svh-7.5rem)] lg:overflow-y-auto"
            [class]="selected() ? '' : 'max-lg:hidden'"
          >
            @if (selected(); as message) {
              <article class="flex flex-col gap-4">
                <button
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  type="button"
                  class="-ml-2 self-start lg:hidden"
                  (click)="close()"
                >
                  <ng-icon name="lucideArrowLeft" size="16" aria-hidden="true" />
                  All messages
                </button>
                @if (message.mailStatus === "failed") {
                  <!-- What went wrong first: the sender may still be waiting for an answer. -->
                  <p class="m-0 flex items-start gap-2 text-sm text-destructive">
                    <ng-icon
                      name="lucideTriangleAlert"
                      size="16"
                      class="mt-0.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span class="min-w-0 wrap-anywhere">{{ forwardFailed(message) }}</span>
                  </p>
                }
                <header class="flex flex-col gap-0.5">
                  <h2
                    id="inbox-reader-title"
                    tabindex="-1"
                    class="m-0 text-section-title wrap-break-word outline-none"
                  >
                    {{ message.name }}
                  </h2>
                  <p class="m-0 text-data wrap-anywhere text-muted-foreground" translate="no">
                    {{ message.email }}
                  </p>
                  <p class="m-0 text-hint text-muted-foreground">
                    Sent
                    <time
                      [attr.datetime]="message.createdAt"
                      [title]="absolute(message.createdAt)"
                      >{{ relative(message.createdAt) }}</time
                    >{{ sentIn(message) }}
                  </p>
                </header>

                <!-- Bound, not interpolated: the template's line breaks would show in pre-wrap. -->
                <p
                  class="m-0 max-w-prose whitespace-pre-wrap text-sm leading-relaxed wrap-break-word"
                  [attr.lang]="message.locale"
                  [textContent]="message.message"
                ></p>

                @if (message.askTranscript; as transcript) {
                  <!-- The visitor ticked "attach": their conversation, redacted, the last turns. -->
                  <details class="flex flex-col gap-2 border-l border-border pl-3 text-sm" open>
                    <summary class="cursor-pointer text-hint text-muted-foreground">
                      Their conversation with the assistant ({{ transcript.turns.length }}
                      {{ transcript.turns.length === 1 ? "answer" : "answers" }})
                    </summary>
                    <ol class="m-0 mt-2 flex list-none flex-col gap-4 p-0">
                      @for (turn of transcript.turns; track turn.at) {
                        <li class="flex flex-col gap-1">
                          <dl class="m-0 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
                            <dt class="text-hint text-muted-foreground">Question</dt>
                            <dd class="m-0 font-medium wrap-anywhere">{{ turn.question }}</dd>
                            <dt class="text-hint text-muted-foreground">Answer</dt>
                            <dd
                              class="m-0 whitespace-pre-wrap wrap-anywhere"
                              [textContent]="answer(turn.answer)"
                            ></dd>
                          </dl>
                          @if (turn.cited.length) {
                            <p
                              class="m-0 pl-21 text-data wrap-anywhere text-muted-foreground"
                              translate="no"
                            >
                              Sources: {{ turn.cited.join(", ") }}
                            </p>
                          }
                        </li>
                      }
                    </ol>
                  </details>
                }

                <div class="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  <a
                    id="inbox-reply"
                    hlmBtn
                    size="sm"
                    aria-keyshortcuts="R"
                    [href]="reply(message)"
                  >
                    <ng-icon name="lucideMail" size="16" aria-hidden="true" />
                    Reply
                    <kbd
                      class="inline-flex items-center rounded-sm border border-current/30 px-1.5 py-px font-data text-xs pointer-coarse:hidden"
                      aria-hidden="true"
                      >R</kbd
                    >
                  </a>
                  @for (action of actions(message); track action.status) {
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      type="button"
                      [attr.aria-keyshortcuts]="keyFor(action.status)"
                      (click)="setStatus(message, action.status)"
                    >
                      {{ action.label }}
                      @if (keyFor(action.status); as key) {
                        <kbd class="key-cap pointer-coarse:hidden" aria-hidden="true">{{
                          key
                        }}</kbd>
                      }
                    </button>
                  }
                </div>
              </article>
            } @else {
              <div class="flex flex-col gap-1 border-t border-border pt-3">
                <h2 id="inbox-reader-title" class="m-0 text-section-title">No message open</h2>
                <p class="m-0 text-hint text-muted-foreground">
                  Choose one from the list, or press J.
                </p>
              </div>
            }
          </section>
        </div>
      }
    </div>
  `,
})
export default class AdminInboxPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly filters = FILTERS;
  private readonly params = this.route.snapshot.queryParamMap;
  protected readonly filter = signal<Filter>(filterFrom(this.params.get("filter")));
  protected readonly messages = signal<MessageRow[]>([]);
  protected readonly loading = signal(true);
  /** The API's reason when the list did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(this.params.get("m"));

  protected readonly selected = computed(
    () => this.messages().find((m) => m.id === this.selectedId()) ?? null,
  );
  protected readonly fresh = computed(
    () => this.messages().filter((m) => m.status === "new").length,
  );
  protected readonly empty = computed(() => FILTERS.find((f) => f.id === this.filter())!);

  constructor() {
    // The address is the truth: the rail's Inbox, a link or Back can change it under the page.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.selectedId.set(params.get("m"));
      const filter = filterFrom(params.get("filter"));
      if (filter === this.filter()) return;
      this.filter.set(filter);
      void this.load();
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected onFilter(value: unknown): void {
    const filter = FILTERS.find((f) => f.id === value)?.id;
    if (!filter) return;
    this.filter.set(filter);
    this.selectedId.set(null);
    this.go({ filter: filter === "inbox" ? null : filter, m: null });
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    const filter = this.filter();
    const result = await this.api.listMessages(filter === "inbox" ? undefined : filter);
    // A later filter's answer wins over an earlier one arriving late.
    if (filter !== this.filter()) return;
    this.loading.set(false);
    this.loadError.set(result.ok ? null : result.error);
    if (!result.ok) return;
    // Spam has its own filter; the server's default leaves out only the archive.
    this.messages.set(result.data.messages.filter((m) => inFilter(filter, m.status)));
    const opened = this.selected();
    if (opened?.status === "new") void this.markRead(opened);
  }

  /** Opens a message; a new one is marked read on the way. */
  protected open(message: MessageRow, focusReader = false): void {
    this.select(message.id);
    if (message.status === "new") void this.markRead(message);
    // Below lg the message replaces the list: its heading takes the focus.
    if (focusReader || !this.wide()) {
      setTimeout(() => this.find<HTMLElement>("#inbox-reader-title")?.focus());
    }
  }

  protected close(): void {
    const id = this.selectedId();
    this.select(null);
    setTimeout(() => this.find<HTMLElement>(`[data-message="${id}"]`)?.focus());
  }

  private select(id: string | null): void {
    this.selectedId.set(id);
    this.go({ m: id });
  }

  /** The filter and the open message into the address, in place: Back leaves the inbox. */
  private go(params: Params): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: "merge",
      replaceUrl: true,
    });
  }

  /** J / K from the open message (or the first); E, U, R and # on it. */
  protected onKeydown(event: KeyboardEvent): void {
    if (!isShortcutTarget(event)) return;
    const key = event.key.toLowerCase();
    if (key === "j" || key === "k") {
      event.preventDefault();
      this.step(key === "j" ? 1 : -1);
      return;
    }
    const message = this.selected();
    if (!message) return;
    if (key === "r") {
      event.preventDefault();
      this.find<HTMLAnchorElement>("#inbox-reply")?.click();
      return;
    }
    const status = statusForKey(key, message.status);
    if (!status) return;
    event.preventDefault();
    void this.setStatus(message, status);
  }

  private step(by: 1 | -1): void {
    const next = stepFrom(this.messages(), this.selectedId(), by);
    if (!next) return;
    this.open(next);
    if (this.wide()) {
      // The row keeps the focus, so the next J starts from where the eye is.
      setTimeout(() => {
        const row = this.find<HTMLElement>(`[data-message="${next.id}"]`);
        row?.focus({ preventScroll: true });
        row?.scrollIntoView({ block: "nearest" });
      });
    }
  }

  private async markRead(message: MessageRow): Promise<void> {
    this.patchStatus(message.id, "read");
    const result = await this.api.setMessageStatus(message.id, "read");
    if (!result.ok) this.patchStatus(message.id, message.status);
  }

  protected async setStatus(message: MessageRow, status: MessageStatus): Promise<void> {
    const result = await this.api.setMessageStatus(message.id, status);
    if (!result.ok) {
      toast.error("Not changed", { description: result.error });
      return;
    }
    if (inFilter(this.filter(), status)) {
      this.patchStatus(message.id, status);
      return;
    }
    // Gone from this list: the one after it opens in its place (the one before, at the end).
    const { rest, next } = afterLeaving(this.messages(), message.id);
    this.messages.set(rest);
    toast.success(MOVED[status] ?? "Moved to the inbox");
    if (next) {
      this.open(next);
    } else {
      // The list is empty now: its words take the focus the action's button had.
      this.select(null);
      setTimeout(() => this.find<HTMLElement>("#inbox-empty-title")?.focus());
    }
  }

  private patchStatus(id: string, status: MessageStatus): void {
    this.messages.update((list) => list.map((m) => (m.id === id ? { ...m, status } : m)));
  }

  protected actions(message: MessageRow): { status: MessageStatus; label: string }[] {
    return actionsFor(message.status);
  }

  protected keyFor(status: MessageStatus): string | null {
    return KEYS[status] ?? null;
  }

  protected reply(message: MessageRow): string {
    return replyHref(message);
  }

  protected answer(text: string): string {
    return withoutMarks(text) || "(no answer)";
  }

  /** ", in German, via the assistant": what the reader needs before answering. */
  protected sentIn(message: MessageRow): string {
    const language = message.locale === "de" ? ", in German" : message.locale ? ", in English" : "";
    return `${language}${message.origin === "ask" ? ", via the assistant" : ""}.`;
  }

  /** The mail service's reason, when it gave one beyond the fallback code. */
  protected forwardFailed(message: MessageRow): string {
    const reason =
      message.mailError && message.mailError !== "send_failed"
        ? ` The mail service said: ${message.mailError.replace(/\.?$/, ".")}`
        : "";
    return `Not forwarded to your email.${reason}`;
  }

  protected relative(iso: string): string {
    return relativeTime(iso);
  }

  protected absolute(iso: string): string {
    return absoluteTime(iso);
  }

  /** Both panes side by side (lg), rather than one at a time. */
  private wide(): boolean {
    return globalThis.matchMedia?.("(min-width: 1024px)").matches ?? true;
  }

  private find<T extends Element>(selector: string): T | null {
    return (this.host.nativeElement as HTMLElement).querySelector<T>(selector);
  }
}
