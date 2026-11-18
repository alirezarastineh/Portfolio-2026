import { DOCUMENT } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Injector,
  model,
  output,
  signal,
  untracked,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDialogImports } from "@spartan-ng/helm/dialog";
import { HlmInput } from "@spartan-ng/helm/input";

import { AdminApiService, type DraftIssue, type PublishReview } from "../admin-api.service";
import { diffJson, type DiffEntry } from "../json-diff";
import { changeRows } from "../publish-summary";
import { findPlaceholders } from "../readiness";
import {
  LANGUAGE,
  nameChange,
  publicationProblem,
  publishRefusal,
  wordChanges,
} from "../review-words";
import { UnsavedChangesService, type EditorHandle } from "../unsaved-changes.service";
import { ChangeListComponent } from "./change-list.component";
import { FormSkeletonComponent, LoadErrorComponent } from "./load-state.component";
import type { Locale } from "../../content/schema";

/** Long values (a case study's body) are shown clipped in the data: it says what changed, not all of it. */
const CLIP = 400;

/** Placeholder fields named in the warning; Today's launch checklist lists them all. */
const PLACEHOLDER_PREVIEW = 5;

/** What the review says after it acted: the result, where the action happened. */
interface Outcome {
  heading: string;
  words: string;
  /** The publication a roll back would bring back; null when there is none to offer. */
  rollbackTo: number | null;
  refusal?: string;
}

const clip = (value: string | undefined) =>
  value !== undefined && value.length > CLIP ? `${value.slice(0, CLIP)}…` : value;

/** "Both languages are live.", or the one that is. */
function liveWords(published: readonly { locale: Locale }[]): string {
  return published.length === 1
    ? `${LANGUAGE[published[0]!.locale]} is live.`
    : "Both languages are live.";
}

/**
 * Publishing, reviewed first (plan 5, U16): what goes live in each language, in words and grouped by
 * the page that changes it, each with Open; or, when the draft cannot be published, its problems with
 * Fix. After Publish the dialog says "Published #13" and offers Roll back, until it is closed.
 */
