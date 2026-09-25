import { NgTemplateOutlet } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
  untracked,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDialogImports } from "@spartan-ng/helm/dialog";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSpinner } from "@spartan-ng/helm/spinner";

import {
  AdminApiService,
  type DraftIssue,
  type LocaleReview,
  type PublishReview,
} from "../admin-api.service";
import { editorLinkFor } from "../editor-links";
import { diffJson, type DiffEntry } from "../json-diff";
import { findPlaceholders, type ReadinessHit } from "../readiness";
import type { Locale } from "../../content/schema";

/** Long values (a case-study body) are shown clipped: the diff says what changed, not all of it. */
const CLIP = 400;

/** Placeholder fields named in the warning; the dashboard's checklist lists them all. */
const PLACEHOLDER_PREVIEW = 5;

interface LocaleView {
  locale: Locale;
  issues: (DraftIssue & { link: string | null })[];
  changed: boolean;
  firstPublish: boolean;
  core: DiffEntry[];
  docs: { key: string; change: string; entries: DiffEntry[] }[];
  /** "TODO" copy the draft would put live: a warning, never a block. */
  placeholders: ReadinessHit[];
}

function clip(value: string | undefined): string | undefined {
  return value !== undefined && value.length > CLIP ? `${value.slice(0, CLIP)}…` : value;
}

function clipped(entries: DiffEntry[]): DiffEntry[] {
  return entries.map((e) => ({ ...e, before: clip(e.before), after: clip(e.after) }));
}

function toView(review: LocaleReview): LocaleView {
  return {
    locale: review.locale,
    issues: review.issues.map((issue) => ({ ...issue, link: editorLinkFor(issue) })),
    changed: review.changed,
    firstPublish: review.live === null,
    core: review.draft ? clipped(diffJson(review.live ?? {}, review.draft)) : [],
    docs: review.docs.map((doc) => ({
      key: doc.key,
      change: doc.change,
      entries: doc.change === "changed" ? clipped(diffJson(doc.live, doc.draft)) : [],
    })),
    placeholders: review.draft ? findPlaceholders(review.draft) : [],
  };
}

/**
 * Publishing, reviewed first: what visitors will see change in each language
 * (the draft against what is live, field by field), or — when the draft
 * cannot be published — every problem in both languages, each with a link to
 * the editor that fixes it.
 */
