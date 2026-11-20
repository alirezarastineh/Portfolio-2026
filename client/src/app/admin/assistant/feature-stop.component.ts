import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { RouterLink } from "@angular/router";

/**
 * Why a paid button is off, and the way to Settings (plan 5, U18). The button stays a stop:
 * `aria-disabled`, this note by `aria-describedby`, its handler returning early.
 */
@Component({
  selector: "app-feature-stop",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  host: { class: "block" },
  template: `
    <p [id]="noteId()" class="m-0 text-hint text-muted-foreground">
      {{ reason() }}
      <a
        routerLink="/admin/assistant"
        [queryParams]="{ view: 'settings' }"
        class="touch-manipulation underline underline-offset-4 hover:text-foreground"
        (click)="followed.emit()"
        >Settings</a
      >
    </p>
  `,
})
export class FeatureStopComponent {
  /** The note's id: the buttons it explains name it in `aria-describedby`. */
  readonly noteId = input.required<string>();
  readonly reason = input.required<string>();
  /** The link was followed: a panel over the page closes for it. */
  readonly followed = output();
}
