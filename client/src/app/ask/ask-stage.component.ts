import { HttpClient } from "@angular/common/http";
import { isPlatformBrowser, NgTemplateOutlet } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  PLATFORM_ID,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideCornerDownLeft } from "@ng-icons/lucide";

import { LanguageService } from "../services/language.service";
import { AskConsoleComponent } from "./ask-console.component";
import { ASK_ENTRY_COPY, commandRow } from "./ask-entry-copy";
import { AskLauncherService } from "./ask-launcher.service";

/** What the site's server says of the assistant; nothing when the API cannot say. */
interface AskEntryState {
  state?: string;
  suggestions?: Record<string, string[]>;
  scorecard?: boolean;
}

/**
 * The assistant's stage in the hero (plan 4 U11b): a frame of a set height, so nothing around it
 * ever moves. The server prints a light copy of the console: the hint, the suggestions, the prompt,
 * the commands and the line that says an AI answers. The console itself, with the store and the AI
 * SDK, loads when the visitor hovers or focuses here, and takes over at the first send, click, `/`
 * or palette request; it shows here while a conversation exists. While the panel is open the stage
 * steps back to one line, so one prompt and one live region exist at a time. An assistant at rest
 * says so from the first paint, with a way to reach a person.
 *
 * Below 1024px the stage is only the door to the sheet: a console docked over a phone's keyboard is
 * what broke before. There it shows the last question, the way back into the conversation.
 *
 * Before the app is interactive the form leads to the contact form (`action`), the one thing that
 * works without JavaScript. The input has no name, so a question never reaches the address or the
 * server's logs. Event replay would not help: the browser submits the form before Angular could
 * replay the event.
 */
