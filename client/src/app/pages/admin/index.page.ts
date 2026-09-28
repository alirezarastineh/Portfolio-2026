import { DOCUMENT, NgTemplateOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowRight } from "@ng-icons/lucide";
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from "@spartan-ng/helm/alert";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmCardImports } from "@spartan-ng/helm/card";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import {
  AdminApiService,
  type I18nItem,
  type MediaReconcile,
  type PublicationRow,
} from "../../admin/admin-api.service";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../admin/components/load-state.component";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import { ReadinessCardComponent } from "../../admin/components/readiness-card.component";
import { editorLinkForI18n } from "../../admin/editor-links";
import { AdminPulseService, type PulsePart } from "../../admin/pulse.service";
import { absoluteTime, relativeTime } from "../../admin/relative-time";

/** Shown before "show all": enough to act on without burying the rest of the page. */
const I18N_PREVIEW = 6;
/** The latest few of each, with a link to the rest. */
const RECENT = 3;

const KIND_LABELS: Record<I18nItem["kind"], string> = {
  project: "project",
  experience: "experience",
  post: "post",
  skill: "skill card",
  faq: "FAQ",
  section: "page copy",
};

/** Dollars, to the cent; a sliver of a cent still shows as spent. */
function usd(value: number): string {
  if (value > 0 && value < 0.01) return "<$0.01";
  return `$${value.toFixed(2)}`;
}

/**
 * The admin's cockpit: what is waiting to go live, new messages, how the
 * assistant is doing, translations to check (four tiles), then the launch
 * checklist, the latest publications and messages, and the translation list.
 * The numbers come from `AdminPulseService`, which the sidebar shares.
 */