@Component({
  selector: "app-publish-dialog",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ChangeListComponent,
    FormSkeletonComponent,
    HlmButton,
    HlmDialogImports,
    HlmInput,
    LoadErrorComponent,
    RouterLink,
  ],
  template: `
    <hlm-dialog
      [state]="open() ? 'open' : 'closed'"
      (stateChanged)="onState($event)"
      (closed)="afterClose()"
    >
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-3xl">
        <hlm-dialog-header>
          <h2 hlmDialogTitle data-review-title tabindex="-1" class="outline-none">
            Review and publish
          </h2>
          <p hlmDialogDescription>
            What goes live, in both languages. Nothing changes on the site until you press Publish.
          </p>
        </hlm-dialog-header>

        @if (outcome(); as done) {
          <section class="flex flex-col gap-1" aria-labelledby="publish-result">
            <h3
              id="publish-result"
              tabindex="-1"
              class="m-0 text-section-title text-foreground outline-none"
              [textContent]="done.heading"
            ></h3>
            <p class="m-0 text-sm" [textContent]="done.words"></p>
            @if (done.refusal) {
              <p class="m-0 text-sm text-destructive" role="alert" [textContent]="done.refusal"></p>
            }
          </section>
          <hlm-dialog-footer class="gap-2">
            @if (done.rollbackTo !== null) {
              <button
                hlmBtn
                variant="outline"
                type="button"
                [disabled]="rollingBack()"
                (click)="rollBack(done.rollbackTo)"
              >
                {{ rollingBack() ? "Rolling back…" : "Roll back to #" + done.rollbackTo }}
              </button>
            }
            <button hlmBtn type="button" (click)="open.set(false)">Close</button>
          </hlm-dialog-footer>
        } @else if (loading()) {
          <app-form-skeleton kind="list" [rows]="3" label="Loading the review…" />
        } @else if (review()) {
          @if (unsavedEditor(); as editor) {
            <div
              class="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-accent-orange py-1 pl-3"
              role="note"
            >
              <p class="m-0 min-w-0 flex-1 text-sm" [textContent]="unsavedWords(editor)"></p>
              <button
                hlmBtn
                variant="outline"
                size="sm"
                type="button"
                [disabled]="editor.saving()"
                (click)="saveEdits(editor)"
              >
                {{ editor.saving() ? "Saving…" : "Save" }}
              </button>
            </div>
          }
          @if (refusal(); as said) {
            <p class="m-0 text-sm text-destructive" role="alert" [textContent]="said"></p>
          }

          <div
            class="flex max-h-[55vh] min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-1"
          >
            @for (language of firstPublish(); track language) {
              <p class="m-0 text-sm text-muted-foreground">
                Nothing is live in {{ language }} yet: everything in it is new.
              </p>
            }

            @if (problems().length) {
              <section class="flex flex-col" aria-labelledby="publish-problems">
                <h3 id="publish-problems" class="m-0 pb-1.5 text-sm font-medium text-destructive">
                  Fix these first
                </h3>
                <ul class="m-0 flex list-none flex-col p-0" role="list">
                  @for (problem of problems(); track $index) {
                    <li class="flex min-w-0 items-start gap-3 border-t border-border py-2">
                      <p
                        class="m-0 min-w-0 flex-1 text-sm wrap-anywhere"
                        [textContent]="problem.words"
                      ></p>
                      @if (problem.open; as place) {
                        <a
                          class="inline-flex min-h-6 shrink-0 touch-manipulation items-center text-sm text-foreground underline underline-offset-4 pointer-coarse:min-h-11"
                          [routerLink]="place.path"
                          [queryParams]="place.query ?? null"
                          (click)="open.set(false)"
                          >Fix<span class="sr-only" [textContent]="' ' + problem.name"></span
                        ></a>
                      }
                    </li>
                  }
                </ul>
              </section>
            }

            @if (placeholders().length) {
              <div class="border-l-2 border-accent-orange py-1 pl-3" role="note">
                <p class="m-0 text-sm">
                  <strong class="font-medium">Visitors will see placeholder text</strong>
                  in {{ placeholders().length }}
                  {{ placeholders().length === 1 ? "field" : "fields" }}. Publishing is still
                  allowed.
                </p>
                <ul class="m-0 mt-1.5 flex list-none flex-col gap-1 p-0" role="list">
                  @for (hit of placeholders().slice(0, placeholderPreview); track $index) {
                    <li class="flex flex-wrap items-baseline gap-x-2">
                      <span class="font-data text-xs wrap-anywhere" translate="no">{{
                        hit.label
                      }}</span>
                      @if (hit.link) {
                        <a
                          class="inline-flex min-h-6 touch-manipulation items-center text-xs underline underline-offset-4"
                          [routerLink]="hit.link"
                          (click)="open.set(false)"
                          >Fix<span class="sr-only"> {{ hit.label }}</span></a
                        >
                      }
                    </li>
                  }
                </ul>
                @if (placeholders().length > placeholderPreview) {
                  <p class="m-0 mt-1 text-hint text-muted-foreground">
                    and {{ placeholders().length - placeholderPreview }} more: the launch checklist
                    on Today lists them all.
                  </p>
                }
              </div>
            }

            @if (groups().length) {
              <app-change-list [groups]="groups()" (opened)="open.set(false)" />
            } @else if (!problems().length && !firstPublish().length) {
              <p class="m-0 text-sm text-muted-foreground">
                Nothing to publish: the draft matches what is live.
              </p>
            }

            <details class="group text-sm">
              <summary
                class="min-h-6 cursor-pointer touch-manipulation text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
              >
                Show the data
              </summary>
              @for (side of data(); track side.locale) {
                <h4 class="m-0 mt-3 text-sm font-medium" [textContent]="side.language"></h4>
                <dl class="m-0 flex flex-col">
                  @for (entry of side.entries; track $index) {
                    <div class="flex min-w-0 flex-col gap-0.5 border-t border-border py-1.5">
                      <dt class="text-xs">
                        <span
                          class="font-data wrap-anywhere text-foreground"
                          translate="no"
                          [textContent]="entry.path"
                        ></span
                        >&ngsp;<span
                          class="text-muted-foreground"
                          [textContent]="entry.kind"
                        ></span>
                      </dt>
                      @if (entry.before !== undefined) {
                        <dd
                          class="m-0 text-hint whitespace-pre-wrap wrap-anywhere text-muted-foreground"
                          [textContent]="'Live: ' + entry.before"
                        ></dd>
                      }
                      @if (entry.after !== undefined) {
                        <dd
                          class="m-0 text-hint whitespace-pre-wrap wrap-anywhere text-foreground"
                          [textContent]="'Goes live: ' + entry.after"
                        ></dd>
                      }
                    </div>
                  }
                </dl>
              }
            </details>
          </div>

          <hlm-dialog-footer class="flex-col items-stretch gap-3 sm:flex-row sm:items-end">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <label for="publish-label" class="text-sm font-medium">Label</label>
              <input
                #labelInput
                id="publish-label"
                hlmInput
                class="w-full"
                maxlength="200"
                autocomplete="off"
                [aria-describedby]="'publish-label-hint'"
                [value]="label()"
                (input)="label.set(labelInput.value)"
                (keydown.enter)="onEnter($event)"
              />
              <p id="publish-label-hint" class="m-0 text-hint text-muted-foreground">
                Optional. History lists it beside the number.
              </p>
            </div>
            <div class="flex justify-end gap-2">
              <button hlmBtn variant="ghost" type="button" (click)="open.set(false)">Cancel</button>
              <button
                hlmBtn
                variant="signal"
                type="button"
                class="max-sm:flex-1"
                [disabled]="!canPublish() || publishing()"
                (click)="publish()"
              >
                {{ publishing() ? "Publishing…" : "Publish" }}
              </button>
            </div>
          </hlm-dialog-footer>
        } @else {
          <app-load-error compact title="Could not load the review" (retry)="load()" />
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export class PublishDialogComponent {
  private readonly api = inject(AdminApiService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private destroyed = false;
  /** Save was pressed in the note: the next write is its save, and the review is read again. */
  private awaitingSave = false;
  /** ...and when the note goes with it, the keyboard lands on the review's title. */
  private savedFromNote = false;

  protected readonly placeholderPreview = PLACEHOLDER_PREVIEW;

  readonly open = model(false);
  /** After a publish or a roll back that wrote something. */
  readonly published = output<void>();

  protected readonly loading = signal(false);
  protected readonly publishing = signal(false);
  protected readonly rollingBack = signal(false);
  protected readonly label = signal("");
  protected readonly refusal = signal<string | null>(null);
  protected readonly outcome = signal<Outcome | null>(null);
  protected readonly review = signal<PublishReview | null>(null);
  /** What was live when the review opened: a roll back's target. Undefined when it could not be read. */
  private readonly liveBefore = signal<number | null | undefined>(undefined);

  protected readonly canPublish = computed(() => this.review()?.canPublish === true);

  protected readonly firstPublish = computed(
    () =>
      this.review()
        ?.locales.filter((side) => side.draft && side.live === null)
        .map((side) => LANGUAGE[side.locale]) ?? [],
  );

  protected readonly groups = computed(() =>
    wordChanges(
      (this.review()?.locales ?? [])
        .filter((side) => side.draft && side.live !== null)
        .map((side) => ({
          locale: side.locale,
          before: side.live,
          after: side.draft,
          rows: changeRows(side.live, side.draft, side.docs ?? []),
        })),
    ),
  );

  /** The draft's problems in the same words, each with Fix. */
  protected readonly problems = computed(() =>
    (this.review()?.locales ?? []).flatMap((side) =>
      side.issues.map((issue) => {
        const named = nameChange(issue.label ?? issue.path.join("."), {
          locale: side.locale,
          before: side.live,
          after: side.draft ?? side.live,
        });
        const name = `${named.what} (${LANGUAGE[side.locale]})`;
        return { name, words: `${name}: ${issue.message}`, open: named.open };
      }),
    ),
  );

  protected readonly placeholders = computed(() =>
    (this.review()?.locales ?? []).flatMap((side) =>
      side.draft && !side.issues.length ? findPlaceholders(side.draft) : [],
    ),
  );

  /** The raw differences, per language: "Show the data". */
  protected readonly data = computed(() =>
    (this.review()?.locales ?? [])
      .filter((side) => side.draft)
      .map((side) => {
        const docs = (side.docs ?? []).flatMap((doc) =>
          doc.change === "changed"
            ? diffJson(doc.live, doc.draft).map((e) => ({ ...e, path: `${doc.key} ${e.path}` }))
            : [{ path: doc.key, kind: doc.change }],
        );
        const entries: DiffEntry[] = [
          ...changeRows(side.live, side.draft).flatMap((row) => row.entries),
          ...docs,
        ].map((e) => ({ ...e, before: clip(e.before), after: clip(e.after) }));
        return { locale: side.locale, language: LANGUAGE[side.locale], entries };
      }),
  );

  protected readonly unsavedEditor = computed(() => {
    const editor = this.unsaved.editor();
    return editor && editor.changes() > 0 ? editor : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    // A fresh review every time it opens: the draft may have changed since.
    effect(() => {
      if (this.open()) untracked(() => void this.load());
    });
    // The note's Save lands in the draft: the review reads it again, quietly.
    effect(() => {
      this.api.writes();
      untracked(() => {
        if (!this.awaitingSave || !this.open()) return;
        this.awaitingSave = false;
        void this.load(true);
      });
    });
    // The note's Save goes with the note: the keyboard goes to the review's title.
    let noted = false;
    effect(() => {
      const now = this.unsavedEditor() !== null;
      if (noted && !now && this.savedFromNote) {
        this.savedFromNote = false;
        untracked(() => this.focus("[data-review-title]"));
      }
      noted = now;
    });
  }

  protected onState(state: string): void {
    if (state === "closed") this.open.set(false);
  }

  /** After a publish, Publish in the top bar says "All live" and is off: the focus goes to the page. */
  protected afterClose(): void {
    const active = this.doc.activeElement;
    if (!active || active === this.doc.body) {
      this.doc.querySelector<HTMLElement>("main h1")?.focus();
    }
  }

  protected unsavedWords(editor: EditorHandle): string {
    const n = editor.changes();
    return n === 1
      ? `${editor.title()} has 1 unsaved change: it is not in this publish.`
      : `${editor.title()} has ${n} unsaved changes: they are not in this publish.`;
  }

  protected saveEdits(editor: EditorHandle): void {
    this.awaitingSave = true;
    this.savedFromNote = true;
    editor.save();
  }

  protected async load(quiet = false): Promise<void> {
    if (!quiet) {
      this.loading.set(true);
      this.outcome.set(null);
      this.refusal.set(null);
      this.liveBefore.set(undefined);
      // What is live now (the newest publication with anything live): Roll back's target after a
      // publish. The review does not wait for it; until it comes, History holds the way back.
      void this.api.publications().then((list) => {
        if (this.destroyed || !list.ok) return;
        const live = list.data.publications.find((p) => p.versions.some((v) => v.live));
        this.liveBefore.set(live?.id ?? null);
      });
    }
    const review = await this.api.publishReview();
    if (this.destroyed) return;
    this.loading.set(false);
    this.review.set(review.ok ? review.data : null);
  }

  protected onEnter(event: Event): void {
    if ((event as KeyboardEvent).isComposing) return;
    if (this.canPublish()) void this.publish();
  }

  protected async publish(): Promise<void> {
    if (this.publishing() || !this.canPublish()) return;
    this.publishing.set(true);
    this.refusal.set(null);
    const result = await this.api.publish(this.label().trim() || undefined);
    this.publishing.set(false);
    if (this.destroyed) return;

    if (!result.ok) {
      const detail = result.detail as
        { locales?: { locale: Locale; issues: DraftIssue[] }[] } | undefined;
      if (result.error === "invalid_draft" && detail?.locales) {
        // Saved since the review loaded, and invalid: its problems join the review.
        this.review.update((r) =>
          r
            ? {
                canPublish: false,
                locales: r.locales.map((side) => {
                  const failed = detail.locales?.find((f) => f.locale === side.locale);
                  return failed ? { ...side, issues: failed.issues, draft: null, docs: [] } : side;
                }),
              }
            : r,
        );
      }
      this.refusal.set(publishRefusal(result.error));
      return;
    }

    if (result.data.unchanged) {
      this.finish({
        heading: "Nothing to publish",
        words: "The draft already matches what is live, so no new publication was made.",
        rollbackTo: null,
      });
      return;
    }
    const before = this.liveBefore();
    this.label.set("");
    this.published.emit();
    const words = liveWords(result.data.published);
    this.finish({
      heading: `Published #${result.data.publicationId}`,
      words: before === undefined ? `${words} History can roll it back.` : words,
      rollbackTo: before ?? null,
    });
  }

  protected async rollBack(to: number): Promise<void> {
    if (this.rollingBack()) return;
    this.rollingBack.set(true);
    const result = await this.api.rollbackPublication(to);
    this.rollingBack.set(false);
    if (this.destroyed) return;
    if (!result.ok) {
      this.outcome.update(
        (done) =>
          done && { ...done, refusal: `Not rolled back. ${publicationProblem(result.error)}` },
      );
      return;
    }
    this.published.emit();
    this.finish({
      heading: "Rolled back",
      words: `#${result.data.publicationId} is live, with #${to}'s content.`,
      rollbackTo: null,
    });
  }

  /** The result replaces the review where it happened; closed meanwhile, it is said once. */
  private finish(outcome: Outcome): void {
    this.outcome.set(outcome);
    if (this.open()) this.focus("#publish-result");
    else toast.success(outcome.heading, { description: outcome.words });
  }

  /** After the next render, while the dialog still exists. */
  private focus(selector: string): void {
    afterNextRender(
      () => {
        // The dialog title's id is brain's own (its aria-labelledby): found by attribute.
        if (!this.destroyed) this.doc.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this.injector },
    );
  }
}
