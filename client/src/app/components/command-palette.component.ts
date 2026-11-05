import { DOCUMENT } from "@angular/common";
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
  viewChild,
} from "@angular/core";
import { Router } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideBell,
  lucideBriefcase,
  lucideDownload,
  lucideFileText,
  lucideGlobe,
  lucideHash,
  lucideHouse,
  lucideListChecks,
  lucideMoon,
  lucideNewspaper,
  lucideSearch,
  lucideSignpost,
  lucideSparkles,
  lucideSun,
} from "@ng-icons/lucide";

import { AskLauncherService } from "../ask/ask-launcher.service";
import { newsCount, visitNews } from "../ask/news";
import { fetchMap, updatesSince } from "../ask/portfolio-map";
import { otherLocale } from "../content/locale";
import { splitCommentMark } from "../i18n/comment-mark";
import { CHROME } from "../i18n/chrome";
import { CommandPaletteService } from "../services/command-palette.service";
import { LanguageService } from "../services/language.service";
import { ThemeService } from "../services/theme.service";

interface Command {
  id: string;
  label: string;
  icon: string;
  /** Extra words it is found by. */
  keywords?: string;
  hint?: string;
  run: () => void;
}

interface Group {
  label: string;
  commands: Command[];
}

/**
 * The public ⌘K palette, the header's "Ask or search": its first row always asks
 * the assistant what was typed, so no search ends empty; below it, jump to a
 * section, a case study or a post, or switch language or theme, download the CV.
 * A native modal `<dialog>` (the browser traps focus, closes on Escape and hands
 * focus back) holding a combobox over a listbox, the ARIA pattern screen readers
 * know. Loaded the first time someone opens it (see the public shell), and styled
 * here, so its rules load with it.
 */
