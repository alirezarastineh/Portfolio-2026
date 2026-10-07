import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";

import { AdminApiService } from "../admin-api.service";
import {
  lessonProblem,
  lessonRefusal,
  scopeWords,
  type Lesson,
  type LessonSource,
} from "../lessons";

/**
 * A lesson in the admin's words (plan phase 25), from three decided journal
 * entries or an unanswered insight topic: the rule, and the words of the
 * questions it is about (its effect is measured on their answers). The server
 * keeps it only once corroborated.
 */
@Component({
  selector: "app-lesson-form",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, HlmButton],
  host: { class: "block" },
  template: `
    <form
      class="flex flex-col gap-2 rounded-lg border border-border p-4 text-xs"
      action="/admin/assistant"
      [attr.aria-labelledby]="id('title')"
      (submit)="$event.preventDefault(); send()"
    >
      <h3 #title tabindex="-1" [id]="id('title')" class="m-0 text-sm font-medium">
        {{ heading() }}
      </h3>
      <label class="flex flex-col gap-1">
        <span class="text-muted-foreground">The lesson</span>
        <textarea
          rows="3"
          maxlength="500"
          class="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
          [name]="id('statement')"
          [attr.aria-describedby]="id('statement-hint')"
          [ngModel]="statement()"
          (ngModelChange)="statement.set($event)"
        ></textarea>
      </label>
      <p [id]="id('statement-hint')" class="m-0 text-muted-foreground">
        A rule someone can follow, never "be careful": when it applies, what to do, and why. It
        never enters the prompt: you apply it as a fix.
      </p>
      <label class="flex flex-col gap-1">
        <span class="text-muted-foreground">The questions it is about</span>
        <input
          maxlength="400"
          class="h-8 rounded-md border border-border bg-background px-2 font-mono text-foreground"
          [name]="id('scope')"
          [attr.aria-describedby]="id('scope-hint')"
          [ngModel]="scopeText()"
          (ngModelChange)="editScope($event)"
        />
      </label>
      <p [id]="id('scope-hint')" class="m-0 text-muted-foreground">
        Words those questions contain, separated by commas: 3 letters or more, nothing personal. Its
        effect is measured on the answers to them.
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          hlmBtn
          size="sm"
          type="submit"
          [disabled]="sending() || !!problem()"
          [attr.aria-describedby]="id('problem')"
        >
          {{ sending() ? "Making it…" : "Make the lesson" }}
        </button>
        <button hlmBtn size="sm" variant="ghost" type="button" (click)="cancelled.emit()">
          Cancel
        </button>
      </div>
      <p [id]="id('problem')" class="m-0 text-muted-foreground">{{ problem() }}</p>
    </form>
  `,
})
export class LessonFormComponent {
  private readonly api = inject(AdminApiService);
  private readonly injector = inject(Injector);

  /** Unique within the page: the form's ids start with it. */
  readonly key = input.required<string>();
  readonly heading = input.required<string>();
  readonly source = input.required<LessonSource>();
  /** A first scope; the admin's edits win over a later one. */
  readonly scope = input<string[]>([]);
  /** Why the source cannot make a lesson yet (the entries chosen, say); null when it can. */
  readonly sourceProblem = input<string | null>(null);
  readonly made = output<Lesson>();
  readonly cancelled = output<void>();

  protected readonly statement = signal("");
  private scopeEdited = false;
  protected readonly scopeText = linkedSignal<string[], string>({
    source: this.scope,
    computation: (words, previous) =>
      previous && this.scopeEdited ? previous.value : words.join(", "),
  });
  protected readonly sending = signal(false);
  protected readonly problem = computed(
    () => this.sourceProblem() ?? lessonProblem(this.statement(), this.scopeText()),
  );
  private readonly title = viewChild.required<ElementRef<HTMLElement>>("title");

  constructor() {
    // Opened by a button that stays: the admin lands on the form.
    afterNextRender(() => this.title().nativeElement.focus());
  }

  protected id(part: string): string {
    return `lesson-form-${this.key()}-${part}`;
  }

  protected editScope(text: string): void {
    this.scopeEdited = true;
    this.scopeText.set(text);
  }

  protected async send(): Promise<void> {
    if (this.problem() || this.sending()) return;
    this.sending.set(true);
    const result = await this.api.createLesson({
      ...this.source(),
      statement: this.statement().trim(),
      scope: scopeWords(this.scopeText()),
    });
    this.sending.set(false);
    if (!result.ok) {
      toast.error("Could not make the lesson", {
        description: lessonRefusal(result.error, result.detail),
      });
      afterNextRender(() => this.title().nativeElement.focus(), { injector: this.injector });
      return;
    }
    toast.success("Lesson made");
    this.made.emit(result.data.lesson);
  }
}
