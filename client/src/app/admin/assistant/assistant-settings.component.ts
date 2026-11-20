import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import type { Locale } from "../../content/schema";
import { AdminApiService } from "../admin-api.service";
import { apiWords } from "../api-words";
import {
  FEATURE_WORDS,
  hasSwitch,
  liveChanges,
  settingsInput,
  toDraft,
  type SettingsDraft,
} from "../assistant-settings";
import type { AssistantEnv, ChainModel } from "../assistant-types";
import { countChangedFields } from "../changed-fields";
import { ConfirmService } from "../components/confirm-dialog.component";
import { SaveBarComponent } from "../components/editor-chrome.component";
import { FormSkeletonComponent, LoadErrorComponent } from "../components/load-state.component";
import { usd } from "../now";
import { AdminPulseService } from "../pulse.service";
import { RecoveryService } from "../recovery.service";
import { toastDiscarded, toastNotSaved } from "../save-feedback";
import { CAPPED, featureLabel, type SpendDraft } from "../spending";
import { UnsavedChangesService } from "../unsaved-changes.service";

const LOCALES: Locale[] = ["en", "de"];
const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };

/** The deploy's chains, in the order and the words Settings shows them. */
const ROLES = [
  { role: "lite", name: "Lite answers" },
  { role: "deep", name: "Deep answers" },
  { role: "copilot", name: "Copilot" },
  { role: "insight", name: "Insights" },
] as const;

/**
 * What can change without a deploy, saved once and live at once (plan 5, U19): the service's
 * switches, the budget and what the admin's tools may spend of it, feature by feature, and what
 * visitors read. A save asks first and says what goes live. Below, read-only, what the deploy set.
 */
