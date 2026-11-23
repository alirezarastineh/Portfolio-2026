import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
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
import { sameValue } from "../changed-fields";
import { LoadErrorComponent } from "../components/load-state.component";
import { MOD } from "../components/shortcut-sheet.component";
import { decisionKey, focusOnLeaving } from "../decision-keys";
import { RecoveryService, type RecoveryHandle } from "../recovery.service";
import { UnsavedChangesService } from "../unsaved-changes.service";
import {
  acceptBody,
  acceptForm,
  acceptProblem,
  faqProposalWords,
  lessonExample,
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
  imports: [
    FormsModule,
    HlmBadge,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmTextarea,
    LoadErrorComponent,
  ],
  host: { class: "block", "(document:keydown)": "onKeydown($event)" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="faq-proposals-title" data-queue>
      <!-- The tab's first heading under the page's: a level 2, as the other tabs' sections. -->
      <h2 id="faq-proposals-title" tabindex="-1" class="m-0 text-sm font-medium outline-none">
        Proposals
      </h2>
      <p class="m-0 text-hint text-muted-foreground">
        Drafted from a topic in Insights or an entry in the Journal: the question, an answer from
        the portfolio only, and both in German. Nothing is used until you accept one; accepting
        saves your text as an FAQ entry, used at once.
      </p>
      <p class="m-0 text-hint text-muted-foreground pointer-coarse:hidden">
        J and K move, A accepts, X rejects, {{ mod }} ↵ accepts from a field.
      </p>
      @if (error(); as reason) {
        <app-load-error
          compact
          title="Could not load the FAQ proposals"
          [reason]="reason"
          (retry)="retry.emit()"
        />
      }
      @for (p of shown(); track p.id) {
        @let f = formOf(p);
        @let id = "faq-proposal-" + p.id;
        <article
          class="flex flex-col gap-3 rounded-lg border border-border p-4 text-sm"
          [attr.aria-labelledby]="id"
          data-decide
          data-waiting
        >
          <div class="flex flex-wrap items-center gap-2">
            <!-- J and K land here: the ring shows which proposal A and X act on. -->
            <h3 [id]="id" tabindex="-1" class="m-0 text-sm font-medium" data-decide-heading>
              {{ source(p) }}
            </h3>
            <span hlmBadge variant="outline">{{ status(p) }}</span>
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
              <legend class="mb-1 text-xs font-medium text-muted-foreground">
                {{ locale.toUpperCase() }}
              </legend>
              <div hlmField>
                <label hlmFieldLabel [for]="id + '-q-' + locale">Question</label>
                <input
                  hlmInput
                  maxlength="300"
                  data-decide-field
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
                  data-decide-field
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
                class="h-9 pointer-coarse:h-11 max-w-full rounded-lg border border-input-line bg-card px-2 text-foreground text-sm pointer-coarse:text-base"
                [attr.aria-describedby]="p.newLesson ? id + '-measure-hint' : null"
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
              <p [id]="id + '-measure-hint'" class="m-0 text-muted-foreground">
                No new lesson from here: {{ reason }}.
              </p>
            }
            @if (f.measure === "new") {
              <div hlmField>
                <label hlmFieldLabel [for]="id + '-statement'">The lesson, in your words</label>
                <textarea
                  hlmTextarea
                  rows="2"
                  maxlength="500"
                  data-decide-field
                  [id]="id + '-statement'"
                  [aria-describedby]="id + '-statement-hint'"
                  [ngModel]="f.statement"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="update(p, { statement: $event })"
                ></textarea>
              </div>
              <p [id]="id + '-statement-hint'" class="m-0 text-muted-foreground">
                A rule someone can follow, at least 8 words: when it applies and what it does. For
                example: “{{ example(p) }}”
              </p>
              <div hlmField>
                <label hlmFieldLabel [for]="id + '-scope'">Words its questions contain</label>
                <input
                  hlmInput
                  data-decide-field
                  [id]="id + '-scope'"
                  [aria-describedby]="id + '-scope-hint'"
                  [ngModel]="f.scope"
                  [ngModelOptions]="{ standalone: true }"
                  (ngModelChange)="update(p, { scope: $event })"
                />
              </div>
              <p [id]="id + '-scope-hint'" class="m-0 text-muted-foreground">
                Its effect is measured on visitors' questions with these words: how often the
                assistant could not answer before the entry, and since.
              </p>
            }
          </div>
          <!-- Always there, so Accept is described by what still stops it (empty when nothing). -->
          <p [id]="id + '-problem'" class="m-0 text-xs text-accent-orange">{{ problem(p) }}</p>
          <div class="flex flex-wrap gap-2">
            <!-- A stop, not disabled, while something stops it: A and a click say what. -->
            <button
              hlmBtn
              size="sm"
              type="button"
              class="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              data-key="a"
              aria-keyshortcuts="A Control+Enter Meta+Enter"
              [attr.aria-describedby]="id + ' ' + id + '-problem'"
              [attr.aria-disabled]="problem(p) ? 'true' : null"
              [disabled]="!!busy()"
              (click)="accept(p)"
            >
              Accept
              <kbd
                class="inline-flex items-center rounded-sm border border-current/30 px-1.5 py-px font-data text-xs pointer-coarse:hidden"
                aria-hidden="true"
                >A</kbd
              >
            </button>
            <button
              hlmBtn
              variant="ghost"
              size="sm"
              type="button"
              data-key="x"
              aria-keyshortcuts="X"
              [attr.aria-describedby]="id"
              [disabled]="!!busy()"
              (click)="reject(p)"
            >
              Reject
              <kbd
                class="inline-flex items-center rounded-sm border border-current/30 px-1.5 py-px font-data text-xs pointer-coarse:hidden"
                aria-hidden="true"
                >X</kbd
              >
            </button>
          </div>
        </article>
      } @empty {
        @if (!error()) {
          <!-- Also the done line: the last decision gives it the focus. -->
          <p
            id="faq-proposals-done"
            tabindex="-1"
            class="m-0 text-sm text-muted-foreground"
            data-queue-done
          >
            No proposals wait for you. Draft one from a topic in Insights or an entry in the
            Journal.
          </p>
        }
      }
      <!-- Always in the page, so what is put in it is announced. -->
      <p class="sr-only" aria-live="polite">{{ said() }}</p>
    </section>
  `,
})
export class FaqProposalsComponent {
  private readonly api = inject(AdminApiService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The open proposals, newest first. */
  readonly proposals = input.required<FaqProposal[]>();
  /** One to show first: just drafted from Insights or the Journal. */
  readonly focus = input<string | null>(null);
  /** Why the proposals did not load: the API's code, said in words in the list's place. */
  readonly error = input<string | null>(null);
  /** Accepted or rejected: the FAQ tab reads the entries and the proposals again. */
  readonly decided = output();
  /** Try again on a failed load. */
  readonly retry = output();

  protected readonly mod = MOD;
  /** Decided here: out of the list at once, before the FAQ tab's read brings the rest. */
  private readonly left = signal<ReadonlySet<string>>(new Set());
  protected readonly shown = computed(() => this.proposals().filter((p) => !this.left().has(p.id)));
  protected readonly locales: Locale[] = ["en", "de"];
  protected readonly source = sourceLine;
  protected readonly status = (p: FaqProposal) => proposalStatusName(p.status);
  protected readonly choices = measureChoices;
  protected readonly example = lessonExample;
  /** A decision in flight: the proposal's id. */
  protected readonly busy = signal<string | null>(null);
  protected readonly said = signal("");
  /** The admin's edits, by proposal; a proposal not edited shows its drafts. */
  private readonly forms = signal<Record<string, AcceptForm>>({});
  /** The drafted proposal focused already: the list read again later leaves focus where it is. */
  private focused: string | null = null;
  /** Left (another tab): a decision answered meanwhile is only told in a toast. */
  private gone = false;
  private readonly backup: RecoveryHandle;

  constructor() {
    const unsaved = inject(UnsavedChangesService);
    // An edited proposal not yet decided (one whose decision is on its way is not): switching
    // views asks first.
    effect(() =>
      unsaved.set(
        "faq-proposals",
        this.proposals().some(
          (p) => p.id !== this.busy() && !sameValue(this.formOf(p), acceptForm(p)),
        ),
      ),
    );
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      unsaved.clear("faq-proposals");
    });
    // Each proposal's edits by its id; nothing is looked for before the list is in.
    this.backup = inject(RecoveryService).track({
      editor: "faq-proposals",
      rows: true,
      saved: () => {
        const list = this.proposals();
        return list.length ? Object.fromEntries(list.map((p) => [p.id, acceptForm(p)])) : null;
      },
      current: () => Object.fromEntries(this.proposals().map((p) => [p.id, this.formOf(p)])),
      restore: (forms) => this.forms.set(forms),
    });
    // A proposal just drafted elsewhere: its heading takes focus once it is listed, once.
    effect(() => {
      const id = this.focus();
      if (!id || id === this.focused || !this.proposals().some((p) => p.id === id)) {
        return;
      }
      this.focused = id;
      untracked(() =>
        afterNextRender(() => document.getElementById(`faq-proposal-${id}`)?.focus(), {
          injector: this.injector,
        }),
      );
    });
  }

  /** J, K, A, X and Ctrl/⌘ Enter on the proposals (plan 5, U21). */
  protected onKeydown(event: KeyboardEvent): void {
    decisionKey(event, this.host.nativeElement);
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
    // A stop says what still stops it and sends nothing.
    const problem = acceptProblem(form);
    if (problem) {
      this.said.set(problem);
      return;
    }
    const leave = focusOnLeaving(`faq-proposal-${p.id}`);
    this.busy.set(p.id);
    const result = await this.api.acceptFaqProposal(p.id, acceptBody(form));
    this.busy.set(null);
    if (!result.ok) {
      this.refused(result.error, result.detail);
      return;
    }
    const measured = result.data.linked.lesson ? "; a lesson measures it" : "";
    this.done(`Accepted: it is an FAQ entry now, used at once${measured}.`, p, leave);
  }

  protected async reject(p: FaqProposal): Promise<void> {
    const leave = focusOnLeaving(`faq-proposal-${p.id}`);
    this.busy.set(p.id);
    const result = await this.api.rejectFaqProposal(p.id);
    this.busy.set(null);
    if (!result.ok) {
      this.refused(result.error, result.detail);
      return;
    }
    this.done("Rejected: nothing reached the FAQ.", p, leave);
  }

  private refused(error: string, detail: unknown): void {
    const words = faqProposalWords(error, detail);
    toast.error("Not done", { description: words });
    if (this.gone) {
      return;
    }
    this.said.set(`Not done: ${words}`);
    // Decided elsewhere, or gone: the list is read again, and the card with the button goes.
    if (error === "not_open" || error === "not_found") {
      this.decided.emit();
      this.focusList();
    }
  }

  /** Decided: the proposal leaves the list, the next that waits takes the focus, else the done line. */
  private done(words: string, p: FaqProposal, leave: () => void): void {
    this.backup.drop(p.id);
    if (this.gone) {
      toast.success(words);
      return;
    }
    this.said.set(words);
    this.forms.update((all) => {
      const rest = { ...all };
      delete rest[p.id];
      return rest;
    });
    this.left.update((ids) => new Set([...ids, p.id]));
    this.decided.emit();
    afterNextRender(leave, { injector: this.injector });
  }

  private focusList(): void {
    afterNextRender(() => document.getElementById("faq-proposals-title")?.focus(), {
      injector: this.injector,
    });
  }
}
