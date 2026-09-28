import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCloudOff, lucideFileQuestionMark, lucideRefreshCw } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmEmptyImports } from "@spartan-ng/helm/empty";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

/**
 * What a page shows when its data did not arrive: what failed, the API's
 * reason, and a way to ask again. It replaces a toast that vanished and a page
 * that then looked empty ("No projects yet.") when it was not.
 */
@Component({
  selector: "app-load-error",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmEmptyImports, NgIcon],
  viewProviders: [provideIcons({ lucideCloudOff, lucideRefreshCw })],
  host: { class: "block" },
  template: `
    @if (compact()) {
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2" role="alert">
        <ng-icon
          name="lucideCloudOff"
          size="16"
          class="shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <p class="m-0 min-w-0 flex-1 text-sm text-muted-foreground">{{ title() }}</p>
        <button hlmBtn variant="outline" size="sm" type="button" (click)="retry.emit()">
          Try again
        </button>
      </div>
    } @else {
      <div hlmEmpty class="border border-dashed border-border md:p-10" role="alert">
        <div hlmEmptyHeader>
          <div hlmEmptyMedia variant="icon">
            <ng-icon name="lucideCloudOff" size="20" aria-hidden="true" />
          </div>
          <h2 hlmEmptyTitle>{{ title() }}</h2>
          <p hlmEmptyDescription>
            {{ description() }}
            @if (reason()) {
              <span class="mt-1 block font-mono text-meta">{{ reason() }}</span>
            }
          </p>
        </div>
        <div hlmEmptyContent>
          <button hlmBtn variant="outline" type="button" (click)="retry.emit()">
            <ng-icon name="lucideRefreshCw" size="14" aria-hidden="true" />
            <span class="ml-1.5">Try again</span>
          </button>
        </div>
      </div>
    }
  `,
})
export class LoadErrorComponent {
  readonly title = input("Could not load this section");
  readonly description = input("Nothing was lost: your saved draft is still there.");
  /** The API's error code, as it said it. */
  readonly reason = input("");
  /** One line, for a card or a tile rather than a whole page. */
  readonly compact = input(false, { transform: booleanAttribute });
  readonly retry = output<void>();
}

/**
 * An editor opened for something that is not there (a renamed or deleted
 * project, an old bookmark), with the way back to its list.
 */
@Component({
  selector: "app-not-found-state",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmEmptyImports, NgIcon, RouterLink],
  viewProviders: [provideIcons({ lucideFileQuestionMark })],
  host: { class: "block" },
  template: `
    <div hlmEmpty class="border border-dashed border-border md:p-10">
      <div hlmEmptyHeader>
        <div hlmEmptyMedia variant="icon">
          <ng-icon name="lucideFileQuestionMark" size="20" aria-hidden="true" />
        </div>
        <h1 hlmEmptyTitle>No {{ what() }} here</h1>
        <p hlmEmptyDescription>
          Its address may have changed, or it was deleted. The list has everything there is.
        </p>
      </div>
      <div hlmEmptyContent>
        <a hlmBtn variant="outline" [routerLink]="back()">{{ backLabel() }}</a>
      </div>
    </div>
  `,
})
export class NotFoundStateComponent {
  /** "project", "post". */
  readonly what = input.required<string>();
  readonly back = input.required<string>();
  readonly backLabel = input.required<string>();
}

/** One placeholder field: a label, then one input per language side by side. */
interface SkeletonRow {
  label: string;
  field: string;
}

const LABEL_WIDTHS = ["w-24", "w-36", "w-28", "w-44", "w-32"];

/**
 * A loading placeholder shaped like what is coming, so the page keeps its
 * layout when the data lands: rows of labelled fields for an editor, rows of
 * items for a list.
 */
@Component({
  selector: "app-form-skeleton",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmSkeleton],
  host: { class: "block" },
  template: `
    <div role="status" class="flex flex-col" [class]="kind() === 'list' ? 'gap-2' : 'gap-6'">
      <span class="sr-only">{{ label() }}</span>
      <!-- Sizes vary on wrappers: Spartan's class manager owns the skeleton's own class list. -->
      @if (kind() === "list") {
        @for (row of items(); track $index) {
          <div
            class="flex items-center gap-3 rounded-lg border border-border px-4 py-3"
            aria-hidden="true"
          >
            <div class="flex min-w-0 flex-1 flex-col gap-2">
              <div [class]="row.label"><hlm-skeleton class="h-4 w-full" /></div>
              <hlm-skeleton class="h-3 w-28" />
            </div>
            <hlm-skeleton class="h-8 w-16" />
          </div>
        }
      } @else {
        @for (row of items(); track $index) {
          <div class="flex flex-col gap-2" aria-hidden="true">
            <div [class]="row.label"><hlm-skeleton class="h-3.5 w-full" /></div>
            <div class="grid gap-3 lg:grid-cols-2" [class]="row.field">
              <hlm-skeleton class="h-full w-full" />
              <hlm-skeleton class="hidden h-full w-full lg:block" />
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class FormSkeletonComponent {
  readonly kind = input<"fields" | "list">("fields");
  readonly rows = input(5);
  readonly label = input("Loading…");

  /** Varied, so it reads as a form rather than a stripe pattern. Every third field is a text area. */
  protected readonly items = computed<SkeletonRow[]>(() =>
    Array.from({ length: this.rows() }, (_, i) => ({
      label: LABEL_WIDTHS[i % LABEL_WIDTHS.length]!,
      field: i % 3 === 2 ? "h-20" : "h-9",
    })),
  );
}
