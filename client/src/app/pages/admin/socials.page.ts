import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSwitch } from "@spartan-ng/helm/switch";

import { AdminApiService, type SocialInput, type SocialRow } from "../../admin/admin-api.service";
import { ICON_KEYS } from "../../icons/icon-registry";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import {
  SortableListComponent,
  SortableRowDirective,
} from "../../admin/components/sortable-list.component";

/** Any registry key; the link icons first. */
const ICONS = [
  "github",
  "linkedin",
  "x",
  "mail",
  "website",
  "rss",
  "mastodon",
  ...ICON_KEYS.filter(
    (k) => !["github", "linkedin", "x", "mail", "website", "rss", "mastodon"].includes(k),
  ),
];

@Component({
  selector: "app-admin-socials",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    HlmButton,
    HlmInput,
    HlmSkeleton,
    HlmSwitch,
    NgIcon,
    SortableListComponent,
    SortableRowDirective,
  ],
  viewProviders: [provideIcons({ lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">Socials</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Footer links. Drag to reorder — saved immediately.
          </p>
        </div>
        <button hlmBtn variant="outline" (click)="add()">
          <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
          <span class="ml-1.5">Add link</span>
        </button>
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-64 w-full" />
      } @else {
        <app-sortable-list
          [items]="rows()"
          [trackBy]="trackRow"
          label="social link"
          emptyText="No social links yet."
          (reordered)="onReorder($event)"
        >
          <ng-template appSortableRow let-row>
            <div
              class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto_auto] sm:items-center"
            >
              <input
                hlmInput
                class="h-9"
                [ngModel]="row.label"
                (ngModelChange)="patch(row.id, { label: $event })"
                placeholder="GitHub"
                aria-label="Link label"
              />
              <input
                hlmInput
                class="h-9"
                [ngModel]="row.href"
                (ngModelChange)="patch(row.id, { href: $event })"
                placeholder="https://…"
                aria-label="Link URL"
              />
              <select
                class="h-9 rounded-md border border-border bg-card px-2 font-mono text-[0.78rem]"
                [ngModel]="row.icon"
                (ngModelChange)="patch(row.id, { icon: $event })"
                aria-label="Icon"
              >
                @for (icon of icons; track icon) {
                  <option [value]="icon">{{ icon }}</option>
                }
              </select>
              <label class="flex items-center gap-2 font-mono text-[0.72rem] text-muted-foreground">
                <hlm-switch
                  [checked]="row.isVisible"
                  (checkedChange)="patch(row.id, { isVisible: $event })"
                  aria-label="Visible"
                />
                <span>{{ row.isVisible ? "shown" : "hidden" }}</span>
              </label>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                class="text-muted-foreground hover:text-destructive"
                [attr.aria-label]="'Delete ' + row.label"
                (click)="remove(row)"
              >
                <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
              </button>
            </div>
          </ng-template>
        </app-sortable-list>

        <p class="m-0 font-mono text-[0.72rem] text-muted-foreground">
          Changes save automatically. Publish from the dashboard to go live.
        </p>
      }
    </div>
  `,
})
export default class AdminSocialsPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);

  protected readonly icons = ICONS;
  protected readonly rows = signal<SocialRow[]>([]);
  protected readonly loading = signal(true);

  /** Coalesces keystrokes so typing a URL is one request, not twenty. */
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  ngOnInit(): void {
    void this.load();
  }

  protected readonly trackRow = (row: SocialRow): string => row.id;

  private async load(): Promise<void> {
    const result = await this.api.listSocials();
    this.loading.set(false);

    if (!result.ok) {
      toast.error("Could not load socials", { description: result.error });
      return;
    }
    this.rows.set(result.data.socials);
  }

  protected patch(id: string, change: Partial<SocialInput>): void {
    this.rows.update((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)));

    clearTimeout(this.pending.get(id));
    this.pending.set(
      id,
      setTimeout(() => void this.persist(id), 600),
    );
  }

  private async persist(id: string): Promise<void> {
    const row = this.rows().find((r) => r.id === id);
    if (!row) return;

    const result = await this.api.updateSocial(id, {
      label: row.label,
      href: row.href,
      icon: row.icon,
      isVisible: row.isVisible,
    });

    if (!result.ok) {
      toast.error("Not saved", { description: result.error });
    }
  }

  protected async add(): Promise<void> {
    const result = await this.api.createSocial({
      label: "New link",
      href: "https://example.com",
      icon: "github",
      isVisible: true,
    });

    if (!result.ok) {
      toast.error("Could not add", { description: result.error });
      return;
    }
    this.rows.update((list) => [...list, result.data.social]);
  }

  protected async remove(row: SocialRow): Promise<void> {
    // Deletion is immediate and has no undo, unlike edits which stay in draft
    // until published — so it always asks first.
    const go = await this.confirm.ask({
      title: `Delete ${row.label}?`,
      description: "It disappears from the footer on the next publish. This cannot be undone.",
      confirmLabel: "Delete link",
      destructive: true,
    });
    if (!go) return;

    const previous = this.rows();
    this.rows.update((list) => list.filter((r) => r.id !== row.id));

    const result = await this.api.deleteSocial(row.id);
    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not delete", { description: result.error });
    }
  }

  /** Optimistic: reorder is idempotent and trivially reversible. */
  protected async onReorder(next: SocialRow[]): Promise<void> {
    const previous = this.rows();
    this.rows.set(next);

    const result = await this.api.reorder(
      "socials",
      next.map((r) => r.id),
    );

    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not reorder", { description: result.error });
    }
  }
}
