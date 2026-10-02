import { DecimalPipe } from "@angular/common";
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
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import type { Locale } from "../../content/schema";
import { FormSkeletonComponent, LoadErrorComponent } from "../components/load-state.component";
import { AdminApiService } from "../admin-api.service";
import type { AssistantEnv, AssistantSettings, AssistantSettingsInput } from "../assistant-types";
import { countChangedFields } from "../changed-fields";
import { SaveBarComponent } from "../components/editor-chrome.component";
import {
  CAPPED,
  featureLabel,
  spendDraft,
  spendInput,
  SWITCHES,
  type SpendDraft,
} from "../spending";
import { UnsavedChangesService } from "../unsaved-changes.service";

const LOCALES: Locale[] = ["en", "de"];

interface Draft {
  enabled: boolean;
  budget: string;
  deepEnabled: boolean;
  suggestions: Record<Locale, string>;
  systemCard: Record<Locale, string>;
  spend: SpendDraft;
}

function toDraft(s: AssistantSettings): Draft {
  return {
    enabled: s.enabled,
    budget: s.dailyBudgetUsd === null ? "" : String(s.dailyBudgetUsd),
    deepEnabled: s.deepEnabled,
    suggestions: { en: s.suggestedQuestions.en.join("\n"), de: s.suggestedQuestions.de.join("\n") },
    systemCard: { ...s.systemCard },
    spend: spendDraft(s),
  };
}

/**
 * What can change without a deploy: the admin's switch, the daily budget, the
 * deep model, what the rest may spend of it, suggested questions, and the "how
 * this assistant works" text. Live on save (no publish). Below, read-only,
 * what the deploy configured.
 */