@Component({
  selector: "app-command-palette",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  viewProviders: [
    provideIcons({
      lucideBell,
      lucideBriefcase,
      lucideDownload,
      lucideFileText,
      lucideGlobe,
      lucideHash,
      lucideHouse,
      lucideListChecks,
      lucideMoon,
      lucideNewspaper,
      lucideSearch,
      lucideSignpost,
      lucideSparkles,
      lucideSun,
    }),
  ],
  host: { class: "contents" },
  template: `
    <dialog
      #dialog
      class="palette"
      [attr.aria-label]="labels().title"
      (close)="palette.hide()"
      (click)="closeOnBackdrop($event)"
    >
      <div class="palette-search">
        <ng-icon name="lucideSearch" size="16" class="palette-icon" aria-hidden="true" />
        <input
          #input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="palette-list"
          autocomplete="off"
          spellcheck="false"
          enterkeyhint="go"
          class="palette-input"
          [attr.aria-label]="labels().title"
          [attr.aria-activedescendant]="activeId()"
          [placeholder]="labels().placeholder"
          [value]="query()"
          (input)="search($event)"
          (keydown)="onKey($event)"
        />
        <kbd class="palette-key" aria-hidden="true">esc</kbd>
        <button type="button" class="control press palette-close" (click)="palette.hide()">
          {{ labels().close }}
        </button>
      </div>

      <div id="palette-list" role="listbox" class="palette-list" [attr.aria-label]="labels().title">
        <div
          role="option"
          class="palette-option"
          [id]="ask().id"
          [attr.aria-selected]="ask().id === activeId()"
          (click)="run(ask())"
          (pointermove)="highlight(ask().id)"
        >
          <ng-icon name="lucideSparkles" size="16" class="palette-icon" aria-hidden="true" />
          @if (typed(); as text) {
            <span class="palette-label"
              ><span class="palette-muted">{{ labels().ask }}:</span> {{ text }}</span
            >
          } @else {
            <span class="palette-label">{{ lang.t().ask.title }}…</span>
          }
        </div>
        @for (group of groups(); track group.label; let g = $index) {
          <div role="group" [attr.aria-labelledby]="'palette-group-' + g">
            <div [id]="'palette-group-' + g" class="palette-group">{{ group.label }}</div>
            @for (command of group.commands; track command.id) {
              <div
                role="option"
                class="palette-option"
                [id]="command.id"
                [attr.aria-selected]="command.id === activeId()"
                (click)="run(command)"
                (pointermove)="highlight(command.id)"
              >
                <ng-icon [name]="command.icon" size="16" class="palette-icon" aria-hidden="true" />
                <span class="palette-label">{{ command.label }}</span>
                @if (command.hint) {
                  <span class="palette-hint">{{ command.hint }}</span>
                }
              </div>
            }
          </div>
        }
      </div>

      <p class="palette-keys" aria-hidden="true">{{ labels().hint }}</p>
    </dialog>
  `,
  styles: `
    .palette {
      width: min(36rem, calc(100vw - 2rem));
      margin: 12dvh auto auto;
      padding: 0;
      overflow: hidden;
      border: 1px solid var(--border-strong);
      border-radius: 0.5rem;
      background: var(--popover);
      color: var(--popover-foreground);
      box-shadow: var(--shadow-e3);
    }
    .palette::backdrop {
      background: var(--scrim, rgb(0 0 0 / 65%));
    }
    .palette-search {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding-inline: 1rem 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    .palette-input {
      flex: 1;
      min-width: 0;
      height: 3.25rem;
      background: transparent;
      font-size: 1rem;
    }
    .palette-input::placeholder {
      color: var(--muted-foreground);
    }
    .palette-input:focus-visible {
      outline: none;
    }
    .palette-key {
      margin-inline-end: 0.5rem;
      padding: 0 0.375rem;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      color: var(--muted-foreground);
      font: inherit;
      font-size: 0.75rem;
    }
    .palette-list {
      max-height: min(24rem, 60dvh);
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0.5rem;
    }
    .palette-group {
      padding: 0.75rem 0.75rem 0.25rem;
      color: var(--faint-foreground);
      font-size: 0.8125rem;
    }
    .palette-option {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-height: 2.5rem;
      padding-inline: 0.75rem;
      border-radius: var(--radius);
      font-size: 0.9375rem;
      touch-action: manipulation;
      cursor: pointer;
    }
    .palette-option[aria-selected="true"] {
      background: var(--surface-2);
    }
    .palette-icon {
      flex: none;
      color: var(--muted-foreground);
    }
    .palette-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .palette-muted {
      color: var(--muted-foreground);
    }
    .palette-hint {
      flex: none;
      margin-inline-start: auto;
      color: var(--faint-foreground);
      font-size: 0.8125rem;
    }
    .palette-keys {
      margin: 0;
      padding: 0.5rem 1rem;
      border-top: 1px solid var(--border);
      color: var(--faint-foreground);
      font-size: 0.8125rem;
    }
    /* A close control for touch; the keys for a keyboard. */
    @media (pointer: coarse) {
      .palette-option {
        min-height: 2.75rem;
      }
      .palette-key,
      .palette-keys {
        display: none;
      }
    }
    @media (pointer: fine) {
      .palette-close {
        display: none;
      }
    }

    /* Opening, it grows from 98% and fades in over a fading backdrop, in 120ms:
       it is used often. Closing, the reverse, faster (display and the top layer
       wait for it). Where the browser cannot animate a dialog's display, it simply
       appears. The fallbacks: ::backdrop inherits the tokens only in newer browsers. */
    @media (prefers-reduced-motion: no-preference) {
      @supports (transition-behavior: allow-discrete) {
        .palette,
        .palette::backdrop {
          opacity: 0;
          transition:
            opacity var(--dur-1, 90ms) var(--ease-in, ease-in),
            scale var(--dur-1, 90ms) var(--ease-in, ease-in),
            overlay var(--dur-1, 90ms) allow-discrete,
            display var(--dur-1, 90ms) allow-discrete;
        }
        .palette {
          scale: 0.98;
        }
        .palette[open],
        .palette[open]::backdrop {
          opacity: 1;
          transition-duration: 120ms;
          transition-timing-function: var(--ease-emph, ease-out);
        }
        .palette[open] {
          scale: 1;
        }
        @starting-style {
          .palette[open],
          .palette[open]::backdrop {
            opacity: 0;
          }
          .palette[open] {
            scale: 0.98;
          }
        }
      }
    }
  `,
})
export class CommandPaletteComponent {
  protected readonly palette = inject(CommandPaletteService);
  protected readonly lang = inject(LanguageService);
  private readonly launcher = inject(AskLauncherService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>("dialog");
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>("input");

  protected readonly labels = computed(() => CHROME[this.lang.lang()].palette);
  protected readonly query = signal("");
  private readonly active = signal(0);
  /** "3 updates since Sep 12" beside "What's new", once the visitor turned it on (visitor plan V15). */
  private readonly newsHint = signal<string | null>(null);

  private readonly all = computed<Group[]>(() => {
    const l = this.lang.lang();
    const content = this.lang.content();
    const t = content.ui;
    const labels = CHROME[l];
    const go = (commands: unknown[], fragment?: string) => () =>
      void this.router.navigate(commands, fragment ? { fragment } : {});

    const section = (id: string, label: string, icon = "lucideHash"): Command => ({
      id: `palette-section-${id}`,
      label: splitCommentMark(label).text,
      icon,
      run: go(["/", l], id),
    });
    const sections: Command[] = [
      { id: "palette-home", label: labels.palette.home, icon: "lucideHouse", run: go(["/", l]) },
      section("projects", t.projects.heading),
      ...(content.experiences.length ? [section("experience", t.experience.heading)] : []),
      section("skills", t.skills.heading),
      section("about", t.about.heading),
      section("contact", t.contact.heading),
    ];

    const work = content.projects
      .filter((project) => project.hasCaseStudy)
      .map<Command>((project) => ({
        id: `palette-work-${project.slug}`,
        label: project.name,
        icon: "lucideBriefcase",
        keywords: `${project.descriptor} ${project.stack.join(" ")}`,
        run: go(["/", l, "work", project.slug]),
      }));

    const writing: Command[] = content.posts.length
      ? [
          {
            id: "palette-writing",
            label: t.writing.allPosts,
            icon: "lucideNewspaper",
            run: go(["/", l, "writing"]),
          },
          ...content.posts.map<Command>((post) => ({
            id: `palette-post-${post.slug}`,
            label: post.title,
            icon: "lucideFileText",
            keywords: post.tags.join(" "),
            run: go(["/", l, "writing", post.slug]),
          })),
        ]
      : [];

    const other = otherLocale(l);
    const dark = this.theme.theme() === "dark";
    const actions: Command[] = [
      {
        id: "palette-news",
        label: labels.palette.news,
        icon: "lucideBell",
        keywords: "news updates",
        ...(this.newsHint() ? { hint: this.newsHint()! } : {}),
        run: () => this.launcher.ask("news", "palette"),
      },
      {
        id: "palette-tour",
        label: labels.palette.tour,
        icon: "lucideSignpost",
        keywords: "tour guide start",
        run: () => this.launcher.ask("tour", "palette"),
      },
      {
        id: "palette-match",
        label: labels.footer.match,
        icon: "lucideListChecks",
        keywords: "match fit role project problem hire",
        run: go(["/", l, "match"]),
      },
      {
        id: "palette-language",
        label: labels.header.switchTo,
        icon: "lucideGlobe",
        hint: other.toUpperCase(),
        run: () => {
          this.lang.remember(other);
          void this.router.navigateByUrl(this.lang.alternates()[other]);
        },
      },
      {
        id: "palette-theme",
        label: dark ? labels.header.toLight : labels.header.toDark,
        icon: dark ? "lucideSun" : "lucideMoon",
        // The new theme grows from the row (the dialog closes with the same render).
        run: () => this.theme.toggle(this.doc.getElementById("palette-theme") ?? undefined),
      },
      ...(content.identity.resume
        ? [
            {
              id: "palette-cv",
              label: t.hero.downloadCv,
              icon: "lucideDownload",
              run: () => this.download(`/${l}/resume.pdf`),
            },
          ]
        : []),
    ];

    return [
      { label: labels.palette.sections, commands: sections },
      { label: labels.palette.work, commands: work },
      { label: t.nav.writing, commands: writing },
      { label: labels.palette.actions, commands: actions },
    ];
  });

  /**
   * The groups, keeping only what matches every word typed — in a command's
   * label, its keywords, or its group's name ("writing" finds every post).
   */
  protected readonly groups = computed<Group[]>(() => {
    const words = this.query().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return this.all()
      .map((group) => ({
        label: group.label,
        commands: group.commands.filter((command) => {
          const haystack =
            `${group.label} ${command.label} ${command.keywords ?? ""}`.toLocaleLowerCase();
          return words.every((word) => haystack.includes(word));
        }),
      }))
      .filter((group) => group.commands.length > 0);
  });

  /** What was typed, the Ask row's question. */
  protected readonly typed = computed(() => this.query().trim());

  /** Always the first row: asks the assistant what was typed, or opens it when nothing was. */
  protected readonly ask = computed<Command>(() => {
    const text = this.typed();
    return {
      id: "palette-ask",
      label: text,
      icon: "lucideSparkles",
      run: () => (text ? this.launcher.ask(text, "palette") : this.launcher.openSheet("palette")),
    };
  });

  protected readonly flat = computed(() => [
    this.ask(),
    ...this.groups().flatMap((group) => group.commands),
  ]);
  protected readonly activeId = computed(() => this.flat()[this.active()]?.id ?? null);

  private returnFocus: HTMLElement | null = null;

  constructor() {
    // Open and close with the service; the first render opens it, since the
    // palette loads on the first request to show it.
    afterRenderEffect(() => {
      const open = this.palette.open();
      const dialog = this.dialog().nativeElement;
      if (open && !dialog.open) {
        this.returnFocus = this.doc.activeElement as HTMLElement | null;
        this.query.set("");
        this.active.set(this.firstMatch());
        dialog.showModal();
        this.input().nativeElement.focus();
        void this.loadNews();
      } else if (!open && dialog.open) {
        dialog.close();
        this.returnFocus?.focus();
        this.returnFocus = null;
      }
    });

    // Keep the highlighted option in view while arrowing through a long list.
    afterRenderEffect(() => {
      const id = this.activeId();
      if (id) this.doc.getElementById(id)?.scrollIntoView({ block: "nearest" });
    });
  }

  protected search(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.active.set(this.firstMatch());
  }

  /** The first match under the Ask row, so Enter goes to it; the Ask row when nothing matches. */
  private firstMatch(): number {
    return this.flat().length > 1 ? 1 : 0;
  }

  protected highlight(id: string): void {
    const index = this.flat().findIndex((command) => command.id === id);
    if (index >= 0) this.active.set(index);
  }

  protected onKey(event: KeyboardEvent): void {
    const count = this.flat().length;
    const moves: Record<string, () => number> = {
      ArrowDown: () => (this.active() + 1) % count,
      ArrowUp: () => (this.active() - 1 + count) % count,
      Home: () => 0,
      End: () => count - 1,
    };
    if (event.key === "Enter") {
      const command = this.flat()[this.active()];
      if (command) {
        event.preventDefault();
        this.run(command);
      }
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    this.active.set(move());
  }

  protected run(command: Command): void {
    // Close first, so focus is back on the page before anything navigates.
    this.returnFocus = null;
    this.palette.hide();
    command.run();
  }

  /** A click on the backdrop lands on the dialog itself. */
  protected closeOnBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.palette.hide();
  }

  /**
   * How many pages changed since the last visit (visitor plan V15). While what's
   * new is off nothing is read or fetched, and nothing stored.
   */
  private async loadNews(): Promise<void> {
    const locale = this.lang.lang();
    const since = visitNews();
    if (!since) {
      this.newsHint.set(null);
      return;
    }
    const pages = await fetchMap(locale);
    const count = pages ? updatesSince(pages, since).length : 0;
    this.newsHint.set(count ? newsCount(count, since, locale) : null);
  }

  /** A file, not a page: saved through a plain link, never the router. */
  private download(href: string): void {
    const link = this.doc.createElement("a");
    link.href = href;
    link.download = "";
    link.click();
  }
}
