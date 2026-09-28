import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowLeft, lucideInbox, lucideMail } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
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
import { actionsFor, afterLeaving, inFilter, stepFrom, type InboxFilter } from "../../admin/inbox";
import { absoluteTime, relativeTime } from "../../admin/relative-time";

type Filter = InboxFilter;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "new", label: "New" },
  { id: "read", label: "Read" },
  { id: "archived", label: "Archived" },
  { id: "spam", label: "Spam" },
];

const MOVED: Partial<Record<MessageStatus, string>> = {
  archived: "Archived",
  spam: "Marked as spam",
};

/**
 * Messages from the contact form. Every one is stored before its email is
 * sent, so this is also where a message whose email failed still arrives.
 * Kept for 180 days.
 *
 * From `lg`, two panes: the list (360px) and the open message beside it,
 * which stays in view down a long list. Below, the list, and a message in its
 * place once opened. Opening a new message marks it read. J / K move through
 * the list, E archives, U marks unread (`?` lists them).
 */
@Component({
  selector: "app-admin-inbox",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    FormSkeletonComponent,
    HlmBadge,
    HlmButton,
    HlmEmptyImports,
    HlmToggleGroupImports,
    LoadErrorComponent,
    NgIcon,
  ],
  viewProviders: [provideIcons({ lucideArrowLeft, lucideInbox, lucideMail })],
  host: { class: "block", "(document:keydown)": "onKeydown($event)" },
  template: `
    <div class="mx-auto flex max-w-6xl flex-col gap-6 pb-12">
      <app-page-header
        title="Inbox"
        description="Contact-form messages, newest first. Kept for 180 days. J and K move through the list, E archives."
      >
        <span headerStatus>
          @if (fresh(); as n) {
            <span hlmBadge class="font-mono">{{ n }} new</span>
          }
        </span>
      </app-page-header>

      <!-- A filter over one list, not tabs: there are no panels to switch between. -->
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

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="3" label="Loading messages…" />
      } @else if (loadError(); as reason) {
        <app-load-error title="Could not load the messages" [reason]="reason" (retry)="load()" />
      } @else if (!messages().length) {
        <div hlmEmpty class="border border-dashed border-border">
          <div hlmEmptyHeader>
            <div hlmEmptyMedia variant="icon">
              <ng-icon name="lucideInbox" size="20" aria-hidden="true" />
            </div>
            <h2 hlmEmptyTitle>Nothing here</h2>
            <p hlmEmptyDescription>{{ emptyText() }}</p>
          </div>
        </div>
      } @else {
        <div class="grid items-start gap-4 lg:grid-cols-[22.5rem_minmax(0,1fr)]">
          <section
            aria-labelledby="inbox-list-title"
            class="min-w-0"
            [class]="selected() ? 'max-lg:hidden' : ''"
          >
            <h2 id="inbox-list-title" class="sr-only">Messages</h2>
            <ul
              class="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-lg border border-border p-0"
              role="list"
            >
              @for (message of messages(); track message.id) {
                @let current = message.id === selectedId();
                <li>
                  <button
                    type="button"
                    class="flex w-full min-w-0 flex-col gap-1 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    [class.bg-surface-2]="current"
                    [attr.data-message]="message.id"
                    [attr.aria-current]="current ? 'true' : null"
                    (click)="open(message)"
                  >
                    <span class="flex min-w-0 items-center gap-2">
                      @if (message.status === "new") {
                        <span
                          class="size-2 shrink-0 rounded-full bg-accent-orange"
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
                        class="shrink-0 font-mono text-xs text-muted-foreground"
                        [attr.datetime]="message.createdAt"
                        >{{ relative(message.createdAt) }}</time
                      >
                    </span>
                    <span
                      class="line-clamp-2 text-xs text-muted-foreground"
                      [class.text-foreground]="message.status === 'new'"
                      >{{ message.message }}</span
                    >
                    @if (message.mailStatus === "failed") {
                      <span class="font-mono text-xs text-destructive">email failed</span>
                    }
                  </button>
                </li>
              }
            </ul>
          </section>

          <section
            aria-labelledby="inbox-reader-title"
            class="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100svh-6rem)] lg:overflow-y-auto"
            [class]="selected() ? '' : 'max-lg:hidden'"
          >
            @if (selected(); as message) {
              <article class="flex flex-col gap-4 rounded-lg border border-border p-5">
                <button
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  type="button"
                  class="self-start lg:hidden"
                  (click)="close()"
                >
                  <ng-icon name="lucideArrowLeft" size="14" aria-hidden="true" />
                  <span class="ml-1.5">All messages</span>
                </button>
                <header class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div class="min-w-0">
                    <h2
                      id="inbox-reader-title"
                      tabindex="-1"
                      class="m-0 text-h4 wrap-break-word outline-none"
                    >
                      {{ message.name }}
                    </h2>
                    <p class="m-0 font-mono text-xs wrap-anywhere text-muted-foreground">
                      {{ message.email }}
                    </p>
                  </div>
                  <p class="m-0 font-mono text-xs text-muted-foreground">
                    <time [attr.datetime]="message.createdAt">{{
                      absolute(message.createdAt)
                    }}</time
                    >{{ message.locale ? " · " + message.locale.toUpperCase() : "" }}
                  </p>
                </header>

                <div class="flex flex-wrap items-center gap-2">
                  <span
                    hlmBadge
                    [variant]="message.status === 'new' ? 'default' : 'outline'"
                    class="font-mono"
                    >{{ message.status }}</span
                  >
                  @if (message.mailStatus === "failed") {
                    <span
                      hlmBadge
                      variant="destructive"
                      class="font-mono"
                      [title]="message.mailError ?? ''"
                      >email failed</span
                    >
                  }
                </div>

                <p class="m-0 whitespace-pre-wrap text-sm leading-relaxed wrap-break-word">
                  {{ message.message }}
                </p>

                <div class="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                  <a hlmBtn size="sm" [href]="replyHref(message)">
                    <ng-icon name="lucideMail" size="14" aria-hidden="true" />
                    <span class="ml-1.5">Reply</span>
                  </a>
                  @for (action of actions(message); track action.status) {
                    <button
                      hlmBtn
                      variant="outline"
                      size="sm"
                      type="button"
                      [attr.aria-keyshortcuts]="shortcutFor(action.status)"
                      (click)="setStatus(message, action.status)"
                    >
                      {{ action.label }}
                    </button>
                  }
                </div>
              </article>
            } @else {
              <div hlmEmpty class="border border-dashed border-border">
                <div hlmEmptyHeader>
                  <h2 id="inbox-reader-title" hlmEmptyTitle>No message open</h2>
                  <p hlmEmptyDescription>Choose one from the list, or press J.</p>
                </div>
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
  protected readonly filter = signal<Filter>("inbox");
  protected readonly messages = signal<MessageRow[]>([]);
  protected readonly loading = signal(true);
  /** The API's reason when the list did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);

  protected readonly selected = computed(
    () => this.messages().find((m) => m.id === this.selectedId()) ?? null,
  );
  protected readonly fresh = computed(
    () => this.messages().filter((m) => m.status === "new").length,
  );
  protected readonly emptyText = computed(() =>
    this.filter() === "inbox"
      ? "No messages yet. Whatever arrives through the contact form lands here."
      : "No messages with this status.",
  );

  ngOnInit(): void {
    // A link to one message (the dashboard's latest) opens it.
    this.selectedId.set(this.route.snapshot.queryParamMap.get("m"));
    void this.load();
  }

  protected onFilter(value: unknown): void {
    const filter = FILTERS.find((f) => f.id === value)?.id;
    if (!filter) return;
    this.filter.set(filter);
    this.select(null);
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
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { m: id },
      replaceUrl: true,
    });
  }

  /** J / K from the open message (or the first), E and U on it. */
  protected onKeydown(event: KeyboardEvent): void {
    if (!isShortcutTarget(event)) return;
    const key = event.key.toLowerCase();
    if (key === "j" || key === "k") {
      event.preventDefault();
      this.step(key === "j" ? 1 : -1);
    } else if (key === "e" || key === "u") {
      const message = this.selected();
      const status = key === "e" ? "archived" : "new";
      if (!message || !actionsFor(message.status).some((a) => a.status === status)) return;
      event.preventDefault();
      void this.setStatus(message, status);
    }
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
    // Gone from this list: the one after it opens (or the one before, at the end).
    const { rest, next } = afterLeaving(this.messages(), message.id);
    this.messages.set(rest);
    if (next && this.wide()) this.open(next);
    else this.select(null);
    toast.success(MOVED[status] ?? "Moved to the inbox");
  }

  private patchStatus(id: string, status: MessageStatus): void {
    this.messages.update((list) => list.map((m) => (m.id === id ? { ...m, status } : m)));
  }

  protected actions(message: MessageRow): { status: MessageStatus; label: string }[] {
    return actionsFor(message.status);
  }

  protected shortcutFor(status: MessageStatus): string | null {
    if (status === "archived") return "E";
    return status === "new" ? "U" : null;
  }

  protected relative(iso: string): string {
    return relativeTime(iso);
  }

  protected absolute(iso: string): string {
    return absoluteTime(iso);
  }

  protected replyHref(message: MessageRow): string {
    return `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent("Re: your message")}`;
  }

  /** Both panes side by side (lg), rather than one at a time. */
  private wide(): boolean {
    return globalThis.matchMedia?.("(min-width: 1024px)").matches ?? true;
  }

  private find<T extends Element>(selector: string): T | null {
    return (this.host.nativeElement as HTMLElement).querySelector<T>(selector);
  }
}
