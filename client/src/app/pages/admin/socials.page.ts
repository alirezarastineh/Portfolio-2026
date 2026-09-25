import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSwitch } from "@spartan-ng/helm/switch";

import {
  AdminApiService,
  type ApiIssue,
  type SocialInput,
  type SocialRow,
} from "../../admin/admin-api.service";
import { ICON_KEYS } from "../../icons/icon-registry";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import {
  FieldIssueComponent,
  SaveBarComponent,
} from "../../admin/components/editor-chrome.component";
import {
  SortableListComponent,
  SortableRowDirective,
} from "../../admin/components/sortable-list.component";
import { FieldIssues, focusFirstInvalid } from "../../admin/issues";
import { toastIssues } from "../../admin/save-feedback";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";

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

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

function toInput(row: SocialRow): SocialInput {
  return {
    label: row.label.trim(),
    href: row.href.trim(),
    icon: row.icon,
    isVisible: row.isVisible,
  };
}

@Component({
  selector: "app-admin-socials",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldIssueComponent,
    FormsModule,
    HlmButton,
    HlmInput,
    HlmSkeleton,
    HlmSwitch,
    NgIcon,
    SaveBarComponent,
    SortableListComponent,
    SortableRowDirective,
  ],
  viewProviders: [provideIcons({ lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-28">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">Socials</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Footer links. Edits are kept until you save; adding, deleting and reordering take effect
            at once.
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
              class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto_auto_auto] sm:items-start"
            >
              <div class="flex flex-col">
                <input
                  hlmInput
                  class="h-9"
                  maxlength="60"
                  [ngModel]="row.label"
                  (ngModelChange)="patch(row.id, { label: $event })"
                  placeholder="GitHub"
                  aria-label="Link label"
                  [attr.aria-invalid]="issues.get(row.id + '.label') ? true : null"
                  [attr.aria-describedby]="
                    issues.get(row.id + '.label') ? row.id + '-label-issue' : null
                  "
                />
                <app-field-issue
                  [id]="row.id + '-label-issue'"
                  [message]="issues.get(row.id + '.label')"
                />
              </div>
              <div class="flex flex-col">
                <input
                  hlmInput
                  class="h-9"
                  maxlength="500"
                  [ngModel]="row.href"
                  (ngModelChange)="patch(row.id, { href: $event })"
                  placeholder="https://…"
                  aria-label="Link URL"
                  [attr.aria-invalid]="issues.get(row.id + '.href') ? true : null"
                  [attr.aria-describedby]="
                    issues.get(row.id + '.href') ? row.id + '-href-issue' : null
                  "
                />
                <app-field-issue
                  [id]="row.id + '-href-issue'"
                  [message]="issues.get(row.id + '.href')"
                />
              </div>
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
              <label
                class="flex h-9 items-center gap-2 font-mono text-[0.72rem] text-muted-foreground"
              >
                <hlm-switch
                  [checked]="row.isVisible"
                  (checkedChange)="patch(row.id, { isVisible: $event })"
                  aria-label="Visible"
                />
                <span>{{ row.isVisible ? "shown" : "hidden" }}</span>
                @if (isChanged(row.id)) {
                  <span class="text-accent-orange">· unsaved</span>
                }
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

        <app-save-bar
          [dirty]="changedIds().length > 0"
          [saving]="saving()"
          [problems]="issues.count()"
          (save)="save()"
          (discard)="discard()"
        />
      }
    </div>
  `,
})
export default class AdminSocialsPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly icons = ICONS;
  protected readonly rows = signal<SocialRow[]>([]);
  /** Each link as last saved, by id. */
  private readonly saved = signal<ReadonlyMap<string, SocialRow>>(new Map());
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  /** Keyed `<link id>.<field>`. */
  protected readonly issues = new FieldIssues();

  protected readonly changedIds = computed(() => {
    const saved = this.saved();
    return this.rows()
      .filter((row) => {
        const before = saved.get(row.id);
        return !before || JSON.stringify(toInput(row)) !== JSON.stringify(toInput(before));
      })
      .map((row) => row.id);
  });

  constructor() {
    effect(() => this.unsaved.set("socials", this.changedIds().length > 0));
    inject(DestroyRef).onDestroy(() => this.unsaved.clear("socials"));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected readonly trackRow = (row: SocialRow): string => row.id;

  protected isChanged(id: string): boolean {
    return this.changedIds().includes(id);
  }

  private async load(): Promise<void> {
    const result = await this.api.listSocials();
    this.loading.set(false);

    if (!result.ok) {
      toast.error("Could not load socials", { description: result.error });
      return;
    }
    this.rows.set(result.data.socials);
    this.saved.set(new Map(result.data.socials.map((row) => [row.id, structuredClone(row)])));
  }

  protected patch(id: string, change: Partial<SocialInput>): void {
    this.rows.update((list) => list.map((r) => (r.id === id ? { ...r, ...change } : r)));
    for (const key of Object.keys(change)) this.issues.resolve(`${id}.${key}`);
  }

  protected discard(): void {
    const saved = this.saved();
    this.rows.update((list) => list.map((row) => structuredClone(saved.get(row.id) ?? row)));
    this.issues.clear();
  }

  /** Every changed link. One that fails keeps its edits and says why. */
  protected async save(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);

    const failed: ApiIssue[] = [];
    let error = "";
    for (const id of this.changedIds()) {
      const row = this.rows().find((r) => r.id === id);
      if (!row) continue;
      const input = toInput(row);
      const result = await this.api.updateSocial(id, input);
      if (result.ok) {
        this.saved.update((map) => new Map(map).set(id, structuredClone(row)));
      } else if (result.issues?.length) {
        failed.push(...result.issues.map((i) => ({ ...i, path: [id, ...i.path] })));
      } else {
        error = result.error;
      }
    }
    this.saving.set(false);

    if (failed.length > 0) {
      this.issues.set(failed);
      toastIssues(failed);
      focusFirstInvalid(this.host.nativeElement);
    } else if (error) {
      toast.error("Not saved", { description: error });
    } else {
      this.issues.clear();
      toast.success("Draft saved");
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
    const social = result.data.social;
    this.rows.update((list) => [...list, social]);
    this.saved.update((map) => new Map(map).set(social.id, structuredClone(social)));
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
      return;
    }
    this.issues.resolve(row.id);
    this.saved.update((map) => {
      const next = new Map(map);
      next.delete(row.id);
      return next;
    });
  }

  /** Optimistic and immediate: reorder is idempotent and trivially reversible. */
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
