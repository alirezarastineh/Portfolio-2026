import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
  viewChildren,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import { ConfirmService } from "../components/confirm-dialog.component";
import {
  APPLIED_AS,
  appliedLabel,
  effectLine,
  lessonRefusal,
  ratesLine,
  type AppliedAs,
  type Lesson,
  type LessonPatch,
} from "../lessons";

const STATUS: Record<Lesson["status"], string> = {
  proposed: "Proposed",
  active: "Applied",
  retired: "Retired",
};

/**
 * Lessons (plan phase 25), the journal's top tier, shown first in the Journal
 * tab as the book retrieves them (lessons, then entries, then answers): each
 * corroborated across failures, applied as a fix, measured on visitors'
 * answers before and since. The nightly check retires one that does not
 * work; the admin can reopen it. A lesson never reaches the prompt by itself.
 */
@Component({
  selector: "app-journal-lessons",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, HlmBadge, HlmButton],
  host: { class: "block" },
  template: `
    <section class="flex flex-col gap-3" aria-labelledby="lessons-heading">
      <div class="flex flex-col gap-1">
        <!-- Focus lands here when a deleted lesson's card goes. -->
        <h2 #listHeading id="lessons-heading" tabindex="-1" class="m-0 text-base font-semibold">
          Lessons
        </h2>
        <p class="m-0 text-sm text-muted-foreground">
          What several failures taught, applied as a fix and measured on the answers since.
          Effectiveness is correlation, not cause: a count until five answers match.
        </p>
      </div>
      <ul class="m-0 flex list-none flex-col gap-3 p-0" role="list">
        @for (lesson of lessons(); track lesson.id) {
          <li>
            <article
              class="flex flex-col gap-2 rounded-lg border border-border p-4 text-sm"
              [attr.aria-labelledby]="'lesson-' + lesson.id"
            >
              <header class="flex flex-wrap items-baseline justify-between gap-2">
                <h3
                  #heading
                  tabindex="-1"
                  [id]="'lesson-' + lesson.id"
                  class="m-0 text-sm font-medium"
                >
                  {{ lesson.statement }}
                </h3>
                <span hlmBadge [variant]="lesson.status === 'active' ? 'default' : 'outline'">{{
                  status(lesson.status)
                }}</span>
              </header>
              <p class="m-0 text-xs text-muted-foreground">
                About: {{ lesson.scope.join(", ") }} · {{ provenance(lesson) }}
              </p>
              @if (lesson.appliedAs) {
                <p class="m-0 text-xs">
                  Applied as {{ applied(lesson.appliedAs) }}: {{ lesson.appliedRef }}, since
                  {{ when(lesson.appliedAt!) }}
                </p>
              }
              @if (lesson.reopenedAt && lesson.status === "active") {
                <p class="m-0 text-xs text-muted-foreground">
                  Reopened {{ when(lesson.reopenedAt) }}: measured again from then.
                </p>
              }
              <p class="m-0 text-xs">{{ effect(lesson) }}</p>
              @if (lesson.effect) {
                <p class="m-0 text-xs text-muted-foreground">
                  Before: {{ rates(lesson.effect.before) }}. Since:
                  {{ rates(lesson.effect.after) }}.
                </p>
              }
              @if (lesson.retiredReason) {
                <p class="m-0 text-xs text-muted-foreground">
                  Retired ({{ lesson.decidedBy === "system" ? "by the nightly check" : "by you" }}):
                  {{ lesson.retiredReason }}
                </p>
              }
              <div class="flex flex-wrap items-end gap-2 text-xs">
                @if (lesson.status !== "retired") {
                  <label class="flex flex-col gap-1">
                    <span class="text-muted-foreground">Applied as</span>
                    <select
                      class="h-8 rounded-md border border-border bg-background px-2 text-foreground"
                      [name]="'lesson-as-' + lesson.id"
                      [ngModel]="draftAs()[lesson.id] ?? lesson.appliedAs ?? 'faq'"
                      [ngModelOptions]="{ standalone: true }"
                      (ngModelChange)="setAs(lesson.id, $event)"
                    >
                      @for (option of appliedAs; track option.id) {
                        <option [value]="option.id">{{ option.label }}</option>
                      }
                    </select>
                  </label>
                  <label class="flex min-w-48 flex-1 flex-col gap-1">
                    <span class="text-muted-foreground">Reference</span>
                    <input
                      class="h-8 rounded-md border border-border bg-background px-2 font-mono text-foreground"
                      maxlength="200"
                      [name]="'lesson-ref-' + lesson.id"
                      [attr.aria-describedby]="'lesson-ref-hint-' + lesson.id"
                      [ngModel]="draftRef()[lesson.id] ?? lesson.appliedRef ?? ''"
                      [ngModelOptions]="{ standalone: true }"
                      (ngModelChange)="setRef(lesson.id, $event)"
                    />
                  </label>
                  <button
                    hlmBtn
                    size="sm"
                    type="button"
                    [attr.aria-describedby]="'lesson-' + lesson.id"
                    (click)="apply(lesson)"
                  >
                    {{ lesson.appliedAs ? "Apply again" : "Apply" }}
                  </button>
                  <button
                    hlmBtn
                    size="sm"
                    variant="ghost"
                    type="button"
                    [attr.aria-describedby]="'lesson-' + lesson.id"
                    (click)="decide(lesson, { retire: true }, 'Retired')"
                  >
                    Retire
                  </button>
                } @else {
                  <button
                    hlmBtn
                    size="sm"
                    variant="outline"
                    type="button"
                    [attr.aria-describedby]="'lesson-' + lesson.id"
                    (click)="decide(lesson, { reopen: true }, 'Reopened')"
                  >
                    Reopen
                  </button>
                }
                <button
                  hlmBtn
                  size="sm"
                  variant="ghost"
                  type="button"
                  [attr.aria-describedby]="'lesson-' + lesson.id"
                  (click)="remove(lesson)"
                >
                  Delete
                </button>
              </div>
              @if (lesson.status !== "retired") {
                <p [id]="'lesson-ref-hint-' + lesson.id" class="m-0 text-xs text-muted-foreground">
                  {{ refHint(draftAs()[lesson.id] ?? lesson.appliedAs ?? "faq") }}. Applying starts
                  the measure again.
                </p>
              }
            </article>
          </li>
        } @empty {
          <li class="text-sm text-muted-foreground">
            No lessons yet: tick "Use in a lesson" on three accepted or fixed entries below, or make
            one from an unanswered topic in Insights.
          </li>
        }
      </ul>
      <!-- Always in the page, so what is put in it is announced. -->
      <p class="sr-only" role="status">{{ said() }}</p>
    </section>
  `,
})
export class JournalLessonsComponent {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly injector = inject(Injector);

