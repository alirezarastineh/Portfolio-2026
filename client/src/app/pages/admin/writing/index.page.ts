import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
} from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideEllipsis, lucidePencil, lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDropdownMenuImports } from "@spartan-ng/helm/dropdown-menu";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService, type PostListRow } from "../../../admin/admin-api.service";
import { createBlankPost } from "../../../admin/create-entities";
import { ConfirmService } from "../../../admin/components/confirm-dialog.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../../admin/components/load-state.component";
import { AdminPageHeaderComponent } from "../../../admin/components/page-header.component";
import { RecoveryService } from "../../../admin/recovery.service";

const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const FULL_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Writing (plan 5, U14): the posts as a table, newest first as the server orders them (undated
 * drafts on top). A title opens its editor; Add creates a draft and opens it.
 */
@Component({
  selector: "app-admin-writing",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    FormSkeletonComponent,
    HlmButton,
    HlmDropdownMenuImports,
    HlmTableImports,
    LoadErrorComponent,
    NgIcon,
    RouterLink,
  ],
  viewProviders: [provideIcons({ lucideEllipsis, lucidePencil, lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
      <app-page-header
        title="Writing"
        description="Posts appear once they are published, their date has passed, and the site has been published after that."
        preview="/admin/preview/en/writing"
      >
        <button
          hlmBtn
          variant="outline"
          type="button"
          headerActions
          [disabled]="adding()"
          (click)="add()"
        >
          <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
          <span class="ml-1.5">Add post</span>
        </button>
      </app-page-header>

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="3" label="Loading posts…" />
      } @else if (loadError(); as reason) {
        <app-load-error title="Could not load the posts" [reason]="reason" (retry)="reload()" />
      } @else {
        <div hlmTableContainer>
          <table hlmTable>
            <caption class="sr-only">
              Posts, newest first
            </caption>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh scope="col">Title</th>
                <th hlmTh scope="col" class="max-sm:hidden">Languages</th>
                <th hlmTh scope="col">Status</th>
                <th hlmTh scope="col" class="max-sm:hidden">Date</th>
                <th hlmTh scope="col" class="w-12"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (row of rows(); track row.id) {
                <tr hlmTr class="h-9 pointer-coarse:h-11">
                  <td hlmTd class="whitespace-normal">
                    <a
                      class="font-medium wrap-anywhere text-foreground underline-offset-2 hover:underline"
                      [routerLink]="['/admin/writing', row.slug]"
                      >{{ title(row) }}</a
                    >
                    <span
                      class="block font-data text-xs wrap-anywhere text-muted-foreground"
                      translate="no"
                      >/{{ row.slug }}</span
                    >
                  </td>
                  <td hlmTd class="font-data text-xs max-sm:hidden">{{ languages(row) }}</td>
                  <td hlmTd>{{ status(row) }}</td>
                  <td hlmTd class="text-data whitespace-nowrap text-muted-foreground max-sm:hidden">
                    @if (row.publishedAt) {
                      <time [attr.datetime]="row.publishedAt">{{ date(row.publishedAt) }}</time>
                    } @else {
                      No date
                    }
                  </td>
                  <td hlmTd class="text-right">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      class="text-muted-foreground pointer-coarse:size-11"
                      [hlmDropdownMenuTrigger]="rowMenu"
                      [hlmDropdownMenuTriggerData]="{ $implicit: row }"
                      [attr.aria-label]="'More actions for ' + title(row)"
                    >
                      <ng-icon name="lucideEllipsis" size="16" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr hlmTr>
                  <td hlmTd colspan="5" class="py-6 text-hint text-muted-foreground">
                    No posts yet.
                    <button
                      hlmBtn
                      variant="link"
                      size="sm"
                      type="button"
                      class="px-1"
                      (click)="add()"
                    >
                      Add a post
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <ng-template #rowMenu let-row>
          <hlm-dropdown-menu class="w-48">
            <button hlmDropdownMenuItem [routerLink]="['/admin/writing', row.slug]">
              <ng-icon name="lucidePencil" size="14" aria-hidden="true" />
              <span>Edit</span>
            </button>
            <hlm-dropdown-menu-separator />
            <button
              hlmDropdownMenuItem
              class="text-destructive focus:text-destructive"
              (triggered)="remove(row)"
            >
              <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
              <span>Delete</span>
            </button>
          </hlm-dropdown-menu>
        </ng-template>
      }
    </div>
  `,
})
export default class AdminWritingPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly recovery = inject(RecoveryService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly rows = signal<PostListRow[]>([]);
  protected readonly loading = signal(true);
  /** The API's reason when the list did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly adding = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.listPosts();
    this.loading.set(false);
    this.loadError.set(result.ok ? null : result.error);
    if (result.ok) this.rows.set(result.data.posts);
  }

  protected title(row: PostListRow): string {
    return row.translations.en?.title || row.translations.de?.title || row.slug;
  }

  /** The languages it exists in: "EN, DE", "EN" or "DE". */
  protected languages(row: PostListRow): string {
    return (["en", "de"] as const)
      .filter((locale) => row.translations[locale])
      .map((locale) => locale.toUpperCase())
      .join(", ");
  }

  /** As saved: a draft, scheduled for a date to come, or published. */
  protected status(row: PostListRow): string {
    if (row.status === "draft") return "Draft";
    const at = row.publishedAt ? Date.parse(row.publishedAt) : Number.NaN;
    return at > Date.now() ? `Scheduled for ${DAY_MONTH.format(at)}` : "Published";
  }

  protected date(iso: string): string {
    return FULL_DATE.format(new Date(iso));
  }

  /** A new draft, straight into its editor. */
  protected async add(): Promise<void> {
    this.adding.set(true);
    const result = await createBlankPost(this.api);
    this.adding.set(false);
    if (!result.ok) {
      toast.error("Could not add post", { description: result.error });
      return;
    }
    void this.router.navigate(["/admin/writing", result.slug]);
  }

  protected async remove(row: PostListRow): Promise<void> {
    const go = await this.confirm.ask({
      title: `Delete ${this.title(row)}?`,
      description: "The post and its text in every language are deleted. This cannot be undone.",
      confirmLabel: "Delete post",
      destructive: true,
    });
    if (!go) return;

    const previous = this.rows();
    this.rows.update((list) => list.filter((r) => r.id !== row.id));
    const result = await this.api.deletePost(row.id);
    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not delete", { description: result.error });
      return;
    }
    this.recovery.forget("post", row.id);
    // Its row and ⋯ went: the page's Add takes the focus.
    afterNextRender(
      () => this.host.nativeElement.querySelector<HTMLElement>("app-page-header button")?.focus(),
      { injector: this.injector },
    );
  }
}
