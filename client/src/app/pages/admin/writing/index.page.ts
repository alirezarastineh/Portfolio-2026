import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { Router, RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucidePencil, lucidePlus, lucideTrash2 } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import { AdminApiService, type PostListRow } from "../../../admin/admin-api.service";
import { ConfirmService } from "../../../admin/components/confirm-dialog.component";
import {
  UiGroupEditorComponent,
  type UiFieldDef,
} from "../../../admin/components/ui-group-editor.component";
import { unsavedChangesGuard } from "../../../admin/unsaved-changes.service";

const COPY_FIELDS: UiFieldDef[] = [
  { key: "heading", label: "Section heading" },
  { key: "subtitle", label: "Section subtitle" },
  { key: "readingTime", label: "Reading time (keep {n})" },
  { key: "allPosts", label: "“All posts” link" },
  { key: "empty", label: "When nothing is published" },
  { key: "rss", label: "RSS link label" },
  { key: "published", label: "“Published” label" },
  { key: "updated", label: "“Updated” label" },
  { key: "tags", label: "“Tags” label" },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-writing",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmBadge,
    HlmButton,
    HlmSeparator,
    HlmSkeleton,
    NgIcon,
    RouterLink,
    UiGroupEditorComponent,
  ],
  viewProviders: [provideIcons({ lucidePencil, lucidePlus, lucideTrash2 })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">Writing</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Posts appear once they are published, their date has passed, and the site has been
            published after that.
          </p>
        </div>
        <button hlmBtn variant="outline" (click)="add()">
          <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
          <span class="ml-1.5">New post</span>
        </button>
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-48 w-full" />
      } @else if (!rows().length) {
        <p class="text-sm text-muted-foreground">No posts yet.</p>
      } @else {
        <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
          @for (row of rows(); track row.id) {
            <li class="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="m-0 truncate font-mono text-sm">
                  {{ row.translations.en?.title || row.translations.de?.title || row.slug }}
                </p>
                <p class="m-0 mt-0.5 font-mono text-[0.72rem] text-muted-foreground">
                  /{{ row.slug }} · {{ row.publishedAt ? formatDate(row.publishedAt) : "no date" }}
                </p>
              </div>
              @for (locale of ["en", "de"]; track locale) {
                @if (hasLocale(row, locale)) {
                  <span hlmBadge variant="outline" class="font-mono text-[0.65rem] uppercase">{{
                    locale
                  }}</span>
                }
              }
              <span hlmBadge [variant]="statusVariant(row)" class="font-mono text-[0.65rem]">{{
                statusLabel(row)
              }}</span>
              <a hlmBtn variant="outline" size="sm" [routerLink]="['/admin/writing', row.slug]">
                <ng-icon name="lucidePencil" size="14" aria-hidden="true" />
                <span class="ml-1.5">Edit</span>
              </a>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                class="text-muted-foreground hover:text-destructive"
                [attr.aria-label]="'Delete ' + row.slug"
                (click)="remove(row)"
              >
                <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
              </button>
            </li>
          }
        </ul>
      }

      <hlm-separator />
    </div>

    <app-ui-group-editor
      group="writing"
      title="Writing copy"
      description="Labels on the writing index and around each post."
      [fields]="copyFields"
    />
  `,
})
export default class AdminWritingPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);

  protected readonly copyFields = COPY_FIELDS;
  protected readonly rows = signal<PostListRow[]>([]);
  protected readonly loading = signal(true);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.listPosts();
    this.loading.set(false);
    if (!result.ok) {
      toast.error("Could not load posts", { description: result.error });
      return;
    }
    this.rows.set(result.data.posts);
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  protected hasLocale(row: PostListRow, locale: string): boolean {
    return Boolean(row.translations[locale as "en" | "de"]);
  }

  protected statusLabel(row: PostListRow): string {
    if (row.status === "draft") return "draft";
    return row.publishedAt && new Date(row.publishedAt).getTime() > Date.now()
      ? "scheduled"
      : "published";
  }

  protected statusVariant(row: PostListRow): "default" | "secondary" | "outline" {
    const label = this.statusLabel(row);
    if (label === "published") return "default";
    return label === "scheduled" ? "secondary" : "outline";
  }

  protected async add(): Promise<void> {
    const slug = `post-${Date.now().toString(36)}`;
    const result = await this.api.createPost({
      slug,
      status: "draft",
      publishedAt: null,
      coverId: null,
      tags: [],
      canonicalUrl: "",
      translations: {
        en: { title: "New post", excerpt: "", body: "", seoTitle: "", seoDescription: "" },
        de: null,
      },
    });
    if (!result.ok) {
      toast.error("Could not create the post", { description: result.error });
      return;
    }
    void this.router.navigate(["/admin/writing", slug]);
  }

  protected async remove(row: PostListRow): Promise<void> {
    const go = await this.confirm.ask({
      title: `Delete ${row.slug}?`,
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
    }
  }
}
