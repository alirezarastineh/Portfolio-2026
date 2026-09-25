import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from "@spartan-ng/helm/alert";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import {
  HlmCard,
  HlmCardContent,
  HlmCardDescription,
  HlmCardHeader,
  HlmCardTitle,
} from "@spartan-ng/helm/card";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import {
  AdminApiService,
  type AdminStatus,
  type I18nItem,
  type MediaReconcile,
} from "../../admin/admin-api.service";
import { PublishDialogComponent } from "../../admin/components/publish-dialog.component";
import { editorLinkForI18n } from "../../admin/editor-links";

/** Shown before "show all" — enough to act on without burying the rest of the page. */
const I18N_PREVIEW = 6;

const KIND_LABELS: Record<I18nItem["kind"], string> = {
  project: "project",
  experience: "experience",
  post: "post",
  skill: "skill card",
  faq: "FAQ",
  section: "page copy",
};

@Component({
  selector: "app-admin-dashboard",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmBadge,
    HlmButton,
    HlmCard,
    HlmCardContent,
    HlmCardDescription,
    HlmCardHeader,
    HlmCardTitle,
    HlmSkeleton,
    PublishDialogComponent,
    RouterLink,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">Dashboard</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            Edits are saved as a draft. Publishing makes them live.
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <a hlmBtn variant="outline" routerLink="/admin/preview">Preview draft</a>
          <button
            hlmBtn
            [disabled]="!canReview()"
            [attr.aria-describedby]="canReview() ? null : 'publish-hint'"
            (click)="publishOpen.set(true)"
          >
            Review &amp; publish
          </button>
        </div>
      </header>
      @if (status() && !canReview()) {
        <p
          id="publish-hint"
          class="-mt-4 m-0 text-right font-mono text-[0.72rem] text-muted-foreground"
        >
          nothing to publish — the draft matches what is live
        </p>
      }

      @if (reconcile(); as r) {
        @if (r.missingFiles.length || r.orphanFiles.length) {
          <div hlmAlert variant="destructive">
            <h2 hlmAlertTitle>Media and database are out of step</h2>
            <p hlmAlertDescription>
              {{ r.missingFiles.length }} record(s) without a file,
              {{ r.orphanFiles.length }} file(s) without a record. Usually a database restore
              without a matching media restore.
              <a routerLink="/admin/media" class="underline underline-offset-4">Open media</a>
            </p>
          </div>
        }
      }

      @if (loading()) {
        <hlm-skeleton class="h-40 w-full" />
      } @else if (status(); as s) {
        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle class="flex items-center gap-2 font-mono text-base">
              Draft state
              @if (s.hasUnpublishedChanges) {
                <span hlmBadge variant="default">unpublished changes</span>
              } @else {
                <span hlmBadge variant="secondary">published</span>
              }
            </h2>
            <p hlmCardDescription>
              {{
                s.hasUnpublishedChanges
                  ? "The draft is ahead of what visitors see."
                  : "Everything in the draft is live."
              }}
            </p>
          </div>
          <div hlmCardContent class="grid gap-4 sm:grid-cols-3">
            <div>
              <p
                class="m-0 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground"
              >
                Last edit
              </p>
              <p class="m-0 mt-1 text-sm">{{ s.lastEdit ? formatDate(s.lastEdit) : "—" }}</p>
            </div>
            <div>
              <p
                class="m-0 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground"
              >
                Last publish
              </p>
              <p class="m-0 mt-1 text-sm">{{ s.lastPublish ? formatDate(s.lastPublish) : "—" }}</p>
            </div>
            <div>
              <p
                class="m-0 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground"
              >
                Live versions
              </p>
              <p class="m-0 mt-1 font-mono text-sm">
                @for (p of s.pointers; track p.locale; let last = $last) {
                  {{ p.locale }} v{{ p.versionId }}{{ last ? "" : " · " }}
                } @empty {
                  —
                }
              </p>
            </div>
          </div>
        </section>

        <section hlmCard aria-labelledby="i18n-title">
          <div hlmCardHeader>
            <h2 hlmCardTitle id="i18n-title" class="flex items-center gap-2 font-mono text-base">
              Translations
              @if (i18n(); as items) {
                @if (items.length) {
                  <span
                    hlmBadge
                    variant="outline"
                    class="border-accent-orange/50 text-accent-orange"
                  >
                    {{ items.length }} to check
                  </span>
                } @else {
                  <span hlmBadge variant="secondary">complete</span>
                }
              }
            </h2>
            <p hlmCardDescription>
              German left empty where English has text (or the reverse), and German last edited
              before the English changed.
            </p>
          </div>
          <div hlmCardContent>
            @if (i18n(); as items) {
              @if (!items.length) {
                <p class="m-0 text-sm text-muted-foreground">Both languages are in step.</p>
              } @else {
                <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
                  @for (item of shownI18n(); track item.kind + item.id) {
                    <li
                      class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                    >
                      <div class="min-w-0">
                        <p class="m-0 truncate text-sm">
                          {{ item.label }}
                          <span class="ml-1 font-mono text-[0.68rem] text-muted-foreground">{{
                            kindLabel(item)
                          }}</span>
                        </p>
                        <p class="m-0 mt-0.5 font-mono text-[0.72rem] text-muted-foreground">
                          {{ problemText(item) }}
                        </p>
                      </div>
                      <a hlmBtn variant="outline" size="sm" [routerLink]="link(item)">Edit</a>
                    </li>
                  }
                </ul>
                @if (items.length > preview) {
                  <button
                    hlmBtn
                    variant="ghost"
                    size="sm"
                    class="mt-2"
                    [attr.aria-expanded]="showAllI18n()"
                    (click)="showAllI18n.set(!showAllI18n())"
                  >
                    {{ showAllI18n() ? "Show fewer" : "Show all " + items.length }}
                  </button>
                }
              }
            } @else {
              <hlm-skeleton class="h-16 w-full" />
            }
          </div>
        </section>

        <section hlmCard>
          <div hlmCardHeader>
            <h2 hlmCardTitle class="font-mono text-base">Start editing</h2>
            <p hlmCardDescription>Every section is editable. Publish when you are happy.</p>
          </div>
          <div hlmCardContent class="flex flex-wrap gap-2">
            @for (link of quickLinks; track link.path) {
              <a hlmBtn variant="outline" size="sm" [routerLink]="link.path">{{ link.label }}</a>
            }
          </div>
        </section>
      } @else {
        <p class="text-sm text-muted-foreground">Could not load status.</p>
      }
    </div>

    <app-publish-dialog [(open)]="publishOpen" (published)="refresh()" />
  `,
})
export default class AdminDashboardPage implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly quickLinks = [
    { path: "/admin/hero", label: "Hero & identity" },
    { path: "/admin/about", label: "About" },
    { path: "/admin/projects", label: "Projects" },
    { path: "/admin/experience", label: "Experience" },
    { path: "/admin/writing", label: "Writing" },
    { path: "/admin/skills", label: "Skills" },
    { path: "/admin/legal", label: "Legal pages" },
    { path: "/admin/seo", label: "SEO" },
    { path: "/admin/media", label: "Media" },
    { path: "/admin/inbox", label: "Inbox" },
    { path: "/admin/publications", label: "Publications" },
  ];

  protected readonly preview = I18N_PREVIEW;
  protected readonly status = signal<AdminStatus | null>(null);
  protected readonly reconcile = signal<MediaReconcile | null>(null);
  protected readonly i18n = signal<I18nItem[] | null>(null);
  protected readonly showAllI18n = signal(false);
  protected readonly loading = signal(true);
  protected readonly publishOpen = signal(false);

  /** A draft that fails validation also counts: the review lists its problems. */
  protected readonly canReview = computed(() => this.status()?.hasUnpublishedChanges === true);

  protected readonly shownI18n = computed(() => {
    const items = this.i18n() ?? [];
    return this.showAllI18n() ? items : items.slice(0, I18N_PREVIEW);
  });

  ngOnInit(): void {
    void this.load();
    void this.loadReconcile();
    void this.loadI18n();
  }

  /** Surfaced here because a restore mismatch is invisible until an image 404s. */
  private async loadReconcile(): Promise<void> {
    const result = await this.api.mediaReconcile();
    if (result.ok) this.reconcile.set(result.data);
  }

  private async loadI18n(): Promise<void> {
    const result = await this.api.i18nStatus();
    this.i18n.set(result.ok ? result.data.items : []);
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  protected kindLabel(item: I18nItem): string {
    return KIND_LABELS[item.kind];
  }

  protected link(item: I18nItem): string {
    return editorLinkForI18n(item);
  }

  protected problemText(item: I18nItem): string {
    if (item.absent) return item.absent === "de" ? "English only" : "German only";
    const parts: string[] = [];
    if (item.missingDe.length) parts.push(`DE empty: ${item.missingDe.join(", ")}`);
    if (item.missingEn.length) parts.push(`EN empty: ${item.missingEn.join(", ")}`);
    if (item.stale) parts.push("English changed after the German was last edited");
    return parts.join(" · ");
  }

  private async load(): Promise<void> {
    const result = await this.api.status();
    this.status.set(result.ok ? result.data : null);
    this.loading.set(false);
  }

  protected async refresh(): Promise<void> {
    await this.load();
  }
}
