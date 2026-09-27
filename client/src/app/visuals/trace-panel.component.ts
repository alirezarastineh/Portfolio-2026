import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { ASK_ENTRY_COPY } from "../ask/ask-entry-copy";
import { AskTraceService } from "../ask/ask-trace.service";
import { LanguageService } from "../services/language.service";
import { traceView } from "./trace";

/**
 * The hero's picture of how the assistant answers: six steps from question to
 * answer, each with its share of the answer's time. Until the visitor asks
 * something it shows an example, and says so; after an answer it replays
 * once with that answer's real numbers. Server-rendered, animated in CSS only
 * (styles/motion.css), and still, with every step done, under reduced motion.
 * Screen readers get the caption, not the drawing.
 */
@Component({
  selector: "app-trace-panel",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block" },
  template: `
    <figure
      class="trace surface-card relative m-0 overflow-hidden rounded-2xl"
      [attr.data-once]="view().live ? '' : null"
    >
      <figcaption class="sr-only">{{ view().summary }}</figcaption>
      <div aria-hidden="true">
        <div
          class="flex items-center justify-between gap-3 border-b border-border px-4 py-3 font-mono text-meta"
        >
          <span class="truncate text-foreground">{{ copy().title }}</span>
          <span
            class="shrink-0"
            [class.text-accent-orange]="view().live"
            [class.text-muted-foreground]="!view().live"
            >{{ view().caption }}</span
          >
        </div>

        <div class="relative py-2">
          <!-- The connector between the steps, and the request travelling it. -->
          <span
            class="absolute bottom-7.5 left-6.5 top-7.5 w-px -translate-x-1/2 bg-accent-indigo/40 sm:bottom-8.5 sm:top-8.5"
          ></span>
          @for (run of [view().id]; track run) {
            <span
              class="trace-packet absolute bottom-7.5 left-6.5 top-7.5 w-0 sm:bottom-8.5 sm:top-8.5"
            >
              <span class="absolute -left-0.5 -top-0.5 size-1 rounded-full bg-accent-orange"></span>
            </span>
          }

          <ol class="m-0 list-none p-0">
            @for (row of view().rows; track row.step + view().id; let i = $index) {
              <li
                class="trace-node relative grid h-11 grid-cols-[1.25rem_1fr] items-center gap-x-3 px-4 sm:h-13"
                [style.--i]="i"
              >
                <span class="relative grid size-5 place-items-center rounded-full bg-card">
                  <svg class="size-3.5 text-border-strong" viewBox="0 0 16 16">
                    <circle
                      cx="8"
                      cy="8"
                      r="6"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="1.5"
                    />
                  </svg>
                  <svg class="trace-check absolute size-3.5 text-accent-indigo" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="7.5" fill="currentColor" />
                    <path
                      d="M4.8 8.3 7 10.4 11.2 5.9"
                      fill="none"
                      stroke="var(--card)"
                      stroke-width="1.7"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
                <div class="relative min-w-0">
                  <div class="flex items-baseline justify-between gap-3 font-mono text-meta">
                    <span class="min-w-0 truncate"
                      ><span class="text-foreground">{{ row.step }}</span
                      ><span class="ml-2 text-muted-foreground">{{ row.detail }}</span></span
                    >
                    <span class="shrink-0 tabular-nums text-muted-foreground">{{ row.time }}</span>
                  </div>
                  <!-- The step's share of the answer's time; a step without one keeps the space. -->
                  <div class="relative mt-1.5 h-1 rounded-full" [class.bg-muted]="row.bar">
                    @if (row.bar; as bar) {
                      <span
                        class="absolute inset-y-0 rounded-full bg-accent-indigo"
                        [style.left.%]="bar.left"
                        [style.width]="'max(2px, ' + bar.width + '%)'"
                      ></span>
                    }
                  </div>
                </div>
              </li>
            }
          </ol>
        </div>
      </div>
    </figure>
  `,
})
export class TracePanelComponent {
  private readonly lang = inject(LanguageService);
  private readonly trace = inject(AskTraceService);

  protected readonly copy = computed(() => ASK_ENTRY_COPY[this.lang.lang()].trace);
  protected readonly view = computed(() =>
    traceView(ASK_ENTRY_COPY[this.lang.lang()], this.lang.lang(), this.trace.last()),
  );
}
