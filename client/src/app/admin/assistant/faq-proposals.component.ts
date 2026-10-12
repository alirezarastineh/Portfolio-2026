import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import type { Locale } from "../../content/schema";
import { AdminApiService } from "../admin-api.service";
import {
  acceptBody,
  acceptForm,
  acceptProblem,
  faqProposalWords,
  measureChoices,
  proposalStatusName,
  sourceLine,
  type AcceptForm,
  type FaqProposal,
} from "../faq-proposals";

/**
 * The FAQ pipeline's open proposals (plan phase 31), in the FAQ tab: each
 * drafted entry with where it came from, its notes (a content gap, a step not
 * drafted, a check still failing), its texts to edit, and how its effect is
 * measured (a lesson from its source, a new one, or none). Accept saves the
 * admin's text as an FAQ entry, used at once; reject closes it.
 */
@Component({
  selector: "app-faq-proposals",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, HlmBadge, HlmButton, HlmField, HlmFieldLabel, HlmInput, HlmTextarea],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="faq-proposals-title">
      <!-- The tab's first heading under the page's: a level 2, as the other tabs' sections. -->
      <h2 id="faq-proposals-title" tabindex="-1" class="m-0 text-sm font-medium outline-none">
        Proposals
      </h2>
      <p class="m-0 text-xs text-muted-foreground">
        Drafted from a topic in Insights or an entry in the Journal: the question, an answer from
        the portfolio only, and both in German. Nothing is used until you accept one; accepting
        saves your text as an FAQ entry, used at once.
      </p>
      @for (p of proposals(); track p.id) {
        @let f = formOf(p);
        @let id = "faq-proposal-" + p.id;
        <article
          class="flex flex-col gap-3 rounded-lg border border-border p-4 text-sm"
          [attr.aria-labelledby]="id"
        >
          <div class="flex flex-wrap items-center gap-2">
            <h3 [id]="id" tabindex="-1" class="m-0 text-sm font-medium outline-none">
              {{ source(p) }}
            </h3>
            <span hlmBadge variant="outline" class="font-mono text-xs">{{ status(p) }}</span>
          </div>
          @if (p.notes.length) {
            <ul class="m-0 flex list-disc flex-col gap-0.5 pl-5 text-xs text-accent-orange">
              @for (note of p.notes; track $index) {
                <li>{{ note }}</li>
              }
            </ul>
          }
          @for (locale of locales; track locale) {
            <fieldset class="m-0 flex flex-col gap-2 border-0 p-0">
              <legend class="mb-1 font-mono text-xs uppercase text-muted-foreground">
                {{ locale }}
              </legend>
              <div hlmField>
                <label hlmFieldLabel [for]="id + '-q-' + locale">Question</label>
                <input
                  hlmInput
                  maxlength="300"
                  [id]="id + '-q-' + locale"
                  [ngModel]="f.text[locale].question"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="setText(p, locale, 'question', $event)"
                />
              </div>
              <div hlmField>
                <label hlmFieldLabel [for]="id + '-a-' + locale">Answer</label>
                <textarea
                  hlmTextarea
                  rows="3"
                  maxlength="3000"
                  [id]="id + '-a-' + locale"
                  [ngModel]="f.text[locale].answer"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="setText(p, locale, 'answer', $event)"
                ></textarea>
              </div>
            </fieldset>
          }
          <label class="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              class="size-4 accent-foreground"
              [checked]="f.visible"
              (change)="update(p, { visible: $any($event.target).checked })"
            />
            Used by the assistant once accepted
          </label>
          <div class="flex flex-col gap-2 text-xs">
            <label class="flex flex-col gap-1">
              <span class="text-muted-foreground">Measure its effect</span>
              <select
                class="h-8 max-w-full rounded-md border border-border bg-background px-2 text-foreground"
                [ngModel]="f.measure"
                [ngModelOptions]="{ standalone: true }"
                (ngModelChange)="update(p, { measure: $event })"
              >
                @for (choice of choices(p); track choice.value) {
                  <option [value]="choice.value">{{ choice.label }}</option>
                }
              </select>
            </label>
            @if (p.newLesson; as reason) {
              <p class="m-0 text-muted-foreground">No new lesson from here: {{ reason }}.</p>
            }
            @if (f.measure === "new") {
              <div hlmField>
                <label hlmFieldLabel [for]="id + '-statement'">The lesson, in your words</label>
                <textarea
                  hlmTextarea
                  rows="2"
                  maxlength="500"
                  [id]="id + '-statement'"
                  [ngModel]="f.statement"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="update(p, { statement: $event })"
                ></textarea>
              </div>
              <div hlmField>
                <label hlmFieldLabel [for]="id + '-scope'">Words its questions contain</label>
                <input
                  hlmInput
                  [id]="id + '-scope'"
                  [ngModel]="f.scope"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="update(p, { scope: $event })"
                />
              </div>
              <p class="m-0 text-muted-foreground">
                Its effect is measured on visitors' questions with these words: how often the
                assistant could not answer before the entry, and since.
              </p>
            }
          </div>
          @if (problem(p); as why) {
            <p class="m-0 text-xs text-accent-orange">{{ why }}</p>
          }
          <div class="flex flex-wrap gap-2">
            <button
              hlmBtn
              size="sm"
              type="button"
              [attr.aria-describedby]="id"
              [disabled]="!!busy() || !!problem(p)"
              (click)="accept(p)"
            >
              Accept
            </button>
            <button
              hlmBtn
              variant="ghost"
              size="sm"
              type="button"
              [attr.aria-describedby]="id"
              [disabled]="!!busy()"
              (click)="reject(p)"
            >
              Reject
            </button>
          </div>
        </article>
      } @empty {
        <p class="m-0 text-sm text-muted-foreground">
          No proposals wait for you. Draft one from a topic in Insights or an entry in the Journal.
        </p>
      }
      <!-- Always in the page, so what is put in it is announced. -->
      <p class="sr-only" aria-live="polite">{{ said() }}</p>
    </section>
  `,
})
export class FaqProposalsComponent {
  private readonly api = inject(AdminApiService);
  private readonly injector = inject(Injector);

  /** The open proposals, newest first. */
  readonly proposals = input.required<FaqProposal[]>();
  /** One to show first: just drafted from Insights or the Journal. */
  readonly focus = input<string | null>(null);
  /** Accepted or rejected: the FAQ tab reads the entries and the proposals again. */
  readonly decided = output<void>();

  protected readonly locales: Locale[] = ["en", "de"];
  protected readonly source = sourceLine;
  protected readonly status = (p: FaqProposal) => proposalStatusName(p.status);
  protected readonly choices = measureChoices;
  /** A decision in flight: the proposal's id. */
  protected readonly busy = signal<string | null>(null);
  protected readonly said = signal("");
  /** The admin's edits, by proposal; a proposal not edited shows its drafts. */
  private readonly forms = signal<Record<string, AcceptForm>>({});

  constructor() {
    // A proposal just drafted elsewhere: its heading takes focus once it is listed.
    effect(() => {
      const id = this.focus();
      if (!id || !this.proposals().some((p) => p.id === id)) return;
      untracked(() =>
        afterNextRender(() => document.getElementById(`faq-proposal-${id}`)?.focus(), {
          injector: this.injector,
        }),
      );
    });
  }

  protected formOf(p: FaqProposal): AcceptForm {
    return this.forms()[p.id] ?? acceptForm(p);
  }

  protected update(p: FaqProposal, change: Partial<AcceptForm>): void {
    this.forms.update((all) => ({ ...all, [p.id]: { ...this.formOf(p), ...change } }));
  }

  protected setText(
    p: FaqProposal,
    locale: Locale,
    key: "question" | "answer",
    value: string,
  ): void {
    const form = this.formOf(p);
    this.update(p, {
      text: { ...form.text, [locale]: { ...form.text[locale], [key]: value } },
    });
  }

  protected problem(p: FaqProposal): string | null {
    return acceptProblem(this.formOf(p));
  }

  protected async accept(p: FaqProposal): Promise<void> {
    const form = this.formOf(p);
    if (acceptProblem(form)) return;
    this.busy.set(p.id);
    const result = await this.api.acceptFaqProposal(p.id, acceptBody(form));
    this.busy.set(null);
    if (!result.ok) {
      this.refused(result.error, result.detail);
      return;
    }
    const measured = result.data.linked.lesson ? "; a lesson measures it" : "";
    this.done(`Accepted: it is an FAQ entry now, used at once${measured}.`, p);
  }

  protected async reject(p: FaqProposal): Promise<void> {
    this.busy.set(p.id);
    const result = await this.api.rejectFaqProposal(p.id);
    this.busy.set(null);
    if (!result.ok) {
      this.refused(result.error, result.detail);
      return;
    }
    this.done("Rejected: nothing reached the FAQ.", p);
  }

  private refused(error: string, detail: unknown): void {
    const words = faqProposalWords(error, detail);
    this.said.set(`Not done: ${words}`);
    toast.error("Not done", { description: words });
    // Decided elsewhere, or gone: the list is read again.
    if (error === "not_open" || error === "not_found") this.decided.emit();
  }

  /** Decided: the proposal leaves the list, so its heading's place goes to the list's. */
  private done(words: string, p: FaqProposal): void {
    this.said.set(words);
    this.forms.update((all) => {
      const rest = { ...all };
      delete rest[p.id];
      return rest;
    });
    this.decided.emit();
    afterNextRender(() => document.getElementById("faq-proposals-title")?.focus(), {
      injector: this.injector,
    });
  }
}