@Component({
  selector: "app-publish-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmBadge,
    HlmButton,
    HlmDialogImports,
    HlmInput,
    HlmSkeleton,
    HlmSpinner,
    NgTemplateOutlet,
    RouterLink,
  ],
  template: `
    <hlm-dialog [state]="open() ? 'open' : 'closed'" (stateChanged)="onState($event)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-3xl">
        <hlm-dialog-header>
          <h2 hlmDialogTitle>Review and publish</h2>
          <p hlmDialogDescription>
            What visitors will see change, in both languages. Nothing goes live until you press
            Publish.
          </p>
        </hlm-dialog-header>

        @if (loading()) {
          <hlm-skeleton class="h-48 w-full" />
        } @else if (views(); as locales) {
          <div class="flex max-h-[60vh] min-w-0 flex-col gap-6 overflow-y-auto pr-1">
            @for (l of locales; track l.locale) {
              <section
                class="flex min-w-0 flex-col gap-3"
                [attr.aria-labelledby]="'review-' + l.locale"
              >
                <h3
                  [id]="'review-' + l.locale"
                  class="m-0 flex items-center gap-2 font-mono text-sm uppercase tracking-[0.2em]"
                >
                  {{ l.locale }}
                  @if (l.issues.length) {
                    <span
                      hlmBadge
                      variant="destructive"
                      class="font-mono text-[0.62rem] normal-case"
                    >
                      {{ l.issues.length }} {{ l.issues.length === 1 ? "problem" : "problems" }}
                    </span>
                  } @else if (!l.changed) {
                    <span hlmBadge variant="secondary" class="font-mono text-[0.62rem] normal-case">
                      no changes
                    </span>
                  } @else {
                    <span hlmBadge variant="default" class="font-mono text-[0.62rem] normal-case">
                      {{ changeCount(l) }} {{ changeCount(l) === 1 ? "change" : "changes" }}
                    </span>
                  }
                </h3>

                @if (!l.issues.length && l.placeholders.length) {
                  <div
                    class="rounded-lg border border-accent-orange/50 bg-accent-orange/10 px-3 py-2"
                    role="note"
                  >
                    <p class="m-0 text-[0.8rem]">
                      <strong class="font-medium">Visitors will see placeholder text</strong>
                      in {{ l.placeholders.length }}
                      {{ l.placeholders.length === 1 ? "field" : "fields" }}. Publishing is still
                      allowed.
                    </p>
                    <ul class="m-0 mt-1.5 flex list-none flex-col gap-1 p-0" role="list">
                      @for (hit of l.placeholders.slice(0, placeholderPreview); track hit.label) {
                        <li class="flex flex-wrap items-baseline gap-x-2">
                          <code class="font-mono text-[0.72rem] break-all">{{ hit.label }}</code>
                          @if (hit.link) {
                            <a
                              class="text-[0.78rem] underline underline-offset-4"
                              [routerLink]="hit.link"
                              (click)="open.set(false)"
                              >Fix<span class="sr-only"> {{ hit.label }}</span></a
                            >
                          }
                        </li>
                      }
                    </ul>
                    @if (l.placeholders.length > placeholderPreview) {
                      <p class="m-0 mt-1 text-[0.72rem] text-muted-foreground">
                        and {{ l.placeholders.length - placeholderPreview }} more: the dashboard's
                        launch checklist lists them all.
                      </p>
                    }
                  </div>
                }

                @if (l.issues.length) {
                  <p class="m-0 text-[0.8rem] text-muted-foreground">
                    This language cannot be published until these are fixed:
                  </p>
                  <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
                    @for (issue of l.issues; track $index) {
                      <li
                        class="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-destructive/40 px-3 py-2"
                      >
                        <span class="min-w-0">
                          <code class="font-mono text-[0.72rem] break-all">{{ issue.label }}</code>
                          <span class="ml-2 text-[0.8rem]">{{ issue.message }}</span>
                        </span>
                        @if (issue.link) {
                          <a
                            hlmBtn
                            variant="outline"
                            size="sm"
                            class="h-7"
                            [routerLink]="issue.link"
                            (click)="open.set(false)"
                            >Fix</a
                          >
                        }
                      </li>
                    }
                  </ul>
                } @else if (l.changed) {
                  @if (l.firstPublish) {
                    <p class="m-0 text-[0.8rem] text-muted-foreground">
                      Nothing is live in this language yet: everything is new.
                    </p>
                  }
                  <ol class="m-0 flex list-none flex-col gap-2 p-0">
                    @for (entry of l.core; track entry.path) {
                      <li class="rounded-lg border border-border p-3">
                        <ng-container
                          *ngTemplateOutlet="diffEntry; context: { $implicit: entry }"
                        />
                      </li>
                    }
                    @for (doc of l.docs; track doc.key) {
                      <li class="rounded-lg border border-border p-3">
                        <div class="flex items-start justify-between gap-2">
                          <code class="font-mono text-[0.72rem] break-all">{{ doc.key }}</code>
                          <span
                            hlmBadge
                            variant="outline"
                            class="shrink-0 font-mono text-[0.62rem]"
                          >
                            page {{ doc.change }}
                          </span>
                        </div>
                        @if (doc.entries.length) {
                          <ol class="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                            @for (entry of doc.entries; track entry.path) {
                              <li class="border-t border-border pt-2">
                                <ng-container
                                  *ngTemplateOutlet="diffEntry; context: { $implicit: entry }"
                                />
                              </li>
                            }
                          </ol>
                        }
                      </li>
                    }
                  </ol>
                }
              </section>
            }
          </div>

          <hlm-dialog-footer class="flex-wrap items-center gap-2">
            <!-- Optional; shown in Publications, so a rollback target is easy to find later. -->
            <input
              #labelInput
              hlmInput
              class="h-9 min-w-0 flex-1 sm:w-64 sm:flex-none"
              maxlength="200"
              placeholder="What changed? (optional)"
              aria-label="Label for this publish"
              [value]="label()"
              (input)="label.set(labelInput.value)"
              (keydown.enter)="canPublish() && publish()"
            />
            <button hlmBtn variant="ghost" type="button" (click)="open.set(false)">Cancel</button>
            <button
              hlmBtn
              type="button"
              [disabled]="!canPublish() || publishing()"
              (click)="publish()"
            >
              @if (publishing()) {
                <hlm-spinner class="size-4" />
              } @else {
                Publish both languages
              }
            </button>
          </hlm-dialog-footer>
        } @else {
          <p class="m-0 text-sm text-muted-foreground">Could not load the review.</p>
        }

        <ng-template #diffEntry let-entry>
          <div class="mb-1.5 flex items-start justify-between gap-2">
            <code class="font-mono text-[0.72rem] break-all text-foreground">{{ entry.path }}</code>
            <span hlmBadge variant="outline" class="shrink-0 font-mono text-[0.62rem]">{{
              entry.kind
            }}</span>
          </div>
          <dl class="m-0 grid gap-1 text-[0.78rem] leading-relaxed">
            @if (entry.before !== undefined) {
              <div class="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
                <dt class="font-mono text-[0.66rem] uppercase tracking-wider text-destructive">
                  live
                </dt>
                <dd class="m-0 whitespace-pre-wrap wrap-break-word text-muted-foreground">
                  {{ entry.before }}
                </dd>
              </div>
            }
            @if (entry.after !== undefined) {
              <div class="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
                <dt class="font-mono text-[0.66rem] uppercase tracking-wider text-accent-indigo">
                  draft
                </dt>
                <dd class="m-0 whitespace-pre-wrap wrap-break-word text-foreground">
                  {{ entry.after }}
                </dd>
              </div>
            }
          </dl>
        </ng-template>
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class PublishDialogComponent {
  private readonly api = inject(AdminApiService);

  protected readonly placeholderPreview = PLACEHOLDER_PREVIEW;

  readonly open = model(false);
  /** After a publish that wrote something. */
  readonly published = output<void>();

  protected readonly loading = signal(false);
  protected readonly publishing = signal(false);
  protected readonly label = signal("");
  private readonly review = signal<PublishReview | null>(null);

  protected readonly views = computed(() => this.review()?.locales.map(toView) ?? null);
  protected readonly canPublish = computed(() => this.review()?.canPublish === true);

  constructor() {
    // A fresh review every time it opens: the draft may have changed since.
    effect(() => {
      if (this.open()) untracked(() => void this.load());
    });
  }

  protected changeCount(view: LocaleView): number {
    return view.core.filter((e) => !e.path.endsWith("(order)")).length + view.docs.length;
  }

  protected onState(state: string): void {
    if (state === "closed") this.open.set(false);
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const result = await this.api.publishReview();
    this.loading.set(false);
    this.review.set(result.ok ? result.data : null);
    if (!result.ok) toast.error("Could not load the review", { description: result.error });
  }

  protected async publish(): Promise<void> {
    if (this.publishing() || !this.canPublish()) return;
    this.publishing.set(true);
    const result = await this.api.publish(this.label().trim() || undefined);
    this.publishing.set(false);

    if (!result.ok) {
      const detail = result.detail as
        { locales?: { locale: Locale; issues: DraftIssue[] }[] } | undefined;
      if (result.error === "invalid_draft" && detail?.locales) {
        // Someone saved something invalid since the review loaded: show it here.
        this.review.update((r) =>
          r
            ? {
                canPublish: false,
                locales: r.locales.map((l) => {
                  const failed = detail.locales?.find((f) => f.locale === l.locale);
                  return failed ? { ...l, issues: failed.issues, draft: null, docs: [] } : l;
                }),
              }
            : r,
        );
        toast.error("Not published", { description: "The draft has problems; see the list." });
      } else {
        toast.error("Publish failed", { description: result.error });
      }
      return;
    }

    if (result.data.unchanged) {
      toast.info("Nothing to publish", {
        description: "The draft already matches what is live, so no new revision was made.",
      });
    } else {
      const versions = result.data.published.map((p) => `${p.locale} v${p.versionId}`).join(", ");
      toast.success("Published", { description: versions });
      this.published.emit();
    }
    this.label.set("");
    this.open.set(false);
  }
}
