import { DOCUMENT } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from "@angular/core";
import { Router } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCircle, lucideCircleCheck, lucideCircleDashed } from "@ng-icons/lucide";

import type { OutlineItem, OutlineState } from "../editor-outline";

const ICONS: Record<OutlineState, string> = {
  done: "lucideCircleCheck",
  todo: "lucideCircle",
  optional: "lucideCircleDashed",
};

/** Just under the sticky page header (the page's scroll padding is 80 px). */
const READING_LINE = 120;
/** Long enough for a smooth jump to land. */
const HOLD_MS = 1200;

const WORDS: Record<OutlineState, string> = {
  done: "done",
  todo: "to do",
  optional: "optional, empty",
};

/**
 * A long editor's sections beside it (from `xl`), each with how far along it
 * is: a tick when filled in, an open circle when a visitor will miss
 * something, a dashed one when empty is fine, and a red dot while the last
 * save's problems in it are unfixed. The section in view is marked; a link
 * scrolls to its section and moves the focus to its heading.
 */
@Component({
  selector: "app-editor-outline",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  viewProviders: [provideIcons({ lucideCircle, lucideCircleCheck, lucideCircleDashed })],
  host: { class: "block" },
  template: `
    <nav aria-labelledby="outline-title" class="sticky top-20 flex flex-col gap-3">
      <div class="flex items-baseline justify-between gap-2">
        <h2 id="outline-title" class="eyebrow m-0 text-muted-foreground">On this page</h2>
        <span class="font-mono text-xs text-muted-foreground tabular-nums"
          >{{ done() }}/{{ items().length }}<span class="sr-only"> done</span></span
        >
      </div>
      <ol class="m-0 flex list-none flex-col border-l border-border p-0" role="list">
        @for (item of items(); track item.id) {
          @let here = item.id === current();
          <li>
            <a
              class="-ml-px flex min-h-8 items-center gap-2 border-l-2 py-1 pl-3 pr-1 text-sm outline-none transition-colors duration-(--dur-2) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              [class]="
                here
                  ? 'border-accent-orange text-foreground'
                  : 'border-transparent text-muted-foreground'
              "
              [href]="hrefFor(item.id)"
              [attr.aria-current]="here ? 'location' : null"
              (click)="go($event, item.id)"
            >
              <ng-icon
                [name]="icon(item.state)"
                size="14"
                class="shrink-0"
                [class]="item.state === 'done' ? 'text-available' : 'text-muted-foreground'"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
              <span class="sr-only">, {{ words(item.state) }}</span>
              @if (item.problems) {
                <span class="size-2 shrink-0 rounded-full bg-destructive" aria-hidden="true"></span>
                <span class="sr-only"
                  >, {{ item.problems }} {{ item.problems === 1 ? "problem" : "problems" }}</span
                >
              }
            </a>
          </li>
        }
      </ol>
    </nav>
  `,
})
export class EditorOutlineComponent {
  readonly items = input.required<OutlineItem[]>();

  private readonly doc = inject(DOCUMENT);
  private readonly router = inject(Router);

  /** The section at the top of the window. */
  protected readonly current = signal<string | null>(null);
  protected readonly done = computed(() => this.items().filter((i) => i.state === "done").length);
  private readonly ids = computed(() =>
    this.items()
      .map((i) => i.id)
      .join(" "),
  );

  protected icon(state: OutlineState): string {
    return ICONS[state];
  }

  protected words(state: OutlineState): string {
    return WORDS[state];
  }

  /** While a jump's scroll runs, the section jumped to stays marked. */
  private holdUntil = 0;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const ready = signal(false);
    afterNextRender(() => ready.set(true));

    // The section being read: the last one whose top has passed a line just
    // under the sticky page header (the first until one has). Measured on
    // scroll, once a frame at most; again whenever the sections change.
    effect((onCleanup) => {
      const ids = this.ids();
      const win = this.doc.defaultView;
      if (!ready() || !win) return;
      untracked(() => {
        const order = ids.split(" ");
        let frame = 0;
        const measure = () => {
          frame = 0;
          if (Date.now() < this.holdUntil) return;
          let reading = order[0] ?? null;
          for (const id of order) {
            const top = this.doc.getElementById(id)?.getBoundingClientRect().top;
            if (top !== undefined && top <= READING_LINE) reading = id;
          }
          this.current.set(reading);
        };
        const schedule = () => {
          if (!frame) frame = win.requestAnimationFrame(measure);
        };
        win.addEventListener("scroll", schedule, { passive: true });
        win.addEventListener("resize", schedule, { passive: true });
        measure();
        onCleanup(() => {
          win.removeEventListener("scroll", schedule);
          win.removeEventListener("resize", schedule);
          if (frame) win.cancelAnimationFrame(frame);
        });
      });
    });
    destroyRef.onDestroy(() => this.current.set(null));
  }

  /** The editor's own URL with the fragment: a plain `#id` would resolve against `<base href="/">`. */
  protected hrefFor(id: string): string {
    return `${this.router.url.split("#")[0]}#${id}`;
  }

  protected go(event: MouseEvent, id: string): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const section = this.doc.getElementById(id);
    if (!section) return;
    event.preventDefault();
    const still = this.doc.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // The page's scroll padding keeps it clear of the sticky header.
    section.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    const heading = section.querySelector<HTMLElement>("h2, h3") ?? section;
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
    this.current.set(id);
    // A short section near the end cannot reach the line: it stays marked anyway.
    this.holdUntil = Date.now() + HOLD_MS;
  }
}
