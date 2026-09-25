import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { RouterLink } from "@angular/router";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import {
  HlmCard,
  HlmCardContent,
  HlmCardDescription,
  HlmCardHeader,
  HlmCardTitle,
} from "@spartan-ng/helm/card";
import { HlmProgressImports } from "@spartan-ng/helm/progress";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import { LOCALES } from "../../content/locale";
import type { AppContent, Locale } from "../../content/schema";
import { AdminApiService } from "../admin-api.service";
import {
  checkReadiness,
  type ReadinessCheck,
  type ReadinessReport,
  type ReadinessSeverity,
} from "../readiness";

/** Places listed per check before "show all". */
const HIT_PREVIEW = 4;

const SEVERITY_LABEL: Record<ReadinessSeverity, string> = {
  blocker: "fix before sharing",
  warn: "worth fixing",
  tip: "nice to have",
};

const SEVERITY_DOT: Record<ReadinessSeverity, string> = {
  blocker: "bg-destructive",
  warn: "bg-accent-orange",
  tip: "bg-muted-foreground",
};

const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };

/**
 * The dashboard's launch checklist: what still makes the site look
 * unfinished, found in the draft of both languages (see `admin/readiness.ts`),
 * each with a link to the editor that fixes it. Advice only — the publish
 * review is what stops a broken draft.
 */
