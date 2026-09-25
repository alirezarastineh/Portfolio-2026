import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideExternalLink } from "@ng-icons/lucide";
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from "@spartan-ng/helm/alert";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import { AdminApiService, type ApiIssue } from "../../../admin/admin-api.service";
import { editorLinkFor } from "../../../admin/editor-links";
import { PREVIEW_PREFIX } from "../../../admin/preview/preview-links";
import type { AppContent, Locale } from "../../../content/schema";

interface PageLink {
  label: string;
  path: string;
  note?: string;
}

type LocalePages =
  | { locale: Locale; ok: true; groups: { title: string; pages: PageLink[] }[] }
  | {
      locale: Locale;
      ok: false;
      error: string;
      issues: (ApiIssue & { link: string | null })[];
    };

function pagesOf(locale: Locale, content: AppContent, livePosts: Set<string>) {
  const at = (path: string) => `${PREVIEW_PREFIX}/${locale}${path}`;
  const studies = content.projects.filter((p) => p.hasCaseStudy);
  return [
    { title: "Home", pages: [{ label: "Home", path: at("") }] },
    {
      title: "Case studies",
      pages: studies.map((p) => ({ label: p.name, path: at(`/work/${p.slug}`) })),
    },
    {
      title: "Writing",
      pages: [
        { label: "All posts", path: at("/writing") },
        ...content.posts.map((p) => ({
          label: p.title,
          path: at(`/writing/${p.slug}`),
          note: livePosts.has(p.slug) ? undefined : "not published",
        })),
      ],
    },
    {
      title: "Legal",
      pages: content.legal.map((l) => ({ label: l.title, path: at(`/legal/${l.doc}`) })),
    },
  ].filter((group) => group.pages.length > 0);
}

/**
 * Opens the draft as the site itself: the real public pages, rendered from
 * what publishing would produce right now (see `preview/[locale].page.ts`).
 * Visitors still see the last published version.
 */
@Component({
  selector: "app-admin-preview",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmBadge,
    HlmButton,
    HlmSkeleton,
    NgIcon,
    RouterLink,
  ],
  viewProviders: [provideIcons({ lucideExternalLink })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">Preview draft</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            The site as the next publish would make it — the real pages, draft posts included. Each
            opens in a new tab; refresh it there after saving an edit.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button hlmBtn variant="outline" (click)="load()">Refresh</button>
        </div>
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-64 w-full" />
      } @else {
        <div class="grid gap-6 lg:grid-cols-2">
          @for (l of locales(); track l.locale) {
            <section
              class="flex flex-col gap-4 rounded-xl border border-border p-4"
              [attr.aria-labelledby]="'preview-' + l.locale"
            >
              <div class="flex items-center justify-between gap-2">
                <h2
                  [id]="'preview-' + l.locale"
                  class="m-0 font-mono text-sm uppercase tracking-[0.2em]"
                >
                  {{ l.locale === "en" ? "English" : "Deutsch" }}
                </h2>
                @if (l.ok) {
                  <a
                    hlmBtn
                    size="sm"
                    [href]="prefix + '/' + l.locale"
                    target="_blank"
                    rel="noopener"
                  >
                    Open
                    <ng-icon
                      name="lucideExternalLink"
                      size="13"
                      class="ml-1.5"
                      aria-hidden="true"
                    />
                  </a>
                }
              </div>

              @if (l.ok) {
                @for (group of l.groups; track group.title) {
                  <div>
                    <p
                      class="m-0 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground"
                    >
                      {{ group.title }}
                    </p>
                    <ul class="m-0 mt-1.5 flex list-none flex-col gap-1 p-0" role="list">
                      @for (page of group.pages; track page.path) {
                        <li class="flex items-center gap-2">
                          <a
                            class="truncate text-sm underline-offset-4 hover:underline"
                            [href]="page.path"
                            target="_blank"
                            rel="noopener"
                            >{{ page.label }}</a
                          >
                          @if (page.note) {
                            <span hlmBadge variant="outline" class="font-mono text-[0.6rem]">{{
                              page.note
                            }}</span>
                          }
                        </li>
                      }
                    </ul>
                  </div>
                }
              } @else {
                <div hlmAlert variant="destructive">
                  <h3 hlmAlertTitle>This language does not build</h3>
                  <div hlmAlertDescription>
                    @if (l.issues.length) {
                      <p class="m-0">Publishing would refuse it for the same reasons:</p>
                      <ul class="m-0 mt-2 flex list-none flex-col gap-1.5 p-0" role="list">
                        @for (issue of l.issues; track $index) {
                          <li>
                            <code class="font-mono text-[0.72rem]">{{ issue.label }}</code>
                            {{ issue.message }}
                            @if (issue.link) {
                              <a class="ml-1 underline underline-offset-4" [routerLink]="issue.link"
                                >Fix</a
                              >
                            }
                          </li>
                        }
                      </ul>
                    } @else {
                      <p class="m-0">{{ l.error }}</p>
                    }
                  </div>
                </div>
              }
            </section>
          }
        </div>
      }
    </div>
  `,
})
export default class AdminPreviewPage implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly prefix = PREVIEW_PREFIX;
  protected readonly loading = signal(true);
  protected readonly locales = signal<LocalePages[]>([]);

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    const [en, de, posts] = await Promise.all([
      this.api.preview("en"),
      this.api.preview("de"),
      this.api.listPosts(),
    ]);
    const now = Date.now();
    // Published and due: what the live site shows (the preview shows the rest too).
    const livePosts = new Set(
      posts.ok
        ? posts.data.posts
            .filter(
              (p) => p.status === "published" && p.publishedAt && Date.parse(p.publishedAt) <= now,
            )
            .map((p) => p.slug)
        : [],
    );

    this.locales.set(
      (
        [
          ["en", en],
          ["de", de],
        ] as const
      ).map(([locale, result]): LocalePages =>
        result.ok
          ? { locale, ok: true, groups: pagesOf(locale, result.data, livePosts) }
          : {
              locale,
              ok: false,
              error: result.error,
              issues: (result.issues ?? []).map((issue) => ({
                ...issue,
                link: editorLinkFor(issue),
              })),
            },
      ),
    );
    this.loading.set(false);
  }
}
