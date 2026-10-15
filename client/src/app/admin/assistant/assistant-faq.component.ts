import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  OnInit,
  output,
  signal,
  untracked,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import type { Locale } from "../../content/schema";
import { FormSkeletonComponent, LoadErrorComponent } from "../components/load-state.component";
import { AdminApiService } from "../admin-api.service";
import type { FaqEntry, FaqInput } from "../assistant-types";
import { ConfirmService } from "../components/confirm-dialog.component";
import { DraftOfferComponent } from "../components/draft-offer.component";
import { CopilotLedger } from "../copilot-ledger";
import { draftOffer, type DraftOffer } from "../copilot-skills";
import { FaqDraftsService } from "../faq-drafts.service";
import { isOpenProposal, provenanceOf, type FaqProposal } from "../faq-proposals";
import { FaqProposalsComponent } from "./faq-proposals.component";

const LOCALES: Locale[] = ["en", "de"];

interface Form {
  id: string | null;
  isVisible: boolean;
  text: Record<Locale, { question: string; answer: string }>;
}

function emptyForm(question = ""): Form {
  return {
    id: null,
    isVisible: true,
    text: { en: { question, answer: "" }, de: { question: "", answer: "" } },
  };
}

/**
 * Curated answers the assistant cites like any other document
 * (`faq:<id>@<locale>`). Live on save — they are the assistant's knowledge,
 * not page content, so there is nothing to publish.
 */
