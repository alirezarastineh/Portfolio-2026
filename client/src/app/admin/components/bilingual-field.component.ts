import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { ReactiveFormsModule } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCircleAlert, lucideCopy, lucideEllipsis, lucideSparkles } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDropdownMenuImports } from "@spartan-ng/helm/dropdown-menu";
import { HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import type { Locale } from "../../content/schema";
import { languageNote, TRACE_WORDS, type TraceState } from "../change-trace";
import { DraftOfferComponent } from "./draft-offer.component";
import { FieldIssueComponent } from "./editor-chrome.component";
import { FieldPairComponent } from "./field-pair.component";

/**
 * The bilingual field (plan 5, U10): one label, English and German side by side (the editor
 * shows one language below 1024 px), the change trace on its left edge with its words for screen
 * readers, the German's notes, a counter where there is a limit, and a ⋯ menu for the steps that
 * replace text, each taken back by its Undo. It behaves as the field pair does; the other editors
 * move onto it in their Parts.
 */
@Component({
  selector: "app-bilingual-field",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DraftOfferComponent,
    FieldIssueComponent,
    HlmButton,
    HlmDropdownMenuImports,
    HlmFieldLabel,
    HlmInput,
    HlmTextarea,
    NgIcon,
    ReactiveFormsModule,
  ],
  viewProviders: [provideIcons({ lucideCircleAlert, lucideCopy, lucideEllipsis, lucideSparkles })],
  host: {
    class: "change-trace block",
    "[attr.data-change]": "state() === 'live' ? null : state()",
  },
  template: `
    <div class="flex flex-col gap-1.5">
      <div class="flex min-h-6 items-center justify-between gap-3">
        <label
          hlmFieldLabel
          [id]="id() + '-label'"
          [for]="view() === 'de' ? id() + '-de' : id() + '-en'"
          >{{ label() }}</label
        >
        <button
          hlmBtn
          variant="ghost"
          size="icon-sm"
          type="button"
          class="size-6 shrink-0 text-muted-foreground pointer-coarse:size-11"
          [hlmDropdownMenuTrigger]="menu"
          [attr.aria-label]="'More actions for ' + label()"
        >
          <ng-icon name="lucideEllipsis" size="16" aria-hidden="true" />
        </button>
        <ng-template #menu>
          <hlm-dropdown-menu class="w-72">
            @if (view() !== "en") {
              <button
                hlmDropdownMenuItem
                class="text-left"
                [disabled]="!textEn().trim()"
                (triggered)="copyToGerman()"
              >
                <ng-icon name="lucideCopy" size="16" aria-hidden="true" />Copy English to German
              </button>
            }
            @if (copilot()) {
              @if (view() !== "en") {
                <button
                  hlmDropdownMenuItem
                  class="text-left"
                  [disabled]="!!aiBusy() || !textEn().trim()"
                  (triggered)="aiTranslate('en')"
                >
                  <ng-icon name="lucideSparkles" size="16" aria-hidden="true" />Translate to German
                  with AI (paid)
                </button>
              }
              @if (view() !== "de") {
                <button
                  hlmDropdownMenuItem
                  class="text-left"
                  [disabled]="!!aiBusy() || !textDe().trim()"
                  (triggered)="aiTranslate('de')"
                >
                  <ng-icon name="lucideSparkles" size="16" aria-hidden="true" />Translate to English
                  with AI (paid)
                </button>
              }
              <button
                hlmDropdownMenuItem
                class="text-left"
                [disabled]="!!aiBusy()"
                (triggered)="aiTighten()"
              >
                <ng-icon name="lucideSparkles" size="16" aria-hidden="true" />Tighten with AI (paid)
              </button>
            }
            <hlm-dropdown-menu-separator />
            <button
              hlmDropdownMenuItem
              class="text-left"
              [disabled]="!lastUndo()"
              (triggered)="undo()"
            >
              Undo
            </button>
          </hlm-dropdown-menu>
        </ng-template>
      </div>

      @if (hint()) {
        <p [id]="id() + '-hint'" class="m-0 text-hint text-muted-foreground">{{ hint() }}</p>
      }
      <span [id]="id() + '-state'" class="sr-only">{{ words() }}</span>

      <div [class]="view() === 'both' ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'">
        @for (locale of locales(); track locale) {
          <div class="flex min-w-0 flex-col gap-1">
            <span [id]="id() + '-' + locale + '-tag'" class="sr-only">{{
              locale === "en" ? "English" : "German"
            }}</span>
            @if (multiline()) {
              <textarea
                hlmTextarea
                autocomplete="off"
                [id]="id() + '-' + locale"
                [attr.lang]="locale"
                [attr.aria-labelledby]="labelledBy(locale)"
                [rows]="rows()"
                [attr.maxlength]="maxLength() || null"
                [attr.aria-invalid]="error(locale) ? true : null"
                [aria-describedby]="describedBy(locale)"
                [formControl]="control(locale)"
              ></textarea>
            } @else {
              <input
                hlmInput
                type="text"
                autocomplete="off"
                [id]="id() + '-' + locale"
                [attr.lang]="locale"
                [attr.aria-labelledby]="labelledBy(locale)"
                [attr.maxlength]="maxLength() || null"
                [attr.aria-invalid]="error(locale) ? true : null"
                [aria-describedby]="describedBy(locale)"
                [formControl]="control(locale)"
              />
            }
            <app-field-issue [id]="id() + '-' + locale + '-issue'" [message]="error(locale)" />
            @let length = locale === "en" ? lengthEn() : lengthDe();
            @if ((note() && noteIn() === locale) || limit()) {
              <div class="flex items-start gap-3">
                @if (note() && noteIn() === locale) {
                  <p
                    [id]="id() + '-note'"
                    class="m-0 flex items-center gap-1 text-xs font-medium text-muted-foreground"
                  >
                    <ng-icon name="lucideCircleAlert" size="14" aria-hidden="true" /><span
                      [textContent]="note()"
                    ></span>
                  </p>
                }
                @if (limit()) {
                  <span
                    class="ml-auto text-xs tabular-nums"
                    [class]="length > limit() ? 'text-accent-orange' : 'text-faint-foreground'"
                    >{{ length }} / {{ limit() }}</span
                  >
                }
              </div>
            }
            <app-draft-offer
              [offer]="offers()[locale]"
              [field]="label() + (locale === 'en' ? ' EN' : ' DE')"
              [fieldId]="id() + '-' + locale"
              (use)="useDraft(locale, $event)"
            />
          </div>
        }
      </div>
    </div>
  `,
})
export class BilingualFieldComponent extends FieldPairComponent {
  /** The trace, from the editor: it knows what is saved, and the review what is live. */
  readonly state = input<TraceState>("live");
  /** The live site's text in both languages (the review's), for "English changed, German not". */
  readonly live = input<Record<Locale, string> | null>(null);

  protected readonly locales = computed<Locale[]>(() => {
    const view = this.view();
    return view === "both" ? ["en", "de"] : [view];
  });
  protected readonly words = computed(() => TRACE_WORDS[this.state()]);
  protected readonly note = computed(() => languageNote(this.textEn(), this.textDe(), this.live()));
  /** Under the German, or under the English while only the English shows. */
  protected readonly noteIn = computed<Locale>(() => (this.view() === "en" ? "en" : "de"));

  protected control(locale: Locale) {
    return locale === "en" ? this.controlEn() : this.controlDe();
  }

  protected undo(): void {
    this.lastUndo()?.();
  }

  protected error(locale: Locale): string | null {
    return locale === "en" ? this.errorEn() : this.errorDe();
  }

  /** A save's problem first, then the trace's words, the German's note and the hint. */
  protected override describedBy(locale: Locale): string | null {
    const ids = [
      super.describedBy(locale),
      this.state() === "live" ? null : `${this.id()}-state`,
      this.note() && this.noteIn() === locale ? `${this.id()}-note` : null,
      this.hint() ? `${this.id()}-hint` : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }
}
