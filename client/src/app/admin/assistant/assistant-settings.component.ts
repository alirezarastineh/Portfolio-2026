import { DecimalPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import type { Locale } from "../../content/schema";
import { AdminApiService } from "../admin-api.service";
import type { AssistantEnv, AssistantSettings, AssistantSettingsInput } from "../assistant-types";
import { SaveBarComponent } from "../components/editor-chrome.component";

const LOCALES: Locale[] = ["en", "de"];

interface Draft {
  enabled: boolean;
  budget: string;
  deepEnabled: boolean;
  suggestions: Record<Locale, string>;
  systemCard: Record<Locale, string>;
}

function toDraft(s: AssistantSettings): Draft {
  return {
    enabled: s.enabled,
    budget: s.dailyBudgetUsd === null ? "" : String(s.dailyBudgetUsd),
    deepEnabled: s.deepEnabled,
    suggestions: { en: s.suggestedQuestions.en.join("\n"), de: s.suggestedQuestions.de.join("\n") },
    systemCard: { ...s.systemCard },
  };
}

/**
 * What can change without a deploy: the admin's switch, the daily budget, the
 * deep model, suggested questions, and the "how this assistant works" text.
 * Live on save (no publish). Below, read-only, what the deploy configured.
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
    HlmSkeleton,
    HlmSwitch,
    HlmTextarea,
    SaveBarComponent,
  ],
  host: { class: "block" },
  template: `
    @if (!draft()) {
      <hlm-skeleton class="h-64 w-full" />
    } @else {
      @let d = draft()!;
      <div class="flex flex-col gap-6">
        <label class="flex items-center gap-3 text-sm">
          <hlm-switch [checked]="d.enabled" (checkedChange)="patch({ enabled: $event })" />
          <span>
            Assistant on
            <span class="block text-xs text-muted-foreground">
              Off, visitors get the offline shell. The playground and evals still work.
            </span>
          </span>
        </label>

        <label class="flex items-center gap-3 text-sm">
          <hlm-switch [checked]="d.deepEnabled" (checkedChange)="patch({ deepEnabled: $event })" />
          <span>
            Deep model for comparisons and architecture questions
            <span class="block text-xs text-muted-foreground">
              Switches itself off for the rest of the day at 80 % of the budget.
            </span>
          </span>
        </label>

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
            Shared by the terminal, the copilot, insights and evals. Empty = the deploy's default.
          </p>
        </div>

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
        saveLabel="Save"
        hint="saved — live immediately, no publish needed"
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

  private readonly saved = signal<Draft | null>(null);
  protected readonly draft = signal<Draft | null>(null);
  protected readonly env = signal<AssistantEnv | null>(null);
  protected readonly saving = signal(false);
  protected readonly dirty = computed(
    () => JSON.stringify(this.draft()) !== JSON.stringify(this.saved()),
  );

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.assistantSettings();
    if (!result.ok) {
      toast.error("Could not load the settings", { description: result.error });
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