@Component({
  selector: "app-assistant-faq",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DraftOfferComponent,
    FaqProposalsComponent,
    FormsModule,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    FormSkeletonComponent,
    LoadErrorComponent,
    HlmSwitch,
    HlmTextarea,
  ],
  host: { class: "block" },
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between gap-2">
        <p class="m-0 text-sm text-muted-foreground">
          Answers to questions the portfolio does not cover (notice period, relocation, rates…).
        </p>
        <button hlmBtn size="sm" (click)="startNew()">New entry</button>
      </div>

      <app-faq-proposals [proposals]="openProposals()" [focus]="proposal()" (decided)="load()" />

      @if (form(); as f) {
        <form
          class="flex flex-col gap-4 rounded-lg border border-border p-4"
          (submit)="$event.preventDefault(); save()"
        >
          @for (locale of locales; track locale) {
            <fieldset class="flex flex-col gap-2">
              <legend class="font-mono text-xs uppercase text-muted-foreground">
                {{ locale }}
              </legend>
              <div hlmField>
                <label hlmFieldLabel [for]="'faq-q-' + locale">Question</label>
                <input
                  hlmInput
                  [id]="'faq-q-' + locale"
                  [ngModel]="f.text[locale].question"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="setText(locale, 'question', $event)"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel [for]="'faq-a-' + locale">Answer</label>
                <textarea
                  hlmTextarea
                  rows="3"
                  [id]="'faq-a-' + locale"
                  [aria-describedby]="offerFor(locale) ? 'faq-a-' + locale + '-draft' : null"
                  [ngModel]="f.text[locale].answer"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="setText(locale, 'answer', $event)"
                ></textarea>
                <app-draft-offer
                  [offer]="offerFor(locale)"
                  [field]="'Answer ' + locale.toUpperCase()"
                  [fieldId]="'faq-a-' + locale"
                />
              </div>
              <div>
                <button
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  type="button"
                  [disabled]="drafting() || f.text[locale].question.trim().length < 3"
                  (click)="draftAnswer(locale)"
                >
                  Draft an answer from the portfolio
                </button>
              </div>
            </fieldset>
          }
          <label class="flex items-center gap-2 text-sm">
            <hlm-switch [checked]="f.isVisible" (checkedChange)="setVisible($event)" />
            Used by the assistant
          </label>
          <div class="flex gap-2">
            <button hlmBtn type="submit" [disabled]="saving()">Save</button>
            <button hlmBtn variant="ghost" type="button" (click)="cancel()">Cancel</button>
          </div>
          <p class="m-0 text-xs text-muted-foreground">
            A drafted answer is only a suggestion in the field: check it, then save.
          </p>
        </form>
      }

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="3" label="Loading the FAQ…" />
      } @else if (loadError(); as reason) {
        <app-load-error title="Could not load the FAQ" [reason]="reason" (retry)="reload()" />
      } @else {
        <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
          @for (entry of entries(); track entry.id; let i = $index, last = $last) {
            <li
              class="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm"
            >
              <span class="min-w-0 flex-1" [class.text-muted-foreground]="!entry.isVisible">
                {{ entry.translations.en?.question ?? entry.translations.de?.question }}
                <span class="font-mono text-xs text-muted-foreground">
                  {{ langs(entry) }}{{ entry.isVisible ? "" : " · hidden" }}
                </span>
                @if (provenance().get(entry.id); as from) {
                  <span class="block text-xs text-muted-foreground">{{ from }}</span>
                }
              </span>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                [disabled]="i === 0"
                (click)="move(i, -1)"
                aria-label="Move up"
              >
                ↑
              </button>
              <button
                hlmBtn
                variant="ghost"
                size="sm"
                [disabled]="last"
                (click)="move(i, 1)"
                aria-label="Move down"
              >
                ↓
              </button>
              <button hlmBtn variant="outline" size="sm" (click)="edit(entry)">Edit</button>
              <button hlmBtn variant="ghost" size="sm" (click)="remove(entry)">Delete</button>
            </li>
          } @empty {
            <li class="text-sm text-muted-foreground">No entries yet.</li>
          }
        </ul>
      }
    </div>
  `,
})
export class AssistantFaqComponent implements OnInit {
  /** A question from the insights to start a new entry with. */
  readonly seed = input<string | null>(null);
  readonly seedTaken = output<void>();
  /** A proposal just drafted from Insights or the Journal (plan phase 31): shown first. */
  readonly proposal = input<string | null>(null);

  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  /** A drafted answer's verdict, judged when the entry is saved (plan phase 27). */
  private readonly ledger = inject(CopilotLedger);
  private readonly drafts = inject(FaqDraftsService);

  protected readonly locales = LOCALES;
  protected readonly entries = signal<FaqEntry[]>([]);
  /** The FAQ pipeline's proposals, newest first: the open ones to decide, the accepted ones' sources. */
  private readonly proposals = signal<FaqProposal[]>([]);
  protected readonly openProposals = computed(() => this.proposals().filter(isOpenProposal));
  /** Where each entry an accepted proposal made came from. */
  protected readonly provenance = computed(() => provenanceOf(this.proposals()));
  protected readonly loading = signal(true);
  /** The API's reason when the entries did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly form = signal<Form | null>(null);
  protected readonly saving = signal(false);
  protected readonly drafting = signal(false);
  /** Each form opened gets a number: a draft that comes back for an earlier one never lands. */
  private formSerial = 0;
  /** A drafted answer's notes (plan phase 28), by language, while it waits for the save. */
  private readonly offers = signal<
    Partial<Record<Locale, { value: DraftOffer; tracked: boolean }>>
  >({});

  protected offerFor(locale: Locale): DraftOffer | null {
    const offer = this.offers()[locale];
    if (!offer) return null;
    return !offer.tracked || this.ledger.waits(`faq:${locale}`) ? offer.value : null;
  }
  private gone = false;

  constructor() {
    effect(() => {
      const question = this.seed();
      if (!question) return;
      untracked(() => {
        this.replaceForm(emptyForm(question));
        this.seedTaken.emit();
      });
    });
    // A proposal drafted in Insights or the Journal lands while this tab is open: read the list
    // again, so it shows (the ones announced before this tab opened are in its first read).
    const since = this.drafts.drafted()?.n ?? 0;
    effect(() => {
      const drafted = this.drafts.drafted();
      if (drafted && drafted.n > since) untracked(() => void this.load());
    });
    // Leaving with the form open: a drafted answer not saved was not kept.
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.ledger.abandonPrefix("faq:");
    });
  }

  /** Another form, or none: a drafted answer not saved in the one before was not kept. */
  private replaceForm(next: Form | null): void {
    this.ledger.abandonPrefix("faq:");
    this.formSerial++;
    this.offers.set({});
    this.form.set(next);
  }

  ngOnInit(): void {
    void this.load();
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  protected async load(): Promise<void> {
    const [result, proposals] = await Promise.all([this.api.listFaq(), this.api.faqProposals()]);
    this.loading.set(false);
    this.loadError.set(result.ok ? null : result.error);
    if (result.ok) this.entries.set(result.data.faq);
    // An API without the pipeline answers 404: there is nothing to propose.
    if (proposals.ok) this.proposals.set(proposals.data.proposals);
  }

  protected langs(entry: FaqEntry): string {
    return LOCALES.filter((l) => entry.translations[l])
      .join(" · ")
      .toUpperCase();
  }

  protected startNew(): void {
    this.replaceForm(emptyForm());
  }

  protected cancel(): void {
    this.replaceForm(null);
  }

  protected edit(entry: FaqEntry): void {
    this.replaceForm({
      id: entry.id,
      isVisible: entry.isVisible,
      text: {
        en: { ...(entry.translations.en ?? { question: "", answer: "" }) },
        de: { ...(entry.translations.de ?? { question: "", answer: "" }) },
      },
    });
  }

  protected setText(locale: Locale, key: "question" | "answer", value: string): void {
    this.form.update((f) =>
      f ? { ...f, text: { ...f.text, [locale]: { ...f.text[locale], [key]: value } } } : f,
    );
  }

  protected setVisible(isVisible: boolean): void {
    this.form.update((f) => (f ? { ...f, isVisible } : f));
  }

  protected async draftAnswer(locale: Locale): Promise<void> {
    const question = this.form()?.text[locale].question.trim();
    if (!question) return;
    this.drafting.set(true);
    const serial = this.formSerial;
    const result = await this.api.copilot({ task: "faq-answer", question, locale });
    this.drafting.set(false);
    if (!result.ok) {
      toast.error("No draft", { description: result.error });
      return;
    }
    // The form closed or changed meanwhile: the draft never lands.
    if (this.gone || serial !== this.formSerial) {
      this.ledger.drop(result.data);
      return;
    }
    if (result.data.text === "NO_ANSWER") {
      toast.info("The portfolio does not answer this — write it yourself.");
      return;
    }
    const before = this.form()?.text[locale].answer ?? "";
    this.setText(locale, "answer", result.data.text);
    this.ledger.propose(`faq:${locale}`, result.data, {
      read: () => this.form()?.text[locale].answer ?? "",
      before,
    });
    const offer = draftOffer(result.data);
    this.offers.update((all) => ({
      ...all,
      [locale]: offer ? { value: offer, tracked: Boolean(result.data.suggestionId) } : undefined,
    }));
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    const translations: FaqInput["translations"] = {};
    for (const locale of LOCALES) {
      const t = f.text[locale];
      if (t.question.trim() || t.answer.trim()) {
        translations[locale] = { question: t.question.trim(), answer: t.answer.trim() };
      }
    }
    if (!Object.keys(translations).length) {
      toast.error("Write the entry in at least one language");
      return;
    }
    this.saving.set(true);
    // A drafted answer is judged by what this save sends, even if the form closes meanwhile.
    const ended = this.ledger.beginSave(
      Object.fromEntries(LOCALES.map((l) => [`faq:${l}`, translations[l]?.answer ?? ""])),
    );
    const input: FaqInput = { isVisible: f.isVisible, translations };
    const result = f.id ? await this.api.updateFaq(f.id, input) : await this.api.createFaq(input);
    this.saving.set(false);
    ended(result.ok);
    if (!result.ok) {
      toast.error("Not saved", {
        description:
          result.error === "invalid_input"
            ? "Questions need 3+ characters, answers too."
            : result.error,
      });
      return;
    }
    this.replaceForm(null);
    toast.success("Saved — the assistant uses it from now on");
    await this.load();
  }

  protected async move(index: number, by: -1 | 1): Promise<void> {
    const list = [...this.entries()];
    const [item] = list.splice(index, 1);
    list.splice(index + by, 0, item!);
    this.entries.set(list);
    const result = await this.api.reorderFaq(list.map((e) => e.id));
    if (!result.ok) {
      toast.error("Order not saved", { description: result.error });
      await this.load();
    }
  }

  protected async remove(entry: FaqEntry): Promise<void> {
    const go = await this.confirm.ask({
      title: "Delete this FAQ entry?",
      description: "Both languages are deleted, and the assistant stops citing it at once.",
      confirmLabel: "Delete entry",
      destructive: true,
    });
    if (!go) return;
    const result = await this.api.deleteFaq(entry.id);
    if (!result.ok) {
      toast.error("Not deleted", { description: result.error });
      return;
    }
    await this.load();
  }
}