@Component({
  selector: "app-admin-dashboard",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    FormSkeletonComponent,
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmBadge,
    HlmButton,
    HlmCardImports,
    HlmSkeleton,
    LoadErrorComponent,
    NgIcon,
    NgTemplateOutlet,
    ReadinessCardComponent,
    RouterLink,
  ],
  viewProviders: [provideIcons({ lucideArrowRight })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
      <app-page-header
        title="Dashboard"
        description="Edits are saved as a draft. Publishing makes them live."
      >
        <span headerStatus>
          @if (pulse.status(); as s) {
            <span
              id="draft-state"
              hlmBadge
              [variant]="s.hasUnpublishedChanges ? 'default' : 'secondary'"
              class="font-mono"
            >
              {{ s.hasUnpublishedChanges ? "unpublished changes" : "all published" }}
            </span>
          }
        </span>
        <a headerActions hlmBtn variant="outline" size="sm" routerLink="/admin/preview"
          >Preview draft</a
        >
        <button
          headerActions
          hlmBtn
          size="sm"
          [disabled]="!pulse.unpublished()"
          aria-describedby="draft-state"
          (click)="pulse.publishOpen.set(true)"
        >
          Review &amp; publish
        </button>
      </app-page-header>

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

      <section aria-labelledby="glance-title">
        <h2 id="glance-title" class="sr-only">At a glance</h2>
        <ul class="m-0 grid list-none gap-3 p-0 sm:grid-cols-2 xl:grid-cols-4" role="list">
          <!-- What publishing now would change. -->
          <li class="surface-card flex min-w-0 flex-col gap-1.5 p-4">
            <h3 class="eyebrow m-0 text-muted-foreground">Unpublished</h3>
            @if (pulse.review(); as r) {
              @if (r.issues) {
                <p class="m-0 text-h3 tabular-nums text-destructive">
                  {{ r.issues }}
                  <span class="text-sm font-normal">{{
                    r.issues === 1 ? "problem to fix" : "problems to fix"
                  }}</span>
                </p>
              } @else {
                <p class="m-0 text-h3 tabular-nums">
                  {{ r.total }}
                  <span class="text-sm font-normal text-muted-foreground">{{
                    r.total === 1 ? "change" : "changes"
                  }}</span>
                </p>
              }
              <p class="m-0 font-mono text-xs text-muted-foreground">{{ localeLine() }}</p>
            } @else if (isFailed("review")) {
              <app-load-error compact title="Could not load" (retry)="retry('review')" />
            } @else {
              <ng-container *ngTemplateOutlet="tileLoading" />
            }
            @if (pulse.status(); as s) {
              <p class="m-0 text-xs text-muted-foreground">
                Last publish
                @if (s.lastPublish; as at) {
                  <time [attr.datetime]="at" [title]="absolute(at)">{{ relative(at) }}</time>
                } @else {
                  never
                }
              </p>
            }
            @if (pulse.unpublished()) {
              <div class="mt-auto pt-1">
                <button
                  hlmBtn
                  variant="link"
                  size="sm"
                  class="h-auto gap-1 p-0 text-foreground"
                  type="button"
                  (click)="pulse.publishOpen.set(true)"
                >
                  Review changes
                  <ng-icon name="lucideArrowRight" size="14" aria-hidden="true" />
                </button>
              </div>
            }
          </li>

          <li class="surface-card flex min-w-0 flex-col gap-1.5 p-4">
            <h3 class="eyebrow m-0 text-muted-foreground">Inbox</h3>
            @if (pulse.messages(); as messages) {
              <p class="m-0 text-h3 tabular-nums">
                {{ pulse.newMessages() }}
                <span class="text-sm font-normal text-muted-foreground">new</span>
              </p>
              <p class="m-0 text-xs text-muted-foreground">
                {{ messages.length }} {{ messages.length === 1 ? "message" : "messages" }} in the
                inbox
              </p>
            } @else if (isFailed("messages")) {
              <app-load-error compact title="Could not load" (retry)="retry('messages')" />
            } @else {
              <ng-container *ngTemplateOutlet="tileLoading" />
            }
            <ng-container
              *ngTemplateOutlet="
                tileLink;
                context: { $implicit: '/admin/inbox', label: 'Open inbox' }
              "
            />
          </li>

          <li class="surface-card flex min-w-0 flex-col gap-1.5 p-4">
            <h3 class="eyebrow m-0 text-muted-foreground">Assistant · 24 h</h3>
            @if (pulse.assistant(); as h) {
              <p class="m-0 text-h3 tabular-nums">
                {{ h.last24h.answers }}
                <span class="text-sm font-normal text-muted-foreground">{{
                  h.last24h.answers === 1 ? "answer" : "answers"
                }}</span>
              </p>
              @if (spend(); as s) {
                <p class="m-0 font-mono text-xs text-muted-foreground">
                  {{ s.spent }} of {{ s.budget }} today{{ s.resting ? " · resting" : "" }}
                </p>
                <div class="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div class="h-full rounded-full bg-accent-orange" [style.width.%]="s.share"></div>
                </div>
              } @else if (assistantOff(); as reason) {
                <p class="m-0 text-xs text-muted-foreground">Off: {{ reason }}</p>
              }
              @if (pulse.assistantAlert(); as alert) {
                <p class="m-0 text-xs text-destructive">{{ alert }}</p>
              } @else {
                <p class="m-0 text-xs text-muted-foreground">No failed answers</p>
              }
            } @else if (isFailed("assistant")) {
              <app-load-error compact title="Could not load" (retry)="retry('assistant')" />
            } @else {
              <ng-container *ngTemplateOutlet="tileLoading" />
            }
            <ng-container
              *ngTemplateOutlet="
                tileLink;
                context: { $implicit: '/admin/assistant', label: 'Open assistant' }
              "
            />
          </li>

          <li class="surface-card flex min-w-0 flex-col gap-1.5 p-4">
            <h3 class="eyebrow m-0 text-muted-foreground">Translations</h3>
            @if (pulse.i18n(); as items) {
              <p class="m-0 text-h3 tabular-nums">
                {{ items.length }}
                <span class="text-sm font-normal text-muted-foreground">to check</span>
              </p>
              <p class="m-0 text-xs text-muted-foreground">
                {{ items.length ? "German and English out of step" : "Both languages in step" }}
              </p>
              @if (items.length) {
                <div class="mt-auto pt-1">
                  <button
                    hlmBtn
                    variant="link"
                    size="sm"
                    class="h-auto gap-1 p-0 text-foreground"
                    type="button"
                    (click)="showTranslations()"
                  >
                    See the list
                    <ng-icon name="lucideArrowRight" size="14" aria-hidden="true" />
                  </button>
                </div>
              }
            } @else if (isFailed("i18n")) {
              <app-load-error compact title="Could not load" (retry)="retry('i18n')" />
            } @else {
              <ng-container *ngTemplateOutlet="tileLoading" />
            }
          </li>
        </ul>
      </section>

      <!-- While the site still shows placeholder content, nothing below matters as much. -->
      <app-readiness-card />

      <div class="grid gap-6 lg:grid-cols-2">
        <section hlmCard aria-labelledby="publications-title">
          <div hlmCardHeader>
            <h2 hlmCardTitle id="publications-title">Recent publications</h2>
            <p hlmCardDescription>
              @if (pulse.status()?.pointers?.length) {
                Live:
                <span class="font-mono">{{ liveVersions() }}</span>
              } @else {
                Nothing is live yet.
              }
            </p>
            <a
              hlmCardAction
              hlmBtn
              variant="ghost"
              size="sm"
              routerLink="/admin/publications"
              class="gap-1"
            >
              All <span class="sr-only">publications</span>
              <ng-icon name="lucideArrowRight" size="14" aria-hidden="true" />
            </a>
          </div>
          <div hlmCardContent>
            @if (publications(); as rows) {
              @if (rows.length) {
                <ol class="m-0 flex list-none flex-col divide-y divide-border p-0" role="list">
                  @for (row of rows; track row.id) {
                    <li class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span class="font-mono text-xs text-muted-foreground">#{{ row.id }}</span>
                      <span class="min-w-0 flex-1 truncate text-sm">{{ labelOf(row) }}</span>
                      @if (row.live) {
                        <span hlmBadge variant="secondary" class="font-mono">live</span>
                      }
                      <time
                        class="shrink-0 font-mono text-xs text-muted-foreground"
                        [attr.datetime]="row.createdAt"
                        [title]="absolute(row.createdAt)"
                        >{{ relative(row.createdAt) }}</time
                      >
                    </li>
                  }
                </ol>
              } @else {
                <p class="m-0 text-sm text-muted-foreground">Nothing published yet.</p>
              }
            } @else if (publicationsFailed()) {
              <app-load-error
                compact
                title="Could not load the publications"
                (retry)="loadPublications()"
              />
            } @else {
              <app-form-skeleton kind="list" [rows]="3" label="Loading publications…" />
            }
          </div>
        </section>

        <section hlmCard aria-labelledby="messages-title">
          <div hlmCardHeader>
            <h2 hlmCardTitle id="messages-title">Latest messages</h2>
            <p hlmCardDescription>From the contact form, newest first.</p>
            <a
              hlmCardAction
              hlmBtn
              variant="ghost"
              size="sm"
              routerLink="/admin/inbox"
              class="gap-1"
            >
              Inbox
              <ng-icon name="lucideArrowRight" size="14" aria-hidden="true" />
            </a>
          </div>
          <div hlmCardContent>
            @if (pulse.messages(); as messages) {
              @if (messages.length) {
                <ol class="m-0 flex list-none flex-col divide-y divide-border p-0" role="list">
                  @for (m of latestMessages(); track m.id) {
                    <li class="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
                      <div class="flex items-center gap-2">
                        @if (m.status === "new") {
                          <span
                            class="size-1.5 shrink-0 rounded-full bg-accent-orange"
                            aria-hidden="true"
                          ></span>
                          <span class="sr-only">New:</span>
                        }
                        <span
                          class="min-w-0 flex-1 truncate text-sm"
                          [class.font-medium]="m.status === 'new'"
                          >{{ m.name }}</span
                        >
                        <time
                          class="shrink-0 font-mono text-xs text-muted-foreground"
                          [attr.datetime]="m.createdAt"
                          [title]="absolute(m.createdAt)"
                          >{{ relative(m.createdAt) }}</time
                        >
                      </div>
                      <p class="m-0 line-clamp-1 text-xs text-muted-foreground">{{ m.message }}</p>
                    </li>
                  }
                </ol>
              } @else {
                <p class="m-0 text-sm text-muted-foreground">No messages yet.</p>
              }
            } @else if (isFailed("messages")) {
              <app-load-error
                compact
                title="Could not load the inbox"
                (retry)="retry('messages')"
              />
            } @else {
              <app-form-skeleton kind="list" [rows]="3" label="Loading messages…" />
            }
          </div>
        </section>
      </div>

      <section hlmCard id="translations" aria-labelledby="i18n-title">
        <div hlmCardHeader>
          <h2
            hlmCardTitle
            id="i18n-title"
            tabindex="-1"
            class="flex items-center gap-2 outline-none"
          >
            Translations
            @if (pulse.i18n(); as items) {
              @if (items.length) {
                <span
                  hlmBadge
                  variant="outline"
                  class="border-accent-orange/50 font-mono text-accent-orange"
                >
                  {{ items.length }} to check
                </span>
              } @else {
                <span hlmBadge variant="secondary" class="font-mono">complete</span>
              }
            }
          </h2>
          <p hlmCardDescription>
            German left empty where English has text (or the reverse), and German last edited before
            the English changed.
          </p>
        </div>
        <div hlmCardContent>
          @if (pulse.i18n(); as items) {
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
                        <span class="ml-1 font-mono text-xs text-muted-foreground">{{
                          kindLabel(item)
                        }}</span>
                      </p>
                      <p class="m-0 mt-0.5 font-mono text-xs text-muted-foreground">
                        {{ problemText(item) }}
                      </p>
                    </div>
                    <a hlmBtn variant="outline" size="sm" [routerLink]="link(item)"
                      >Edit<span class="sr-only">: {{ item.label }}</span></a
                    >
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
          } @else if (isFailed("i18n")) {
            <app-load-error
              compact
              title="Could not load the translations"
              (retry)="retry('i18n')"
            />
          } @else {
            <app-form-skeleton kind="list" [rows]="2" label="Loading translations…" />
          }
        </div>
      </section>
    </div>

    <ng-template #tileLoading>
      <div class="flex flex-col gap-2 py-1" role="status">
        <span class="sr-only">Loading…</span>
        <hlm-skeleton class="h-7 w-16" />
        <hlm-skeleton class="h-3 w-28" />
      </div>
    </ng-template>

    <ng-template #tileLink let-path let-label="label">
      <div class="mt-auto pt-1">
        <a
          hlmBtn
          variant="link"
          size="sm"
          class="h-auto gap-1 p-0 text-foreground"
          [routerLink]="path"
        >
          {{ label }}
          <ng-icon name="lucideArrowRight" size="14" aria-hidden="true" />
        </a>
      </div>
    </ng-template>
  `,
})
export default class AdminDashboardPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly doc = inject(DOCUMENT);
  protected readonly pulse = inject(AdminPulseService);

  protected readonly preview = I18N_PREVIEW;
  protected readonly reconcile = signal<MediaReconcile | null>(null);
  protected readonly publications = signal<PublicationRow[] | null>(null);
  protected readonly publicationsFailed = signal(false);
  protected readonly showAllI18n = signal(false);

  protected readonly shownI18n = computed(() => {
    const items = this.pulse.i18n() ?? [];
    return this.showAllI18n() ? items : items.slice(0, I18N_PREVIEW);
  });

  protected readonly latestMessages = computed(() =>
    (this.pulse.messages() ?? []).slice(0, RECENT),
  );

  /** Per language: "EN 3 · DE 2 to fix". */
  protected readonly localeLine = computed(() =>
    (this.pulse.review()?.locales ?? [])
      .map((l) => {
        const detail = l.issues ? `${l.issues} to fix` : l.changes;
        return `${l.locale.toUpperCase()} ${detail}`;
      })
      .join(" · "),
  );

  protected readonly liveVersions = computed(() =>
    (this.pulse.status()?.pointers ?? [])
      .map((p) => `${p.locale.toUpperCase()} v${p.versionId}`)
      .join(" · "),
  );

  /** Today's spend against the cap, while the assistant is on. */
  protected readonly spend = computed(() => {
    const state = this.pulse.assistant()?.state;
    if (!state || state.state === "off") return null;
    return {
      spent: usd(state.spentUsd),
      budget: usd(state.budgetUsd),
      share: state.budgetUsd ? Math.min(100, (state.spentUsd / state.budgetUsd) * 100) : 0,
      resting: state.state === "resting",
    };
  });

  protected readonly assistantOff = computed(() => {
    const state = this.pulse.assistant()?.state;
    return state?.state === "off" ? state.reason : null;
  });

  constructor() {
    // A publish from the dialog adds a row here.
    effect(() => {
      if (this.pulse.publishes() > 0) untracked(() => void this.loadPublications());
    });
  }

  ngOnInit(): void {
    void this.pulse.refreshIfStale();
    void this.loadPublications();
    void this.loadReconcile();
  }

  protected isFailed(part: PulsePart): boolean {
    return this.pulse.failed().has(part);
  }

  protected retry(part: PulsePart): void {
    void this.pulse.refresh([part]);
  }

  protected async loadPublications(): Promise<void> {
    this.publicationsFailed.set(false);
    const result = await this.api.publications();
    if (result.ok) this.publications.set(result.data.publications.slice(0, RECENT));
    else this.publicationsFailed.set(this.publications() === null);
  }

  /** Surfaced here because a restore mismatch is invisible until an image 404s. */
  private async loadReconcile(): Promise<void> {
    const result = await this.api.mediaReconcile();
    if (result.ok) this.reconcile.set(result.data);
  }

  protected showTranslations(): void {
    const heading = this.doc.getElementById("i18n-title");
    const still =
      this.doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ?? true;
    heading?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    heading?.focus({ preventScroll: true });
  }

  protected relative(iso: string): string {
    return relativeTime(iso);
  }

  protected absolute(iso: string): string {
    return absoluteTime(iso);
  }

  protected labelOf(row: PublicationRow): string {
    return row.label || (row.kind === "rollback" ? "Rollback" : "Unlabelled");
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
}
