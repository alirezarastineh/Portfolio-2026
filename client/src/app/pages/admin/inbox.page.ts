import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
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

type Filter = "inbox" | MessageStatus;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "inbox", label: "Inbox" },
  { id: "new", label: "New" },
  { id: "read", label: "Read" },
  { id: "archived", label: "Archived" },
  { id: "spam", label: "Spam" },
];

/**
 * Messages from the contact form. Every one is stored before its email is
 * sent, so this is also where a message whose email failed still arrives.
 * Kept for 180 days.
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
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <app-page-header
        title="Inbox"
        description="Contact-form messages, newest first. Kept for 180 days."
      />

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
        <p class="m-0 text-sm text-muted-foreground">Nothing here.</p>
      } @else {
        <ul class="m-0 flex list-none flex-col gap-3 p-0" role="list">
          @for (message of messages(); track message.id) {
            <li class="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <p class="m-0 text-sm">
                  <strong class="font-medium">{{ message.name }}</strong>
                  <span class="text-muted-foreground"> &lt;{{ message.email }}&gt;</span>
                </p>
                <p class="m-0 font-mono text-xs text-muted-foreground">
                  {{ formatDate(message.createdAt)
                  }}{{ message.locale ? " · " + message.locale.toUpperCase() : "" }}
                </p>
              </div>
              <p class="m-0 whitespace-pre-wrap text-sm leading-relaxed">{{ message.message }}</p>
              <div class="flex flex-wrap items-center gap-2">
                <span
                  hlmBadge
                  [variant]="message.status === 'new' ? 'default' : 'outline'"
                  class="font-mono"
                >
                  {{ message.status }}
                </span>
                @if (message.mailStatus === "failed") {
                  <span
                    hlmBadge
                    variant="destructive"
                    class="font-mono"
                    [title]="message.mailError ?? ''"
                  >
                    email failed
                  </span>
                }
                <span class="flex-1"></span>
                <a hlmBtn variant="outline" size="sm" [href]="replyHref(message)">Reply</a>
                @for (action of actionsFor(message); track action.status) {
                  <button
                    hlmBtn
                    variant="ghost"
                    size="sm"
                    type="button"
                    (click)="setStatus(message, action.status)"
                  >
                    {{ action.label }}
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export default class AdminInboxPage implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly filters = FILTERS;
  protected readonly filter = signal<Filter>("inbox");
  protected readonly messages = signal<MessageRow[]>([]);
  protected readonly loading = signal(true);
  /** The API's reason when the list did not arrive. */
  protected readonly loadError = signal<string | null>(null);

  ngOnInit(): void {
    void this.load();
  }

  protected onFilter(value: unknown): void {
    const filter = FILTERS.find((f) => f.id === value)?.id;
    if (filter) this.setFilter(filter);
  }

  protected setFilter(filter: Filter): void {
    this.filter.set(filter);
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
    if (result.ok) this.messages.set(result.data.messages);
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  protected replyHref(message: MessageRow): string {
    return `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent("Re: your message")}`;
  }

  protected actionsFor(message: MessageRow): { status: MessageStatus; label: string }[] {
    const all: { status: MessageStatus; label: string }[] = [
      { status: "read", label: "Mark read" },
      { status: "new", label: "Mark unread" },
      { status: "archived", label: "Archive" },
      { status: "spam", label: "Spam" },
    ];
    return all.filter(
      (a) => a.status !== message.status && !(a.status === "new" && message.status !== "read"),
    );
  }

  protected async setStatus(message: MessageRow, status: MessageStatus): Promise<void> {
    const result = await this.api.setMessageStatus(message.id, status);
    if (!result.ok) {
      toast.error("Not changed", { description: result.error });
      return;
    }
    await this.load();
  }
}
