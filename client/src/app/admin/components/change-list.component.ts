import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { RouterLink } from "@angular/router";

import { LANGUAGE, type ChangeGroup, type ListedChange } from "../review-words";

/**
 * Changes in words, grouped by the page that edits them (plan 5, U16): "Bio (German): changed", the
 * new text in two lines, and Open where the review offers it. The review and History both read it.
 */
@Component({
  selector: "app-change-list",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: "flex min-w-0 flex-col gap-4" },
  template: `
    @for (group of groups(); track group.page) {
      <section class="flex min-w-0 flex-col" [attr.aria-labelledby]="idOf(group.page)">
        <h3 [id]="idOf(group.page)" class="m-0 pb-1.5 text-sm font-medium text-foreground">
          {{ group.page }}
        </h3>
        <ul class="m-0 flex list-none flex-col p-0" role="list">
          @for (change of group.changes; track $index) {
            <li class="flex min-w-0 items-start gap-3 border-t border-border py-2">
              <div class="min-w-0 flex-1">
                <p class="m-0 text-sm wrap-anywhere">
                  <span
                    [class.font-data]="!change.named"
                    [attr.translate]="change.named ? null : 'no'"
                    [textContent]="change.what"
                  ></span
                  ><span class="text-muted-foreground" [textContent]="tail(change)"></span>
                </p>
                @if (change.excerpt) {
                  <p
                    class="m-0 mt-0.5 line-clamp-2 text-hint text-muted-foreground wrap-anywhere"
                    [lang]="change.locale"
                    [textContent]="change.excerpt"
                  ></p>
                }
              </div>
              @if (links() && change.open; as place) {
                <a
                  class="inline-flex min-h-6 shrink-0 touch-manipulation items-center text-sm text-foreground underline-offset-4 hover:underline pointer-coarse:min-h-11"
                  [routerLink]="place.path"
                  [queryParams]="place.query ?? null"
                  (click)="opened.emit()"
                  >Open<span class="sr-only" [textContent]="' ' + change.what + said(change)"></span
                ></a>
              }
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class ChangeListComponent {
  readonly groups = input.required<readonly ChangeGroup[]>();
  /** Open on each row: the review's way to the editor; History's view shows what a roll back does. */
  readonly links = input(true);
  /** An Open was followed: the dialog around it closes. */
  readonly opened = output<void>();

  protected idOf(page: string): string {
    return `changes-${page.toLowerCase().replaceAll(/[^a-z]+/g, "-")}`;
  }

  /** " (German)", the language as a word. */
  protected said(change: ListedChange): string {
    return ` (${LANGUAGE[change.locale]})`;
  }

  /** " (German): changed". */
  protected tail(change: ListedChange): string {
    return `${this.said(change)}: ${change.kind}`;
  }
}