@Component({
  selector: "app-assistant-settings",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    FormSkeletonComponent,
    LoadErrorComponent,
    HlmSwitch,
    HlmTextarea,
    SaveBarComponent,
  ],
  host: { class: "block" },
  template: `
    @if (loadError(); as reason) {
      <app-load-error title="Could not load the settings" [reason]="reason" (retry)="reload()" />
    } @else if (!draft()) {
      <app-form-skeleton [rows]="5" label="Loading the settings…" />
    } @else {
      @let d = draft()!;
      <div class="flex flex-col gap-8">
        <section class="flex flex-col gap-4" aria-labelledby="settings-service">
          <h2 id="settings-service" class="m-0 text-section-title">The visitors' assistant</h2>
          <!-- Each switch: its label names it, the hint describes it (admin-ui rule). -->
          <div class="flex items-start gap-3 text-sm">
            <hlm-switch
              id="ask-enabled"
              aria-describedby="ask-enabled-hint"
              [checked]="d.enabled"
              (checkedChange)="patch({ enabled: $event })"
            />
            <div>
              <label for="ask-enabled">Answer visitors</label>
              <p
                id="ask-enabled-hint"
                class="m-0 max-w-prose text-hint text-pretty text-muted-foreground"
              >
                Off, the visitors' assistant says it is offline; the Playground and your runs still
                work.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-3 text-sm">
            <hlm-switch
              id="ask-deep"
              aria-describedby="ask-deep-hint"
              [checked]="d.deepEnabled"
              (checkedChange)="patch({ deepEnabled: $event })"
            />
            <div>
              <label for="ask-deep">Deep model for comparisons and architecture questions</label>
              <p
                id="ask-deep-hint"
                class="m-0 max-w-prose text-hint text-pretty text-muted-foreground"
              >
                It switches itself off for the rest of the day once today's spend reaches 80 % of
                the budget.
              </p>
            </div>
          </div>
          <div class="flex items-start gap-3 text-sm">
            <hlm-switch
              id="ask-scorecard"
              aria-describedby="ask-scorecard-hint"
              [checked]="d.publicScorecard"
              (checkedChange)="patch({ publicScorecard: $event })"
            />
            <div>
              <label for="ask-scorecard">Public scorecard</label>
              <p
                id="ask-scorecard-hint"
                class="m-0 max-w-prose text-hint text-pretty text-muted-foreground"
              >
                Visitors read the recorded eval run and 30 days of live checks, totals only, with
                the <code translate="no">evals</code> command. Off, it is not published.
              </p>
            </div>
          </div>
        </section>

        <section class="flex flex-col gap-4" aria-labelledby="settings-spending">
          <h2 id="settings-spending" class="m-0 text-section-title">Spending</h2>
          <div class="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <div hlmField>
              <label hlmFieldLabel for="ask-budget">Daily budget (USD)</label>
              <input
                hlmInput
                id="ask-budget"
                type="number"
                inputmode="decimal"
                autocomplete="off"
                min="0.01"
                max="100"
                step="0.01"
                [aria-describedby]="'ask-budget-hint'"
                [placeholder]="deployBudget()"
                [ngModel]="d.budget"
                (ngModelChange)="patch({ budget: $event === null ? '' : String($event) })"
              />
              <p
                id="ask-budget-hint"
                class="m-0 max-w-prose text-hint text-pretty text-muted-foreground"
              >
                Empty: the deploy's {{ deployBudget() }}. Visitors' answers may spend all of it.
              </p>
            </div>
            <div hlmField>
              <label hlmFieldLabel for="ask-reserve">Kept for visitors (% of the budget)</label>
              <input
                hlmInput
                id="ask-reserve"
                type="number"
                inputmode="numeric"
                autocomplete="off"
                min="0"
                max="90"
                step="1"
                [aria-describedby]="'ask-reserve-hint'"
                [ngModel]="d.spend.reserve"
                (ngModelChange)="patchSpend({ reserve: $event === null ? '' : String($event) })"
              />
              <p
                id="ask-reserve-hint"
                class="m-0 max-w-prose text-hint text-pretty text-muted-foreground"
              >
                The reserve line: the admin's tools stop once today's spend reaches
                {{ reserveLine() }}. At 0 % they may spend it all.
              </p>
            </div>
          </div>
          <!-- One row a feature: what it spends on, its switch, its cap; an off feature's cap is
               hidden and kept, and a save still sends it. -->
          <ul class="m-0 list-none border-b border-border p-0" role="list">
            @for (f of capped; track f) {
              <li
                class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-t border-border py-3 sm:grid-cols-[minmax(0,1fr)_auto_8rem]"
              >
                <div class="min-w-0 text-sm">
                  @if (hasSwitch(f)) {
                    <label class="font-medium" [for]="'ask-feature-' + f">{{ label(f) }}</label>
                  } @else {
                    <p class="m-0 font-medium">{{ label(f) }}</p>
                  }
                  <p
                    [id]="'ask-feature-' + f + '-hint'"
                    class="m-0 max-w-prose text-hint text-pretty text-muted-foreground"
                  >
                    {{ words[f] }}
                  </p>
                </div>
                <div class="pt-0.5">
                  @if (hasSwitch(f)) {
                    <hlm-switch
                      [id]="'ask-feature-' + f"
                      [aria-describedby]="'ask-feature-' + f + '-hint'"
                      [checked]="d.spend.switches[f]"
                      (checkedChange)="patchSwitch(f, $event)"
                    />
                  }
                </div>
                @if (!hasSwitch(f) || d.spend.switches[f]) {
                  <div hlmField class="col-span-2 sm:col-span-1">
                    <label hlmFieldLabel [for]="'ask-cap-' + f"
                      >Daily cap<span class="sr-only"> for {{ label(f) }}</span> (USD)</label
                    >
                    <input
                      hlmInput
                      type="number"
                      inputmode="decimal"
                      autocomplete="off"
                      min="0.01"
                      max="100"
                      step="0.01"
                      placeholder="no cap"
                      [id]="'ask-cap-' + f"
                      [ngModel]="d.spend.caps[f]"
                      (ngModelChange)="patchCap(f, $event)"
                    />
                  </div>
                }
              </li>
            }
          </ul>
          <p class="m-0 max-w-prose text-hint text-pretty text-muted-foreground">
            An empty cap means none of its own: the feature stops at the reserve line, and Match a
            brief at the whole budget.
          </p>
        </section>

        <section class="flex flex-col gap-4" aria-labelledby="settings-visitors">
          <h2 id="settings-visitors" class="m-0 text-section-title">What visitors read</h2>
          <div class="grid gap-4 lg:grid-cols-2">
            @for (locale of locales; track locale) {
              <div hlmField>
                <label hlmFieldLabel [for]="'ask-suggest-' + locale"
                  >Suggested questions in {{ language[locale] }}</label
                >
                <textarea
                  hlmTextarea
                  autocomplete="off"
                  rows="4"
                  [attr.lang]="locale"
                  [id]="'ask-suggest-' + locale"
                  [aria-describedby]="'ask-suggest-hint'"
                  [ngModel]="d.suggestions[locale]"
                  (ngModelChange)="patchLocale('suggestions', locale, $event)"
                ></textarea>
              </div>
            }
            @for (locale of locales; track locale) {
              <div hlmField>
                <label hlmFieldLabel [for]="'ask-card-' + locale"
                  >How this assistant works, in {{ language[locale] }}</label
                >
                <textarea
                  hlmTextarea
                  autocomplete="off"
                  rows="6"
                  placeholder="Empty: the built-in description, which names the configured models."
                  [attr.lang]="locale"
                  [id]="'ask-card-' + locale"
                  [aria-describedby]="'ask-card-hint'"
                  [ngModel]="d.systemCard[locale]"
                  (ngModelChange)="patchLocale('systemCard', locale, $event)"
                ></textarea>
              </div>
            }
          </div>
          <p
            id="ask-suggest-hint"
            class="m-0 max-w-prose text-hint text-pretty text-muted-foreground"
          >
            Suggested questions: one a line, up to 6; the visitors' assistant offers them before the
            first question.
          </p>
          <p id="ask-card-hint" class="m-0 max-w-prose text-hint text-pretty text-muted-foreground">
            How this assistant works: cited when a visitor asks how it works.
          </p>
        </section>

        @if (env(); as e) {
          <section class="flex flex-col gap-2 text-sm" aria-labelledby="settings-deploy">
            <h2 id="settings-deploy" class="m-0 text-section-title">From the deploy, read-only</h2>
            <p class="m-0">
              The deploy switches the assistant {{ e.enabled ? "on" : "off" }} (<code translate="no"
                >SERVER_AI_ENABLED</code
              >). Gemini key {{ e.keys.gemini ? "set" : "missing" }}; OpenRouter key
              {{ e.keys.openrouter ? "set" : "missing" }}.
            </p>
            @if (e.unavailableReason) {
              <p class="m-0 text-destructive">It cannot answer: {{ e.unavailableReason }}.</p>
            }
            <dl class="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
              @for (r of roles; track r.role) {
                <dt class="text-muted-foreground">{{ r.name }}</dt>
                <dd class="m-0 font-data text-xs wrap-anywhere" translate="no">
                  {{ chain(e.chains[r.role]) }}
                </dd>
              }
            </dl>
            <p class="m-0 max-w-prose text-hint text-pretty text-muted-foreground">
              Each visitor may ask {{ e.limits.ratePerHour }} questions an hour and
              {{ e.limits.ratePerDay }} a day; {{ e.limits.maxConcurrent }} answers stream at once;
              an answer has at most {{ e.limits.maxOutputTokens }} tokens; the assistant remembers
              {{ e.limits.historyTurns }} turns. Prompt version
              <span class="font-data" translate="no">{{ e.prompt }}</span>.
            </p>
          </section>
        }
      </div>
      <app-save-bar
        [dirty]="dirty()"
        [saving]="saving()"
        [changes]="changes()"
        saveLabel="Save"
        hint="live at once"
        (save)="save()"
        (discard)="discard()"
      />
    }
  `,
})
export class AssistantSettingsComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly pulse = inject(AdminPulseService);

  protected readonly locales = LOCALES;
  protected readonly language = LANGUAGE;
  protected readonly roles = ROLES;
  protected readonly String = String;
  protected readonly capped = CAPPED;
  protected readonly words = FEATURE_WORDS;
  protected readonly hasSwitch = hasSwitch;
  protected readonly label = featureLabel;

  private readonly saved = signal<SettingsDraft | null>(null);
  protected readonly draft = signal<SettingsDraft | null>(null);
  protected readonly env = signal<AssistantEnv | null>(null);
  /** The API's reason when the settings did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly dirty = computed(
    () => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()),
  );
  protected readonly changes = computed(() => countChangedFields(this.saved(), this.draft()));

  /** "$2.00": the budget an empty field leaves to the deploy. */
  protected readonly deployBudget = computed(() => {
    const deploy = this.env()?.defaultBudgetUsd;
    return deploy === undefined ? "default" : usd(deploy);
  });

  /** Where the admin's tools stop, worked out from the two fields as typed: "$1.00 of $2.00". */
  protected readonly reserveLine = computed(() => {
    const d = this.draft();
    const typed = d && d.budget.trim() !== "" ? Number(d.budget) : this.env()?.defaultBudgetUsd;
    const reserve = d && d.spend.reserve.trim() !== "" ? Number(d.spend.reserve) / 100 : Number.NaN;
    // NaN fails every comparison: a field mid-edit says the line in words only.
    const known = typed !== undefined && typed > 0 && reserve >= 0 && reserve <= 0.9;
    if (!known) {
      return "the rest of the budget";
    }
    return `${usd(typed * (1 - reserve))} of ${usd(typed)}`;
  });

  constructor() {
    const unsaved = inject(UnsavedChangesService);
    effect(() => unsaved.set("assistant-settings", this.dirty()));
    inject(DestroyRef).onDestroy(() => unsaved.clear("assistant-settings"));
    inject(RecoveryService).track({
      editor: "assistant-settings",
      saved: this.saved,
      current: this.draft,
      restore: (draft) => this.draft.set(draft),
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected reload(): void {
    this.loadError.set(null);
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.assistantSettings();
    if (!result.ok) {
      // With settings on screen (a reload after a save), a toast; before, the page says so.
      if (this.draft()) {
        toast.error("Could not load the settings", { description: apiWords(result.error) });
      } else {
        this.loadError.set(result.error);
      }
      return;
    }
    const draft = toDraft(result.data.settings);
    this.saved.set(draft);
    this.draft.set(structuredClone(draft));
    this.env.set(result.data.env);
  }

  /** A chain in words: "gemini-flash-lite, then gemini-flash (not available)". */
  protected chain(models: readonly ChainModel[]): string {
    if (models.length === 0) {
      return "none";
    }
    return models.map((m) => (m.available ? m.id : `${m.id} (not available)`)).join(", then ");
  }

  protected patch(values: Partial<SettingsDraft>): void {
    this.draft.update((d) => (d ? { ...d, ...values } : d));
  }

  protected patchLocale(key: "suggestions" | "systemCard", locale: Locale, value: string): void {
    this.draft.update((d) => (d ? { ...d, [key]: { ...d[key], [locale]: value } } : d));
  }

  protected patchSpend(values: Partial<SpendDraft>): void {
    this.draft.update((d) => (d ? { ...d, spend: { ...d.spend, ...values } } : d));
  }

  protected patchSwitch(feature: string, on: boolean): void {
    this.draft.update((d) =>
      d ? { ...d, spend: { ...d.spend, switches: { ...d.spend.switches, [feature]: on } } } : d,
    );
  }

  /** A number input reports null when emptied. */
  protected patchCap(feature: string, value: number | string | null): void {
    const text = value === null ? "" : String(value);
    this.draft.update((d) =>
      d ? { ...d, spend: { ...d.spend, caps: { ...d.spend.caps, [feature]: text } } } : d,
    );
  }

  protected discard(): void {
    const edits = this.draft();
    const saved = this.saved();
    if (saved) {
      this.draft.set(structuredClone(saved));
    }
    toastDiscarded(() => this.draft.set(edits));
  }

  /**
   * Everything here is live once saved, so a save says what goes live and asks first. Cancel,
   * Escape and a click outside send nothing and keep the draft; the dialog gives the focus back.
   */
  protected async save(): Promise<void> {
    const d = this.draft();
    const saved = this.saved();
    if (!d || !saved) {
      return;
    }
    const input = settingsInput(d);
    if (!input.ok) {
      toast.error(input.error);
      return;
    }
    const changes = liveChanges(saved, d, this.env()?.defaultBudgetUsd ?? null);
    if (changes.length > 0) {
      const go = await this.confirm.ask({
        title: "Put these changes live?",
        description: "Settings apply as soon as they are saved; there is no publish step.",
        items: changes,
        confirmLabel: "Save and go live",
      });
      if (!go) {
        return;
      }
    }
    this.saving.set(true);
    const result = await this.api.saveAssistantSettings(input.value);
    this.saving.set(false);
    if (!result.ok) {
      toastNotSaved(result.error);
      return;
    }
    const draft = toDraft(result.data.settings);
    this.saved.set(draft);
    this.draft.set(structuredClone(draft));
    toast.success("Saved and live now");
    // A switch or a cap moves what each feature may spend: the paid buttons follow at once.
    void this.pulse.refresh(["assistant"]);
  }
}
