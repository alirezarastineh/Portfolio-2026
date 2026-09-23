import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { RouterLink } from "@angular/router";

import type { Locale } from "../content/schema";

/** The landmark's name: interface chrome rather than content, so not in the CMS. */
const LABEL: Record<Locale, string> = { en: "Breadcrumb", de: "Brotkrümelnavigation" };

export interface BreadcrumbItem {
  label: string;
  /** Router commands; the last item is the current page and has none. */
  link?: readonly unknown[];
  fragment?: string;
}

/**
 * Where a page sits: `Alireza Rastineh / Work / Atlas`. The page's JSON-LD
 * `BreadcrumbList` describes the same trail.
 */
@Component({
  selector: "app-breadcrumb",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: "block" },
  template: `
    <nav [attr.aria-label]="label()">
      <ol class="m-0 flex list-none flex-wrap items-center gap-x-2 gap-y-1 p-0 font-mono text-xs">
        @for (item of items(); track $index; let last = $last) {
          <li class="flex items-center gap-2">
            @if (item.link && !last) {
              <a
                class="text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
                [routerLink]="item.link"
                [fragment]="item.fragment"
                >{{ item.label }}</a
              >
              <span class="text-muted-foreground" aria-hidden="true">/</span>
            } @else {
              <span class="text-foreground" aria-current="page">{{ item.label }}</span>
            }
          </li>
        }
      </ol>
    </nav>
  `,
})
export class BreadcrumbComponent {
  readonly items = input.required<readonly BreadcrumbItem[]>();
  readonly locale = input.required<Locale>();

  protected readonly label = computed(() => LABEL[this.locale()]);
}