@Component({
  selector: "app-assistant-settings",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    FormsModule,
    HlmBadge,
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
      <div class="flex flex-col gap-6">
        <!-- Each switch: its label names it, the hint describes it (admin-ui rule). -->
        <div class="flex items-center gap-3 text-sm">
          <hlm-switch
            id="ask-enabled"
            aria-describedby="ask-enabled-hint"
            [checked]="d.enabled"
            (checkedChange)="patch({ enabled: $event })"
          />
          <div>
            <label for="ask-enabled">Assistant on</label>
            <p id="ask-enabled-hint" class="m-0 text-xs text-muted-foreground">
              Off, visitors get the offline shell. The playground and evals still work.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3 text-sm">
          <hlm-switch
            id="ask-deep"
            aria-describedby="ask-deep-hint"
            [checked]="d.deepEnabled"
            (checkedChange)="patch({ deepEnabled: $event })"
          />
          <div>
            <label for="ask-deep">Deep model for comparisons and architecture questions</label>
            <p id="ask-deep-hint" class="m-0 text-xs text-muted-foreground">
              Switches itself off for the rest of the day at 80 % of the budget.
            </p>
          </div>
        </div>

        <div hlmField class="max-w-xs">
          <label hlmFieldLabel for="ask-budget">Daily budget (USD)</label>
          <input
            hlmInput
            id="ask-budget"
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            [placeholder]="'default: ' + (env()?.defaultBudgetUsd ?? '')"
            [ngModel]="d.budget"
            (ngModelChange)="patch({ budget: $event === null ? '' : String($event) })"
          />
          <p class="m-0 text-xs text-muted-foreground">
            The visitors' terminal may spend all of it; everything else stops at the line below.
            Empty = the deploy's default.
          </p>
        </div>

        <fieldset class="flex flex-col gap-4 rounded-lg border border-border p-4">
          <legend class="px-1 text-sm font-medium">Spending</legend>
          <div hlmField class="max-w-xs">
            <label hlmFieldLabel for="ask-reserve">Kept for visitors (% of the budget)</label>
            <input
              hlmInput
              id="ask-reserve"
              type="number"
              min="0"
              max="90"
              step="1"
              aria-describedby="ask-reserve-hint"
              [ngModel]="d.spend.reserve"
              (ngModelChange)="patchSpend({ reserve: $event === null ? '' : String($event) })"
            />
            <p id="ask-reserve-hint" class="m-0 text-xs text-muted-foreground">
              The copilot, insights, the playground and runs stop once the day's spend reaches the
              rest, so they cannot put visitors into "resting". At 0 % they may spend the whole
              budget.
            </p>
          </div>
          @for (s of switches; track s.feature) {
            <div class="flex items-center gap-3 text-sm">
              <hlm-switch
                [id]="'ask-feature-' + s.feature"
                [aria-describedby]="'ask-feature-' + s.feature + '-hint'"
                [checked]="d.spend.switches[s.feature]"
                (checkedChange)="patchSwitch(s.feature, $event)"
              />
              <div>
                <label [for]="'ask-feature-' + s.feature">{{ s.label }}</label>
                <p
                  [id]="'ask-feature-' + s.feature + '-hint'"
                  class="m-0 text-xs text-muted-foreground"
                >
                  {{ s.hint }}
                </p>
              </div>
            </div>
          }
          <!-- The legend names what each field is: a cap, in USD, per day. -->
          <fieldset class="flex flex-col gap-2">
            <legend class="text-sm">Daily cap per feature (USD)</legend>
            <p class="m-0 text-xs text-muted-foreground">Empty = only the reserve line.</p>
            <div class="grid gap-3 sm:grid-cols-3">
              @for (f of capped; track f) {
                <div hlmField>
                  <label hlmFieldLabel [for]="'ask-cap-' + f">{{ label(f) }}</label>
                  <input
                    hlmInput
                    type="number"
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
            </div>
          </fieldset>
        </fieldset>

        @for (locale of locales; track locale) {
          <fieldset class="flex flex-col gap-3 rounded-lg border border-border p-4">
            <legend class="px-1 font-mono text-xs uppercase text-muted-foreground">
              {{ locale }}
            </legend>
            <div hlmField>
              <label hlmFieldLabel [for]="'ask-suggest-' + locale"
                >Suggested questions (one per line, up to 6)</label
              >
              <textarea
                hlmTextarea
                rows="4"
                [id]="'ask-suggest-' + locale"
                [ngModel]="d.suggestions[locale]"
                (ngModelChange)="patchLocale('suggestions', locale, $event)"
              ></textarea>
            </div>
            <div hlmField>
              <label hlmFieldLabel [for]="'ask-card-' + locale"
                >How this assistant works (cited when asked)</label
              >
              <textarea
                hlmTextarea
                rows="6"
                [id]="'ask-card-' + locale"
                placeholder="Empty: the built-in description, which names the configured models."
                [ngModel]="d.systemCard[locale]"
                (ngModelChange)="patchLocale('systemCard', locale, $event)"
              ></textarea>
            </div>
          </fieldset>
        }

        @if (env(); as e) {
          <section
            class="flex flex-col gap-3 rounded-lg border border-dashed border-border p-4 text-sm"
          >
            <h2 class="m-0 text-sm font-medium">From the deploy (.env)</h2>
            <p class="m-0 flex flex-wrap gap-2">
              <span hlmBadge [variant]="e.enabled ? 'default' : 'destructive'"
                >SERVER_AI_ENABLED={{ e.enabled }}</span
              >
              <span hlmBadge [variant]="e.keys.gemini ? 'outline' : 'destructive'"
                >Gemini key {{ e.keys.gemini ? "set" : "missing" }}</span
              >
              <span hlmBadge [variant]="e.keys.openrouter ? 'outline' : 'secondary'"
                >OpenRouter key {{ e.keys.openrouter ? "set" : "missing" }}</span
              >
            </p>
            @if (e.unavailableReason) {
              <p class="m-0 text-destructive">Unavailable: {{ e.unavailableReason }}</p>
            }
            @for (role of roles; track role) {
              <div>
                <p class="m-0 text-xs text-muted-foreground">{{ role }}</p>
                <p class="m-0 font-mono text-xs">
                  @for (m of e.chains[role]; track m.id; let last = $last) {
                    <span
                      [class.line-through]="!m.available"
                      [title]="
                        (m.contextWindow | number) +
                        ' tokens' +
                        (m.tools ? ', tools' : ', no tools')
                      "
                      >{{ m.id }}</span
                    >
                    @if (!last) {
                      <span class="text-muted-foreground"> → </span>
                    }
                  } @empty {
                    <span class="text-muted-foreground">none</span>
                  }
                </p>
              </div>
            }
            <p class="m-0 text-xs text-muted-foreground">
              {{ e.limits.ratePerHour }}/h and {{ e.limits.ratePerDay }}/day per visitor ·
              {{ e.limits.maxConcurrent }} streams at once · {{ e.limits.maxOutputTokens }} output
              tokens · {{ e.limits.historyTurns }} turns of memory · prompt {{ e.prompt }}
            </p>
          </section>
        }
      </div>
      <app-save-bar
        [dirty]="dirty()"
        [saving]="saving()"
        [changes]="changes()"
        saveLabel="Save"
        hint="live immediately, no publish needed"
        (save)="save()"
        (discard)="discard()"
      />
    }
  `,
})
export class AssistantSettingsComponent implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly locales = LOCALES;
  protected readonly roles = ["lite", "deep", "copilot", "insight"] as const;
  protected readonly String = String;
  protected readonly capped = CAPPED;
  protected readonly switches = SWITCHES;
  protected readonly label = featureLabel;

  private readonly saved = signal<Draft | null>(null);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly env = signal<AssistantEnv | null>(null);
  /** The API's reason when the settings did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly dirty = computed(
    () => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()),
  );
  protected readonly changes = computed(() => countChangedFields(this.saved(), this.draft()));

  constructor() {
    const unsaved = inject(UnsavedChangesService);
    effect(() => unsaved.set("assistant-settings", this.dirty()));
    inject(DestroyRef).onDestroy(() => unsaved.clear("assistant-settings"));
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
      if (this.draft()) toast.error("Could not load the settings", { description: result.error });
      else this.loadError.set(result.error);
      return;
    }
    const draft = toDraft(result.data.settings);
    this.saved.set(draft);
    this.draft.set(structuredClone(draft));
    this.env.set(result.data.env);
  }

  protected patch(values: Partial<Draft>): void {
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
    const saved = this.saved();
    if (saved) this.draft.set(structuredClone(saved));
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d) return;
    const budget = d.budget.trim() === "" ? null : Number(d.budget);
    if (budget !== null && !(budget >= 0.01 && budget <= 100)) {
      toast.error("The budget must be between 0.01 and 100 USD, or empty");
      return;
    }
    const spend = spendInput(d.spend);
    if (!spend.ok) {
      toast.error(spend.error);
      return;
    }
    const lines = (text: string) =>
      text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length >= 3)
        .slice(0, 6);
    const input: AssistantSettingsInput = {
      enabled: d.enabled,
      dailyBudgetUsd: budget,
      deepEnabled: d.deepEnabled,
      suggestedQuestions: { en: lines(d.suggestions.en), de: lines(d.suggestions.de) },
      systemCard: { en: d.systemCard.en.trim(), de: d.systemCard.de.trim() },
      ...spend.value,
    };
    this.saving.set(true);
    const result = await this.api.saveAssistantSettings(input);
    this.saving.set(false);
    if (!result.ok) {
      toast.error("Not saved", { description: result.error });
      return;
    }
    const draft = toDraft(result.data.settings);
    this.saved.set(draft);
    this.draft.set(structuredClone(draft));
    toast.success("Saved — live now");
  }
}
