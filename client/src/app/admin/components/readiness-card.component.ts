import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { RouterLink } from "@angular/router";

import { LOCALES } from "../../content/locale";
import type { AppContent, Locale } from "../../content/schema";
import { AdminApiService, type I18nItem } from "../admin-api.service";
import { editorLinkForI18n } from "../editor-links";
import { AdminPulseService } from "../pulse.service";
import {
  checkReadiness,
  type ReadinessCheck,
  type ReadinessReport,
  type ReadinessSeverity,
} from "../readiness";
import { TODAY_ROW } from "../today";

const SEVERITY_LABEL: Record<ReadinessSeverity, string> = {
  blocker: "fix before sharing",
  warn: "worth fixing",
  tip: "nice to have",
};

const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };

const KIND_LABELS: Record<I18nItem["kind"], string> = {
  project: "project",
  experience: "experience",
  post: "post",
  skill: "skill card",
  faq: "FAQ",
  section: "page copy",
};

/**
 * Today's "Before launch": what still makes the site look unfinished, found in the draft of
 * both languages (`admin/readiness.ts`), a row per failing rule with its editor, worst first;
 * then the translations to check, in the rail's words. Advice only: publishing never waits.
 */
@Component({
  selector: "app-readiness-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-2" aria-labelledby="launch-title">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id="launch-title" class="m-0 text-section-title">Before launch</h2>
        @if (report(); as r) {
          <p class="m-0 text-hint text-muted-foreground">{{ r.passed }} of {{ r.total }} ready</p>
        } @else if (loading()) {
          <p class="m-0 text-hint text-muted-foreground">Checking the draft…</p>
        }
      </div>
      @if (skipped().length) {
        <p class="m-0 text-hint text-muted-foreground">
          The {{ skippedNames() }} draft does not build, so it was not checked. The publish review
          lists what stops it.
        </p>
      }

      <ul class="m-0 -ml-3 list-none border-t border-border p-0" role="list">
        @if (!loading() && !report()) {
          <li>
            <button type="button" [class]="row" (click)="load()">
              <span>Could not check the draft.</span>&ngsp;<span></span>&ngsp;<span
                class="text-right font-medium max-sm:col-start-2 max-sm:row-start-1"
                >Try again</span
              >
            </button>
          </li>
        }
        @for (check of failing(); track check.id) {
          <li>
            <a [class]="row" [routerLink]="fixLink(check)">
              <span class="min-w-0 wrap-anywhere">{{ words(check) }}</span
              >&ngsp;<span
                class="text-hint text-muted-foreground max-sm:col-start-1 max-sm:row-start-2"
                >{{ severityOf(check) }}</span
              >&ngsp;<span
                class="text-right font-medium max-sm:col-start-2 max-sm:row-span-2 max-sm:row-start-1"
                >Fix</span
              >
            </a>
          </li>
        }
        @if (translations().length; as n) {
          <li>
            <button
              type="button"
              [class]="row"
              aria-controls="launch-translations"
              [attr.aria-expanded]="showTranslations()"
              (click)="showTranslations.set(!showTranslations())"
            >
              <span>{{ n }} {{ n === 1 ? "translation" : "translations" }} to check</span
              >&ngsp;<span></span>&ngsp;<span
                class="text-right font-medium max-sm:col-start-2 max-sm:row-start-1"
                >{{ showTranslations() ? "Hide" : "Show" }}</span
              >
            </button>
            <ul id="launch-translations" class="m-0 list-none py-0 pr-0 pl-5" role="list">
              @if (showTranslations()) {
                @for (item of translations(); track item.kind + item.id) {
                  <li>
                    <a [class]="row" [routerLink]="link(item)">
                      <span class="min-w-0 wrap-anywhere"
                        >{{ item.label }}, {{ kindLabel(item) }}: {{ problemText(item) }}</span
                      >&ngsp;<span></span>&ngsp;<span
                        class="text-right font-medium max-sm:col-start-2 max-sm:row-start-1"
                        >Edit</span
                      >
                    </a>
                  </li>
                }
              }
            </ul>
          </li>
        }
      </ul>
      @if (report() && !failing().length) {
        <p class="m-0 text-sm">Nothing left: the site reads as finished in {{ checkedNames() }}.</p>
      }
    </section>
  `,
})
export class ReadinessCardComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly pulse = inject(AdminPulseService);

  protected readonly row = TODAY_ROW;
  protected readonly loading = signal(true);
  protected readonly report = signal<ReadinessReport | null>(null);
  /** Languages whose draft does not build, so were not checked. */
  protected readonly skipped = signal<Locale[]>([]);
  protected readonly showTranslations = signal(false);

  /** Worst first: `checkReadiness` sorts the failing ahead, by severity. */
  protected readonly failing = computed(() => this.report()?.checks.filter((c) => !c.passed) ?? []);
  /** The rail counts the same list on Today: the two say one number. */
  protected readonly translations = computed(() => this.pulse.i18n() ?? []);

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

  // Methods rather than lookups in the template, as each row's `check` is typed there.
  protected severityOf(check: ReadinessCheck): string {
    return SEVERITY_LABEL[check.severity];
  }

  /** "Placeholder text (5)", "No CV, German only". */
  protected words(check: ReadinessCheck): string {
    const places = check.listsPlaces ? ` (${check.hits.length})` : "";
    return `${check.title}${places}${this.onlyIn(check)}`;
  }

  /** The first place's editor: fixing starts there, and the next Fix goes to the next. */
  protected fixLink(check: ReadinessCheck): string {
    return check.hits[0]?.link ?? check.link;
  }

  /** ", German only" when a check fails in one of the languages checked, not all. */
  private onlyIn(check: ReadinessCheck): string {
    const checked = this.report()?.locales ?? [];
    const failing = new Set(check.hits.flatMap((hit) => hit.locales));
    if (checked.length < 2 || failing.size !== 1) return "";
    const [locale] = failing;
    return `, ${LANGUAGE[locale!]} only`;
  }

  protected kindLabel(item: I18nItem): string {
    return KIND_LABELS[item.kind];
  }

  protected link(item: I18nItem): string {
    return editorLinkForI18n(item);
  }

  /** "German empty: hook", "English changed after the German was last edited". */
  protected problemText(item: I18nItem): string {
    if (item.absent) return item.absent === "de" ? "English only" : "German only";
    const parts: string[] = [];
    if (item.missingDe.length) parts.push(`German empty: ${item.missingDe.join(", ")}`);
    if (item.missingEn.length) parts.push(`English empty: ${item.missingEn.join(", ")}`);
    if (item.stale) parts.push("English changed after the German was last edited");
    return parts.join("; ");
  }
}

function names(locales: readonly Locale[]): string {
  return locales.map((locale) => LANGUAGE[locale]).join(" and ");
}
