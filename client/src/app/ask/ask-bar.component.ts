import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  PLATFORM_ID,
  viewChild,
} from "@angular/core";

import { LanguageService } from "../services/language.service";
import { ASK_ENTRY_COPY } from "./ask-entry-copy";
import { AskLauncherService } from "./ask-launcher.service";

/**
 * The hero's way into the assistant: a prompt that sends its question to the
 * panel, the line that says an AI answers, and the same starter questions as
 * chips that send at once.
 *
 * Before the app is interactive the form leads to the contact form (`action`),
 * the one thing that works without JavaScript. The input has no name, so a
 * question never reaches the address or the server's logs. Event replay would
 * not help: the browser submits the form before Angular could replay the event.
 */
@Component({
  selector: "app-ask-bar",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "flex flex-col gap-3" },
  template: `
    <form
      #form
      method="get"
      [attr.action]="'/' + lang.lang() + '#contact'"
      (submit)="submit($event)"
    >
      <div
        class="relative flex h-14 items-center gap-2 rounded-lg border border-border-strong bg-card pl-4 pr-1.5 shadow-e1 transition-[border-color,box-shadow] duration-(--dur-3) focus-within:border-accent-orange focus-within:shadow-glow motion-reduce:transition-none"
      >
        <!-- Sits on the top border, like a panel title in a terminal UI. -->
        <label
          class="absolute -top-2.5 left-3 rounded-sm bg-[linear-gradient(to_bottom,var(--background)_50%,var(--card)_50%)] px-1.5 font-mono text-label text-muted-foreground"
          [for]="inputId"
          >{{ lang.t().hero.askCta }}</label
        >
        <span class="shrink-0 font-mono text-meta text-accent-orange" aria-hidden="true"
          ><span class="max-sm:hidden">{{ promptHost() }}</span
          >{{ promptPath() }}</span
        >
        <input
          #input
          type="text"
          class="h-full min-w-0 grow bg-transparent font-mono text-base text-foreground caret-accent-orange placeholder:text-muted-foreground focus:outline-none"
          [id]="inputId"
          [attr.placeholder]="copy().starters[0]"
          aria-describedby="ask-bar-disclosure"
          autocomplete="off"
          autocapitalize="sentences"
          spellcheck="true"
          enterkeyhint="send"
        />
        <button
          type="submit"
          class="press inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          [attr.aria-label]="copy().send"
        >
          <span class="kbd">↵</span>
        </button>
      </div>
    </form>
    <!-- Right under the field, so it is read before the first question. -->
    <p id="ask-bar-disclosure" class="m-0 text-pretty text-xs text-muted-foreground">
      {{ lang.t().ask.disclosure }}
    </p>

    <div
      class="flex flex-wrap items-center gap-2"
      role="group"
      [attr.aria-label]="copy().suggestions"
    >
      <span class="font-mono text-meta text-muted-foreground" aria-hidden="true">{{
        copy().try
      }}</span>
      @for (question of copy().starters; track question) {
        <button
          type="button"
          class="chip press min-h-8 cursor-pointer px-2.5 text-left hover:border-border-strong hover:text-foreground"
          (click)="launcher.ask(question, 'starter')"
        >
          {{ question }}
        </button>
      }
    </div>
  `,
})
export class AskBarComponent {
  protected readonly lang = inject(LanguageService);
  protected readonly launcher = inject(AskLauncherService);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly inputId = "ask-bar";
  protected readonly copy = computed(() => ASK_ENTRY_COPY[this.lang.lang()]);

  /** `user@portfolio:~$` from the CMS; phones get only `~$`. */
  private readonly prompt = computed(() => this.lang.t().about.terminalPrompt);
  protected readonly promptHost = computed(() => {
    const prompt = this.prompt();
    const at = prompt.lastIndexOf(":");
    return at > 0 ? prompt.slice(0, at + 1) : "";
  });
  protected readonly promptPath = computed(() => {
    const prompt = this.prompt();
    return prompt.slice(prompt.lastIndexOf(":") + 1);
  });

  private readonly form = viewChild.required<ElementRef<HTMLFormElement>>("form");
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>("input");

  private observer?: IntersectionObserver;

  constructor() {
    afterNextRender(() => {
      if (!this.isBrowser) return;
      this.observer = new IntersectionObserver(([entry]) =>
        this.launcher.barInView.set(entry?.isIntersecting ?? false),
      );
      this.observer.observe(this.form().nativeElement);
    });

    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      this.launcher.barInView.set(true);
    });
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const input = this.input().nativeElement;
    const text = input.value.trim();
    input.value = "";
    if (text) this.launcher.ask(text, "hero");
    else this.launcher.openSheet("hero");
  }
}
