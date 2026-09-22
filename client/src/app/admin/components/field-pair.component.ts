import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from "@angular/core";
import { FormControl, ReactiveFormsModule } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCopy } from "@ng-icons/lucide";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

export type LocaleView = "en" | "de" | "both";

/**
 * One label, two locales. Every section editor is a stack of these plus a save
 * bar, which is what keeps the admin small.
 */
@Component({
  selector: "app-field-pair",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmBadge,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmTextarea,
    NgIcon,
    ReactiveFormsModule,
  ],
  viewProviders: [provideIcons({ lucideCopy })],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between gap-3">
        <span class="flex items-baseline gap-2">
          <label [attr.for]="id() + '-en'" hlmFieldLabel class="font-mono text-[0.8rem]">
            {{ label() }}
          </label>
          @if (germanStale()) {
            <span
              hlmBadge
              variant="outline"
              class="border-accent-orange/50 font-mono text-[0.6rem] text-accent-orange"
              title="The English text changed after the German one was last edited."
            >
              DE may be stale
            </span>
          }
        </span>
        @if (view() === "both") {
          <button
            hlmBtn
            variant="ghost"
            size="sm"
            type="button"
            class="h-6 px-2 font-mono text-[0.68rem] text-muted-foreground"
            (click)="copyToGerman()"
            [attr.aria-label]="'Copy English ' + label() + ' to German'"
          >
            <ng-icon name="lucideCopy" size="12" aria-hidden="true" />
            <span class="ml-1">EN → DE</span>
          </button>
        }
      </div>

      @if (hint()) {
        <p class="m-0 text-[0.75rem] leading-snug text-muted-foreground">{{ hint() }}</p>
      }

      <div [class]="view() === 'both' ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'">
        @if (view() === "en" || view() === "both") {
          <div hlmField>
            @if (view() === "both") {
              <span
                class="mb-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground"
              >
                EN
              </span>
            }
            @if (multiline()) {
              <textarea
                hlmTextarea
                [id]="id() + '-en'"
                [rows]="rows()"
                [attr.maxlength]="maxLength() || null"
                [formControl]="controlEn()"
              ></textarea>
            } @else {
              <input
                hlmInput
                [id]="id() + '-en'"
                type="text"
                [attr.maxlength]="maxLength() || null"
                [formControl]="controlEn()"
              />
            }
            @if (maxLength()) {
              <span class="mt-1 self-end font-mono text-[0.62rem] text-muted-foreground">
                {{ lengthEn() }} / {{ maxLength() }}
              </span>
            }
          </div>
        }

        @if (view() === "de" || view() === "both") {
          <div hlmField>
            @if (view() === "both") {
              <span
                class="mb-1 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground"
              >
                DE
              </span>
            }
            @if (multiline()) {
              <textarea
                hlmTextarea
                [id]="id() + '-de'"
                [rows]="rows()"
                [attr.maxlength]="maxLength() || null"
                [formControl]="controlDe()"
              ></textarea>
            } @else {
              <input
                hlmInput
                [id]="id() + '-de'"
                type="text"
                [attr.maxlength]="maxLength() || null"
                [formControl]="controlDe()"
              />
            }
            @if (maxLength()) {
              <span class="mt-1 self-end font-mono text-[0.62rem] text-muted-foreground">
                {{ lengthDe() }} / {{ maxLength() }}
              </span>
            }
          </div>
        }
      </div>
    </div>
  `,
})
export class FieldPairComponent {
  readonly id = input.required<string>();
  readonly label = input.required<string>();
  readonly controlEn = input.required<FormControl<string>>();
  readonly controlDe = input.required<FormControl<string>>();
  readonly view = input<LocaleView>("both");
  readonly multiline = input(false);
  readonly rows = input(3);
  readonly hint = input("");
  /** 0 = no limit. Shows a counter and caps input at the browser level. */
  readonly maxLength = input(0);

  /**
   * Monotonic edit counter per locale. A timestamp would work too, but two
   * edits in the same millisecond (a paste into both) would compare equal.
   */
  private tick = 0;
  private readonly editedEn = signal(0);
  private readonly editedDe = signal(0);

  protected readonly lengthEn = signal(0);
  protected readonly lengthDe = signal(0);

  /**
   * The English copy changed after the German one was last touched — the
   * translation has probably fallen behind. Cleared by editing DE or by
   * "EN → DE".
   */
  protected readonly germanStale = computed(() => this.editedEn() > this.editedDe());

  constructor() {
    // Controls are signal inputs, so subscribe whenever the bound control
    // instance changes rather than once in the constructor.
    effect((onCleanup) => {
      const en = this.controlEn();
      const de = this.controlDe();

      this.lengthEn.set(en.value?.length ?? 0);
      this.lengthDe.set(de.value?.length ?? 0);
      // A freshly bound pair starts in sync; only edits made here count.
      this.editedEn.set(0);
      this.editedDe.set(0);

      const a = en.valueChanges.subscribe((v) => {
        this.lengthEn.set(v?.length ?? 0);
        // Programmatic resets (load, discard) leave the control pristine; only
        // real edits mark a locale as touched.
        if (en.dirty) this.editedEn.set(++this.tick);
        else this.editedEn.set(0);
      });
      const b = de.valueChanges.subscribe((v) => {
        this.lengthDe.set(v?.length ?? 0);
        if (de.dirty) this.editedDe.set(++this.tick);
        else this.editedDe.set(0);
      });

      // Runs on rebind and on destroy alike.
      onCleanup(() => {
        a.unsubscribe();
        b.unsubscribe();
      });
    });
  }

  protected copyToGerman(): void {
    this.controlDe().setValue(this.controlEn().value);
    // Mark dirty explicitly: setValue alone leaves the form looking untouched,
    // so the save bar would not light up.
    this.controlDe().markAsDirty();
    this.editedDe.set(++this.tick);
  }
}