  readonly lessons = input.required<Lesson[]>();
  readonly changed = output<Lesson>();
  readonly deleted = output<string>();

  protected readonly appliedAs = APPLIED_AS;
  protected readonly draftAs = signal<Partial<Record<string, AppliedAs>>>({});
  protected readonly draftRef = signal<Partial<Record<string, string>>>({});
  protected readonly said = signal("");
  private readonly headings = viewChildren<ElementRef<HTMLElement>>("heading");
  private readonly listHeading = viewChild.required<ElementRef<HTMLElement>>("listHeading");

  protected status(status: Lesson["status"]): string {
    return STATUS[status];
  }

  protected applied(as: AppliedAs): string {
    return appliedLabel(as);
  }

  protected refHint(as: AppliedAs): string {
    return APPLIED_AS.find((a) => a.id === as)?.ref ?? "What the fix is";
  }

  protected readonly effect = (lesson: Lesson) => effectLine(lesson.effect);
  protected readonly rates = ratesLine;

  protected provenance(lesson: Lesson): string {
    if (lesson.topic) {
      return `from the insight topic “${lesson.topic.title}” (${lesson.topic.questions} questions, not answered)`;
    }
    return `from ${lesson.journalIds.length} journal entries`;
  }

  protected when(iso: string): string {
    return new Date(iso).toLocaleDateString();
  }

  protected setAs(id: string, as: AppliedAs): void {
    this.draftAs.update((d) => ({ ...d, [id]: as }));
  }

  protected setRef(id: string, ref: string): void {
    this.draftRef.update((d) => ({ ...d, [id]: ref }));
  }

  protected apply(lesson: Lesson): Promise<void> {
    const as = this.draftAs()[lesson.id] ?? lesson.appliedAs ?? "faq";
    const ref = (this.draftRef()[lesson.id] ?? lesson.appliedRef ?? "").trim();
    if (!ref) {
      toast.error("Name the fix first: its id, version or document.");
      return Promise.resolve();
    }
    return this.decide(lesson, { apply: { as, ref } }, `Applied as ${appliedLabel(as)}`);
  }

  protected async decide(
    lesson: Lesson,
    patch: Pick<LessonPatch, "apply" | "retire" | "reopen">,
    done: string,
  ): Promise<void> {
    const result = await this.api.updateLesson(lesson.id, patch);
    if (!result.ok) {
      toast.error("Could not save the lesson", {
        description: lessonRefusal(result.error, result.detail),
      });
      return;
    }
    toast.success(done);
    this.said.set(`${done}: ${lesson.statement}`);
    this.changed.emit(result.data.lesson);
    // The button pressed may be gone: keep focus on the lesson.
    const index = this.lessons().findIndex((l) => l.id === lesson.id);
    afterNextRender(() => this.headings()[index]?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected async remove(lesson: Lesson): Promise<void> {
    const go = await this.confirm.ask({
      title: "Delete this lesson?",
      description: "It goes for good; the journal entries it came from stay.",
      confirmLabel: "Delete lesson",
      destructive: true,
    });
    if (!go) return;
    const result = await this.api.deleteLesson(lesson.id);
    if (!result.ok) {
      toast.error("Could not delete the lesson", {
        description: lessonRefusal(result.error, result.detail),
      });
      return;
    }
    this.said.set(`Deleted: ${lesson.statement}`);
    this.deleted.emit(lesson.id);
    // Its card is gone, the button with it.
    afterNextRender(() => this.listHeading().nativeElement.focus(), { injector: this.injector });
  }
}