@Component({
  selector: "app-readiness-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmBadge,
    HlmButton,
    HlmCard,
    HlmCardContent,
    HlmCardDescription,
    HlmCardHeader,
    HlmCardTitle,
    HlmProgressImports,
    HlmSkeleton,
    NgTemplateOutlet,
    RouterLink,
  ],
  host: { class: "block" },
  template: `
    <section hlmCard aria-labelledby="readiness-title">
      <div hlmCardHeader>
        <h2
          hlmCardTitle
          id="readiness-title"
          class="flex flex-wrap items-center gap-2 font-mono text-base"
        >
          Launch readiness
          @if (report(); as r) {
            <span hlmBadge [variant]="badgeVariant()" class="font-mono">
              {{ r.passed }} / {{ r.total }} ready
            </span>
          }
        </h2>
        <p hlmCardDescription>
          What still makes the site look unfinished to a visitor, checked in the draft of both
          languages. Advice only: publishing never waits for it.
        </p>
      </div>

      <div hlmCardContent class="flex flex-col gap-4">
        @if (loading()) {
          <hlm-skeleton class="h-32 w-full" />
        } @else if (report(); as r) {
          <hlm-progress [value]="percent()" aria-label="Readiness checks passed">
            <hlm-progress-indicator />
          </hlm-progress>

          @if (skipped().length) {
            <p class="m-0 text-[0.78rem] text-muted-foreground">
              The {{ skippedNames() }} draft does not build, so it was not checked. Review &amp;
              publish lists what stops it.
            </p>
          }

          @if (urgent().length) {
            <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
              @for (check of urgent(); track check.id) {
                <ng-container *ngTemplateOutlet="row; context: { $implicit: check }" />
              }
            </ul>
          }

          <!-- Folded while anything more urgent is open, so the list leads with what matters. -->
          @if (tips().length) {
            <details [open]="!urgent().length">
              <summary class="cursor-pointer font-mono text-[0.72rem] text-muted-foreground">
                {{ tips().length }} nice to have
              </summary>
              <ul class="m-0 mt-2 flex list-none flex-col gap-2 p-0" role="list">
                @for (check of tips(); track check.id) {
                  <ng-container *ngTemplateOutlet="row; context: { $implicit: check }" />
                }
              </ul>
            </details>
          }

          @if (!failing().length) {
            <p class="m-0 text-sm">
              Nothing left: the site reads as finished in {{ checkedNames() }}.
            </p>
          }

          <ng-template #row let-check>
            <li
              class="rounded-lg border px-3 py-2.5"
              [class.border-destructive/50]="check.severity === 'blocker'"
              [class.border-border]="check.severity !== 'blocker'"
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span
                      class="size-2 shrink-0 rounded-full"
                      [class]="dotOf(check)"
                      aria-hidden="true"
                    ></span>
                    <span class="font-medium">{{ check.title }}</span>
                    @if (check.listsPlaces) {
                      <span hlmBadge variant="outline" class="font-mono text-[0.62rem]">
                        {{ check.hits.length }}
                      </span>
                    }
                    <span class="font-mono text-[0.68rem] text-muted-foreground">
                      {{ severityOf(check) }}{{ onlyIn(check) }}
                    </span>
                  </p>
                  <p class="m-0 mt-0.5 text-[0.78rem] text-muted-foreground">
                    {{ check.why }}
                  </p>
                </div>
                <a hlmBtn variant="outline" size="sm" [routerLink]="fixLink(check)"
                  >Fix<span class="sr-only">: {{ check.title }}</span></a
                >
              </div>

              @if (check.listsPlaces) {
                <ul
                  class="m-0 mt-2 flex list-none flex-col gap-1.5 border-t border-border p-0 pt-2"
                  role="list"
                >
                  @for (hit of shownHits(check); track hit.label) {
                    <li class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[0.78rem]">
                      <code class="font-mono text-[0.7rem] break-all text-foreground">{{
                        hit.label
                      }}</code>
                      <span
                        class="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground"
                        >{{ hit.locales.join(" · ") }}</span
                      >
                      @if (hit.detail) {
                        <span class="min-w-0 wrap-break-word text-muted-foreground">{{
                          hit.detail
                        }}</span>
                      }
                      @if (hit.link) {
                        <a
                          class="ml-auto shrink-0 underline underline-offset-4 hover:text-accent-orange"
                          [routerLink]="hit.link"
                          >Edit<span class="sr-only"> {{ hit.label }}</span></a
                        >
                      }
                    </li>
                  }
                </ul>
                @if (check.hits.length > preview) {
                  <button
                    hlmBtn
                    variant="ghost"
                    size="sm"
                    type="button"
                    class="mt-1 h-7 px-2 font-mono text-[0.72rem]"
                    [attr.aria-expanded]="isExpanded(check)"
                    (click)="toggle(check)"
                  >
                    {{ isExpanded(check) ? "Show fewer" : "Show all " + check.hits.length }}
                  </button>
                }
              }
            </li>
          </ng-template>

          @if (passing().length) {
            <details>
              <summary class="cursor-pointer font-mono text-[0.72rem] text-muted-foreground">
                {{ passing().length }} passing
              </summary>
              <ul class="m-0 mt-2 flex list-none flex-col gap-1 p-0" role="list">
                @for (check of passing(); track check.id) {
                  <li class="flex items-center gap-2 text-[0.78rem] text-muted-foreground">
                    <span class="text-available" aria-hidden="true">✓</span>{{ check.title }}
                  </li>
                }
              </ul>
            </details>
          }
        } @else {
          <div class="flex flex-wrap items-center gap-3">
            <p class="m-0 text-sm text-muted-foreground">Could not check the draft.</p>
            <button hlmBtn variant="outline" size="sm" type="button" (click)="load()">
              Try again
            </button>
          </div>
        }
      </div>
    </section>
  `,
})
export class ReadinessCardComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly preview = HIT_PREVIEW;

  protected readonly loading = signal(true);
  protected readonly report = signal<ReadinessReport | null>(null);
  /** Languages whose draft does not build, so were not checked. */
  protected readonly skipped = signal<Locale[]>([]);
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  protected readonly failing = computed(() => this.report()?.checks.filter((c) => !c.passed) ?? []);
  protected readonly urgent = computed(() => this.failing().filter((c) => c.severity !== "tip"));
  protected readonly tips = computed(() => this.failing().filter((c) => c.severity === "tip"));
  protected readonly passing = computed(() => this.report()?.checks.filter((c) => c.passed) ?? []);

  protected readonly percent = computed(() => {
    const r = this.report();
    return r ? Math.round((r.passed / r.total) * 100) : 0;
  });

  protected readonly badgeVariant = computed(() => {
    const failing = this.failing();
    if (failing.some((c) => c.severity === "blocker")) return "destructive";
    return failing.length ? "outline" : "secondary";
  });

  protected readonly skippedNames = computed(() => names(this.skipped()));
  protected readonly checkedNames = computed(() => names(this.report()?.locales ?? []));

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const results = await Promise.all(LOCALES.map((locale) => this.api.preview(locale)));

    const drafts: Partial<Record<Locale, AppContent>> = {};
    const skipped: Locale[] = [];
    let unreachable = false;
    results.forEach((result, i) => {
      const locale = LOCALES[i]!;
      if (result.ok) drafts[locale] = result.data;
      // 422 is a draft that does not build; anything else, no usable answer.
      else if (result.status === 422) skipped.push(locale);
      else unreachable = true;
    });

    const checkable = Object.keys(drafts).length > 0 && !unreachable;
    this.report.set(checkable ? checkReadiness(drafts) : null);
    this.skipped.set(checkable ? skipped : []);
    this.loading.set(false);
  }

  protected shownHits(check: ReadinessCheck) {
    return this.isExpanded(check) ? check.hits : check.hits.slice(0, HIT_PREVIEW);
  }

  protected isExpanded(check: ReadinessCheck): boolean {
    return this.expanded().has(check.id);
  }

  protected toggle(check: ReadinessCheck): void {
    const next = new Set(this.expanded());
    if (next.has(check.id)) next.delete(check.id);
    else next.add(check.id);
    this.expanded.set(next);
  }

  // Methods rather than lookups in the template: a row's `check` comes from
  // an ng-template context, which strict templates cannot type.
  protected severityOf(check: ReadinessCheck): string {
    return SEVERITY_LABEL[check.severity];
  }

  protected dotOf(check: ReadinessCheck): string {
    return SEVERITY_DOT[check.severity];
  }

  /** The first place's editor: fixing starts there. */
  protected fixLink(check: ReadinessCheck): string {
    return check.hits[0]?.link ?? check.link;
  }

  /** " · German only" when a check fails in one of the languages checked, not all. */
  protected onlyIn(check: ReadinessCheck): string {
    const checked = this.report()?.locales ?? [];
    const failing = new Set(check.hits.flatMap((hit) => hit.locales));
    if (checked.length < 2 || failing.size !== 1) return "";
    const [locale] = failing;
    return ` · ${LANGUAGE[locale!]} only`;
  }
}

function names(locales: readonly Locale[]): string {
  return locales.map((locale) => LANGUAGE[locale]).join(" and ");
}