@Component({
  selector: "app-ask-stage",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AskConsoleComponent, NgIcon, NgTemplateOutlet],
  viewProviders: [provideIcons({ lucideCornerDownLeft })],
  host: {
    "(pointerenter)": "prime()",
    "(focusin)": "prime()",
  },
  template: `
    <ng-template #resting>
      @if (launcher.sheetOpen() && !launcher.narrow()) {
        <p class="aside">{{ copy().continuing }}</p>
      } @else {
        <div class="body">
          <!-- At rest it says so, and offers a person, before anyone tries (plan 4 U12). -->
          @if (launcher.assistant() === "resting") {
            <p class="hint">{{ lang.t().ask.offline }}</p>
            <a class="suggestion press" [href]="'/' + lang.lang() + '#contact'">{{
              copy().contact
            }}</a>
          } @else if (launcher.lastQuestion(); as question) {
            <!-- On a phone the way back into a conversation; elsewhere the console shows it. -->
            <button type="button" class="resume press" (click)="launcher.openSheet('button')">
              <span class="prompt" aria-hidden="true">&gt;</span>
              <span class="sr-only">{{ copy().resume }}:</span>
              <span class="said">{{ question }}</span>
            </button>
          } @else {
            <p class="hint">{{ lang.t().ask.hint }}</p>
          }
          @if (launcher.assistant() !== "resting") {
            <div class="suggestions" role="group" [attr.aria-label]="copy().suggestions">
              @for (question of suggestions(); track question) {
                <button
                  type="button"
                  class="suggestion press"
                  (click)="launcher.ask(question, 'starter')"
                >
                  {{ question }}
                </button>
              }
            </div>
          }
        </div>
        <form
          method="get"
          class="composer"
          [attr.action]="'/' + lang.lang() + '#contact'"
          (submit)="submit($event, field)"
        >
          <label [for]="inputId" class="prompt"
            ><span aria-hidden="true">&gt;</span
            ><span class="sr-only">{{ lang.t().hero.askCta }}</span></label
          >
          <input
            #field
            type="text"
            class="field"
            [id]="inputId"
            [attr.placeholder]="lang.t().ask.placeholder"
            aria-describedby="ask-bar-disclosure"
            autocomplete="off"
            autocapitalize="sentences"
            spellcheck="true"
            enterkeyhint="send"
            (click)="toSheet()"
          />
          <button type="submit" class="send press" [attr.aria-label]="copy().send">
            <ng-icon name="lucideCornerDownLeft" size="16" aria-hidden="true" />
          </button>
        </form>
        <div class="commands" role="group" translate="no" [attr.aria-label]="copy().commands">
          @for (command of commands(); track command) {
            <button type="button" class="press" (click)="launcher.ask(command, 'starter')">
              {{ command }}
            </button>
          }
        </div>
        <!-- Right under the field, so it is read before the first question. -->
        <p id="ask-bar-disclosure" class="disclosure">{{ lang.t().ask.disclosure }}</p>
      }
    </ng-template>

    <section [attr.aria-label]="lang.t().hero.askCta">
      <p class="title" aria-hidden="true">{{ lang.t().hero.askCta }}</p>
      @if (launcher.stageLive()) {
        @defer (on immediate) {
          <app-ask-console [stage]="true" />
        } @placeholder {
          <ng-container *ngTemplateOutlet="resting" />
        }
      } @else {
        <ng-container *ngTemplateOutlet="resting" />
      }
    </section>
  `,
  // The prompt, its field, the commands and the disclosure match the console's, so the swap between
  // the two moves nothing.
  styles: `
    :host {
      display: block;
    }
    section {
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow: hidden;
      border: 1px solid var(--border-strong);
      border-radius: 0.5rem;
      background: var(--card);
    }
    /* A set height from the first paint: it never grows, its log scrolls. */
    @media (width >= 64rem) {
      section {
        height: min(34rem, calc(100svh - 7.5rem));
      }
    }
    .title {
      flex: none;
      margin: 0;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--border);
      color: var(--foreground);
      font-size: 0.9375rem;
      font-weight: 600;
      line-height: 1.3;
    }
    app-ask-console {
      flex: 1;
    }
    .body {
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      gap: 0.75rem;
      min-height: 5rem;
      padding: 1rem;
      overflow-y: auto;
    }
    .aside {
      margin: 0;
      padding: 1rem;
      color: var(--muted-foreground);
      font-size: 0.9375rem;
    }
    .hint {
      margin: 0;
      color: var(--muted-foreground);
      font-size: 0.9375rem;
      line-height: 1.5;
      text-wrap: pretty;
    }
    .resume {
      display: flex;
      gap: 0.5rem;
      min-height: 2.75rem;
      align-items: center;
      font-size: 0.9375rem;
      font-weight: 600;
      text-align: left;
      cursor: pointer;
    }
    .resume:hover .said {
      text-decoration: underline;
      text-underline-offset: 0.25em;
    }
    .said {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .suggestions {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .suggestion {
      min-height: 2.5rem;
      padding: 0.4375rem 0.75rem;
      border: 1px solid var(--border-strong);
      border-radius: 0.25rem;
      color: var(--foreground);
      font-size: 0.9375rem;
      line-height: 1.5;
      text-align: left;
      cursor: pointer;
    }
    .suggestion:hover {
      border-color: var(--accent-orange);
    }
    a.suggestion {
      text-decoration: none;
    }
    .composer {
      display: flex;
      flex: none;
      align-items: flex-end;
      gap: 0.5rem;
      min-height: 3rem;
      margin: 0.5rem 1rem 0;
      padding: 0.1875rem 0.1875rem 0.1875rem 0.75rem;
      border: 1px solid var(--input-line);
      border-radius: 0.25rem;
    }
    .composer:focus-within {
      border-color: var(--accent-orange);
      box-shadow: 0 0 0 1px var(--accent-orange);
    }
    .prompt {
      flex: none;
      color: var(--accent-orange);
      font-family: var(--font-mono);
      font-weight: 500;
      user-select: none;
    }
    .composer .prompt {
      align-self: flex-start;
      padding-block: 0.5rem;
      line-height: 1.5;
    }
    .field {
      display: block;
      flex: 1;
      min-width: 0;
      margin: 0;
      padding-block: 0.5rem;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--foreground);
      font: inherit;
      /* iOS zooms into a field under 16px when it takes focus. */
      font-size: 1rem;
      line-height: 1.5;
      caret-color: var(--accent-orange);
    }
    .field::placeholder {
      color: var(--muted-foreground);
      opacity: 1;
    }
    .send {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      width: 2.5rem;
      height: 2.5rem;
      border: 1px solid var(--border-strong);
      border-radius: 0.25rem;
      color: var(--muted-foreground);
      cursor: pointer;
    }
    .send:hover {
      color: var(--foreground);
    }
    .commands {
      display: flex;
      flex: none;
      flex-wrap: wrap;
      gap: 0 0.875rem;
      margin: 0.375rem 1rem 0;
      color: var(--muted-foreground);
      font-family: var(--font-mono);
      font-size: 0.8125rem;
    }
    .commands button {
      min-height: 1.5rem;
      text-align: left;
      cursor: pointer;
    }
    .commands button:hover {
      color: var(--foreground);
    }
    .disclosure {
      flex: none;
      margin: 0.125rem 1rem 0.875rem;
      color: var(--muted-foreground);
      font-size: 0.75rem;
      line-height: 1.5;
      text-wrap: pretty;
    }
    /* The door: the prompt first, under the title. */
    @media (width < 64rem) {
      .title {
        order: -2;
      }
      .composer {
        order: -1;
        margin-top: 0.75rem;
      }
      .body {
        flex: none;
        min-height: 0;
      }
    }
    @media (pointer: coarse) {
      .suggestion,
      .commands button {
        min-height: 2.75rem;
      }
      .commands button {
        min-width: 2.75rem;
      }
      .send {
        width: 2.75rem;
        height: 2.75rem;
      }
    }
  `,
})
export class AskStageComponent {
  protected readonly lang = inject(LanguageService);
  protected readonly launcher = inject(AskLauncherService);
  private readonly http = inject(HttpClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly inputId = "ask-bar";
  protected readonly commands = computed(() => commandRow(this.launcher.scorecard()));
  protected readonly copy = computed(() => ASK_ENTRY_COPY[this.lang.lang()]);
  /** Three of the admin's questions, in the server's HTML; else the built-in three. */
  protected readonly suggestions = computed(() => {
    const own = this.launcher.questions()?.[this.lang.lang()];
    return own?.length ? own.slice(0, 3) : this.copy().starters;
  });

  constructor() {
    // Through the site's server, so the transfer cache replays it and the browser asks nothing.
    if (!this.launcher.questions()) {
      this.http.get<AskEntryState>("/api/v2/ask-questions").subscribe({
        next: ({ state, suggestions, scorecard }) => {
          this.launcher.questions.set(suggestions ?? {});
          if (scorecard !== undefined) this.launcher.scorecard.set(scorecard);
          if (state) this.launcher.assistant.set(state === "ok" ? "online" : "resting");
        },
        error: () => undefined, // The built-in three stand.
      });
    }

    let observer: IntersectionObserver | undefined;
    afterNextRender(() => {
      if (!this.isBrowser) return;
      this.launcher.stageReady.set(true);
      observer = new IntersectionObserver(
        ([entry]) => this.launcher.stageInView.set(entry?.isIntersecting ?? false),
        { threshold: 0.25 },
      );
      observer.observe(this.host.nativeElement);
    });

    inject(DestroyRef).onDestroy(() => {
      observer?.disconnect();
      this.launcher.stageReady.set(false);
      this.launcher.stageInView.set(true);
    });
  }

  /** The visitor came near: the console's code starts loading, so the swap is instant. */
  protected prime(): void {
    void import("./ask-console.component");
  }

  /**
   * On a phone a tap on the field opens the sheet: a keyboard over the page is what broke before.
   * On the click, not on focus: tabbing past must not throw anyone into a sheet (WCAG 3.2.1).
   */
  protected toSheet(): void {
    if (this.launcher.narrow()) this.launcher.openSheet("hero");
  }

  protected submit(event: Event, field: HTMLInputElement): void {
    event.preventDefault();
    const text = field.value.trim();
    if (text) this.launcher.ask(text, "hero");
    else this.launcher.openSheet("hero");
  }
}
