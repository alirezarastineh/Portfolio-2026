import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import {
  FormControl,
  FormResetEvent,
  PristineChangeEvent,
  ReactiveFormsModule,
} from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCopy, lucideSparkles } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import { AdminApiService } from "../admin-api.service";
import { CopilotLedger } from "../copilot-ledger";
import { draftOffer, type CopilotDraft, type DraftOffer } from "../copilot-skills";
import { DraftOfferComponent } from "./draft-offer.component";
import { FieldIssueComponent } from "./editor-chrome.component";

export type LocaleView = "en" | "de" | "both";

/** Each field pair's drafts are told apart in the ledger by its own number. */
let fieldPairs = 0;

/**
 * One label, two locales. Every section editor is a stack of these plus a save
 * bar, which is what keeps the admin small.
 */
@Component({
  selector: "app-field-pair",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DraftOfferComponent,
    FieldIssueComponent,
    HlmBadge,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmTextarea,
    NgIcon,
    ReactiveFormsModule,
  ],
  viewProviders: [provideIcons({ lucideCopy, lucideSparkles })],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between gap-3">
        <span class="flex items-baseline gap-2">
          <!-- Through Spartan's label input: its host binding owns the for attribute. -->
          <label
            hlmFieldLabel
            [id]="id() + '-label'"
            [for]="view() === 'de' ? id() + '-de' : id() + '-en'"
          >
            {{ label() }}
          </label>
          @if (germanStale()) {
            <span
              hlmBadge
              variant="outline"
              class="border-accent-orange/50 font-mono text-accent-orange"
              title="The English text changed after the German one was last edited."
            >
              DE may be stale
            </span>
          }
        </span>
        <span class="flex flex-wrap items-center justify-end gap-1">
          @if (view() === "both") {
            <button
              hlmBtn
              variant="ghost"
              size="sm"
              type="button"
              class="h-6 px-2 font-mono text-xs text-muted-foreground"
              (click)="copyToGerman()"
              [attr.aria-label]="'EN → DE: copy the English ' + label() + ' to German'"
            >
              <ng-icon name="lucideCopy" size="12" aria-hidden="true" />
              <span class="ml-1">EN → DE</span>
            </button>
          }
          @if (copilot()) {
            @if (view() === "both") {
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                type="button"
                class="h-6 px-2 font-mono text-xs text-muted-foreground"
                [disabled]="!!aiBusy()"
                (click)="aiTranslate('en')"
                [attr.aria-label]="
                  'Translate → DE: the English ' + label() + ' into German, with AI'
                "
              >
                <ng-icon name="lucideSparkles" size="12" aria-hidden="true" />
                <span class="ml-1">{{ aiBusy() === "de" ? "…" : "translate → DE" }}</span>
              </button>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                type="button"
                class="h-6 px-2 font-mono text-xs text-muted-foreground"
                [disabled]="!!aiBusy()"
                (click)="aiTranslate('de')"
                [attr.aria-label]="
                  '→ EN: translate the German ' + label() + ' into English, with AI'
                "
              >
                <ng-icon name="lucideSparkles" size="12" aria-hidden="true" />
                <span class="ml-1">{{ aiBusy() === "en" ? "…" : "→ EN" }}</span>
              </button>
            }
            <button
              hlmBtn
              variant="ghost"
              size="sm"
              type="button"
              class="h-6 px-2 font-mono text-xs text-muted-foreground"
              [disabled]="!!aiBusy()"
              (click)="aiTighten()"
              [attr.aria-label]="'Tighten the ' + label() + ' with AI'"
            >
              <ng-icon name="lucideSparkles" size="12" aria-hidden="true" />
              <span class="ml-1">{{ aiBusy() === "tighten" ? "…" : "tighten" }}</span>
            </button>
          }
        </span>
      </div>

      @if (hint()) {
        <p class="m-0 text-xs leading-snug text-muted-foreground">{{ hint() }}</p>
      }

      <div [class]="view() === 'both' ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'">
        @if (view() === "en" || view() === "both") {
          <div hlmField>
            @if (view() === "both") {
              <span [id]="id() + '-en-tag'" class="eyebrow mb-1 text-muted-foreground">EN</span>
            }
            @if (multiline()) {
              <textarea
                hlmTextarea
                [id]="id() + '-en'"
                [attr.aria-labelledby]="labelledBy('en')"
                [rows]="rows()"
                [attr.maxlength]="maxLength() || null"
                [attr.aria-invalid]="errorEn() ? true : null"
                [aria-describedby]="describedBy('en')"
                [formControl]="controlEn()"
              ></textarea>
            } @else {
              <input
                hlmInput
                [id]="id() + '-en'"
                [attr.aria-labelledby]="labelledBy('en')"
                type="text"
                [attr.maxlength]="maxLength() || null"
                [attr.aria-invalid]="errorEn() ? true : null"
                [aria-describedby]="describedBy('en')"
                [formControl]="controlEn()"
              />
            }
            <app-field-issue [id]="id() + '-en-issue'" [message]="errorEn()" />
            @if (limit()) {
              <span
                class="mt-1 self-end font-mono text-xs tabular-nums"
                [class]="lengthEn() > limit() ? 'text-accent-orange' : 'text-muted-foreground'"
              >
                {{ lengthEn() }} / {{ limit() }}
              </span>
            }
            <app-draft-offer
              [offer]="offers().en"
              [field]="label() + ' EN'"
              [fieldId]="id() + '-en'"
              (use)="useDraft('en', $event)"
            />
          </div>
        }

        @if (view() === "de" || view() === "both") {
          <div hlmField>
            @if (view() === "both") {
              <span [id]="id() + '-de-tag'" class="eyebrow mb-1 text-muted-foreground">DE</span>
            }
            @if (multiline()) {
              <textarea
                hlmTextarea
                [id]="id() + '-de'"
                [attr.aria-labelledby]="labelledBy('de')"
                [rows]="rows()"
                [attr.maxlength]="maxLength() || null"
                [attr.aria-invalid]="errorDe() ? true : null"
                [aria-describedby]="describedBy('de')"
                [formControl]="controlDe()"
              ></textarea>
            } @else {
              <input
                hlmInput
                [id]="id() + '-de'"
                [attr.aria-labelledby]="labelledBy('de')"
                type="text"
                [attr.maxlength]="maxLength() || null"
                [attr.aria-invalid]="errorDe() ? true : null"
                [aria-describedby]="describedBy('de')"
                [formControl]="controlDe()"
              />
            }
            <app-field-issue [id]="id() + '-de-issue'" [message]="errorDe()" />
            @if (limit()) {
              <span
                class="mt-1 self-end font-mono text-xs tabular-nums"
                [class]="lengthDe() > limit() ? 'text-accent-orange' : 'text-muted-foreground'"
              >
                {{ lengthDe() }} / {{ limit() }}
              </span>
            }
            <app-draft-offer
              [offer]="offers().de"
              [field]="label() + ' DE'"
              [fieldId]="id() + '-de'"
              (use)="useDraft('de', $event)"
            />
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
   * A recommended length (a meta description's ~160 characters): a counter
   * that turns orange past it, without stopping anyone typing.
   */
  readonly softMax = input(0);
  protected readonly limit = computed(() => this.maxLength() || this.softMax());

  /**
   * Side by side, each field is its label and its language ("Hook DE"); one
   * language alone, the `<label for>` names the field shown.
   */
  protected labelledBy(locale: "en" | "de"): string | null {
    return this.view() === "both" ? `${this.id()}-label ${this.id()}-${locale}-tag` : null;
  }
  /** Offer the AI copilot (translate, tighten). Off for names, URLs and the like. */
  readonly ai = input(true);

  /** Absent outside the admin (and in unit tests): then no AI buttons. */
  private readonly api = inject(AdminApiService, { optional: true });
  protected readonly copilot = computed(() => this.ai() && !!this.api);
  /** What became of each draft, judged when its field is saved or discarded (plan phase 27). */
  private readonly ledger = inject(CopilotLedger, { optional: true });
  private readonly drafts = `field-pair:${++fieldPairs}:`;
  /** Destroyed: a draft that comes back after that never lands. */
  private gone = false;
  /** Per language, the draft's notes and the other drafts, until it is saved or discarded. */
  protected readonly offers = signal<Record<"en" | "de", DraftOffer | null>>({
    en: null,
    de: null,
  });
  /** Which AI action is running: the target locale of a translation, or "tighten". */
  protected readonly aiBusy = signal<"en" | "de" | "tighten" | null>(null);

  /**
   * Monotonic edit counter per locale. A timestamp would work too, but two
   * edits in the same millisecond (a paste into both) would compare equal.
   */
  private tick = 0;
  private readonly editedEn = signal(0);
  private readonly editedDe = signal(0);

  protected readonly lengthEn = signal(0);
  protected readonly lengthDe = signal(0);

  /** The last save's problem with each language's value, until it is edited. */
  protected readonly errorEn = signal<string | null>(null);
  protected readonly errorDe = signal<string | null>(null);

  /**
   * The English copy changed after the German one was last touched — the
   * translation has probably fallen behind. Cleared by editing DE or by
   * "EN → DE".
   */
  protected readonly germanStale = computed(() => this.editedEn() > this.editedDe());

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.gone = true));
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

      // A save's `server` error arrives through setErrors, which emits a
      // status change; the next edit recomputes the errors and clears it.
      const serverError = (control: FormControl<string>) =>
        (control.errors?.["server"] as string | undefined) ?? null;
      this.errorEn.set(serverError(en));
      this.errorDe.set(serverError(de));
      const c = en.statusChanges.subscribe(() => this.errorEn.set(serverError(en)));
      const d = de.statusChanges.subscribe(() => this.errorDe.set(serverError(de)));

      // A draft's verdict. The editors save with `markAsPristine()`, and discard or
      // reload with `reset()`, which marks the control pristine and then emits a
      // reset event in the same call. So a reset abandons the draft at once, and a
      // pristine control is judged once the tick ends, if its draft still waits.
      const settled = (control: FormControl<string>, locale: "en" | "de") =>
        control.events.subscribe((event) => {
          if (event instanceof FormResetEvent) {
            this.ledger?.abandon(this.drafts + locale);
            this.clearOffer(locale);
          } else if (event instanceof PristineChangeEvent && event.pristine) {
            queueMicrotask(() => this.ledger?.settle(this.drafts + locale));
            this.clearOffer(locale);
          }
        });
      const e = settled(en, "en");
      const f = settled(de, "de");

      // Runs on rebind and on destroy alike: a draft no longer shown here was not saved.
      onCleanup(() => {
        a.unsubscribe();
        b.unsubscribe();
        c.unsubscribe();
        d.unsubscribe();
        e.unsubscribe();
        f.unsubscribe();
        this.ledger?.abandonPrefix(this.drafts);
      });
    });
  }

  /**
   * The copilot's suggestions land in the field as ordinary edits: nothing is
   * saved until Save, nothing is live until a publish.
   */
  protected async aiTranslate(from: "en" | "de"): Promise<void> {
    const to = from === "en" ? "de" : "en";
    const source = (from === "en" ? this.controlEn() : this.controlDe()).value ?? "";
    if (!source.trim() || !this.api) return;
    this.aiBusy.set(to);
    const result = await this.api.copilot({
      task: "translate",
      text: source,
      from,
      to,
      html: /<[a-z][^>]*>/i.test(source),
      // The field's hard limit, checked: a draft over it lands whole, with its note.
      ...(this.maxLength() ? { maxLength: this.maxLength() } : {}),
    });
    this.aiBusy.set(null);
    if (!result.ok) {
      toast.error("No translation", { description: result.error });
      return;
    }
    this.apply(to, result.data);
  }

  protected async aiTighten(): Promise<void> {
    if (!this.api) return;
    const view = this.view();
    const locales: ("en" | "de")[] = view === "both" ? ["en", "de"] : [view];
    this.aiBusy.set("tighten");
    for (const locale of locales) {
      if (this.gone) break;
      const text = (locale === "en" ? this.controlEn() : this.controlDe()).value ?? "";
      if (!text.trim()) continue;
      const result = await this.api.copilot({
        task: "tighten",
        text,
        locale,
        ...(this.maxLength() ? { maxLength: this.maxLength() } : {}),
      });
      if (!result.ok) {
        toast.error("Not tightened", { description: result.error });
        break;
      }
      this.apply(locale, result.data);
    }
    this.aiBusy.set(null);
  }

  /**
   * A draft into its field, whole (plan phase 28: never cut; a draft over the
   * field's limit says so in its notes), as the admin's edit; the ledger waits
   * for the save to judge it.
   */
  private apply(locale: "en" | "de", draft: CopilotDraft): void {
    // Back after the field pair closed: its editor is gone, and the draft never lands.
    if (this.gone) {
      this.ledger?.drop(draft);
      return;
    }
    const { control, before } = this.setField(locale, draft.text);
    this.ledger?.propose(this.drafts + locale, draft, {
      read: () => control.value ?? "",
      before,
    });
    this.offers.update((offers) => ({ ...offers, [locale]: draftOffer(draft) }));
  }

  /** A text into a field as the admin's edit; what the field held before comes back with it. */
  private setField(
    locale: "en" | "de",
    text: string,
  ): { control: FormControl<string>; before: string } {
    const control = locale === "en" ? this.controlEn() : this.controlDe();
    const before = control.value ?? "";
    control.setValue(text);
    control.markAsDirty();
    if (locale === "en") this.editedEn.set(++this.tick);
    else this.editedDe.set(++this.tick);
    return { control, before };
  }

  /** Another of the drafts offered, into the field: the one judged at the save. */
  protected useDraft(locale: "en" | "de", index: number): void {
    const offer = this.offers()[locale];
    const draft = offer?.drafts[index];
    if (!offer || !draft) return;
    this.setField(locale, draft.text);
    this.ledger?.use(this.drafts + locale, index);
    this.offers.update((offers) => ({ ...offers, [locale]: { ...offer, chosen: index } }));
  }

  private clearOffer(locale: "en" | "de"): void {
    if (this.offers()[locale]) this.offers.update((offers) => ({ ...offers, [locale]: null }));
  }

  /** The field's description: a save's problem, and the draft's notes. */
  protected describedBy(locale: "en" | "de"): string | null {
    const error = locale === "en" ? this.errorEn() : this.errorDe();
    const ids = [
      error ? `${this.id()}-${locale}-issue` : null,
      this.offers()[locale]?.drafts[this.offers()[locale]!.chosen]?.notes.length
        ? `${this.id()}-${locale}-draft`
        : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }

  protected copyToGerman(): void {
    this.controlDe().setValue(this.controlEn().value);
    // Mark dirty explicitly: setValue alone leaves the form looking untouched,
    // so the save bar would not light up.
    this.controlDe().markAsDirty();
    this.editedDe.set(++this.tick);
  }
}
