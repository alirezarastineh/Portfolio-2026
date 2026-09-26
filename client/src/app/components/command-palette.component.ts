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
  lucideBriefcase,
  lucideDownload,
  lucideFileText,
  lucideGlobe,
  lucideHash,
  lucideHouse,
  lucideMoon,
  lucideNewspaper,
  lucideSearch,
  lucideSparkles,
  lucideSun,
} from "@ng-icons/lucide";

import { AskLauncherService } from "../ask/ask-launcher.service";
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
 * The public ⌘K palette: jump to a section, a case study or a post, or switch
 * language or theme, ask the assistant, download the CV. A native modal
 * `<dialog>` (the browser traps focus, closes on Escape and hands focus back)
 * holding a combobox over a listbox, the ARIA pattern screen readers know.
 * Loaded the first time someone opens it (see the public shell).
 */
@Component({
  selector: "app-command-palette",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  viewProviders: [
    provideIcons({
      lucideBriefcase,
      lucideDownload,
      lucideFileText,
      lucideGlobe,
      lucideHash,
      lucideHouse,
      lucideMoon,
      lucideNewspaper,
      lucideSearch,
      lucideSparkles,
      lucideSun,
    }),
  ],
  host: { class: "contents" },
  template: `
    <dialog
      #dialog
      class="mx-auto mt-[12vh] w-[min(36rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-popover p-0 text-popover-foreground shadow-e3 backdrop:bg-scrim backdrop:backdrop-blur-sm"
      [attr.aria-label]="labels().title"
      (close)="palette.hide()"
      (click)="closeOnBackdrop($event)"
    >
      <div class="flex items-center gap-3 border-b border-border px-4">
        <ng-icon name="lucideSearch" size="16" class="text-muted-foreground" aria-hidden="true" />
        <input
          #input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded="true"
          aria-controls="palette-list"
          autocomplete="off"
          spellcheck="false"
          class="h-12 min-w-0 flex-1 bg-transparent text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
          [attr.aria-label]="labels().title"
          [attr.aria-activedescendant]="activeId()"
          [placeholder]="labels().placeholder"
          [value]="query()"
          (input)="search($event)"
          (keydown)="onKey($event)"
        />
        <kbd class="kbd" aria-hidden="true">esc</kbd>
      </div>

      @if (flat().length) {
        <div
          id="palette-list"
          role="listbox"
          class="max-h-[min(24rem,60vh)] overflow-y-auto p-2"
          [attr.aria-label]="labels().title"
        >
          @for (group of groups(); track group.label; let g = $index) {
            <div role="group" [attr.aria-labelledby]="'palette-group-' + g">
              <div [id]="'palette-group-' + g" class="eyebrow px-3 pb-1 pt-3 text-muted-foreground">
                {{ group.label }}
              </div>
              @for (command of group.commands; track command.id) {
                <div
                  role="option"
                  class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm text-foreground"
                  [class.bg-muted]="command.id === activeId()"
                  [id]="command.id"
                  [attr.aria-selected]="command.id === activeId()"
                  (click)="run(command)"
                  (pointermove)="highlight(command.id)"
                >
                  <ng-icon
                    [name]="command.icon"
                    size="15"
                    class="shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span class="truncate">{{ command.label }}</span>
                  @if (command.hint) {
                    <span class="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{{
                      command.hint
                    }}</span>
                  }
                </div>
              }
            </div>
          }
        </div>
      } @else {
        <p class="m-0 px-4 py-8 text-center text-sm text-muted-foreground">{{ labels().empty }}</p>
      }

      <p
        class="m-0 border-t border-border px-4 py-2 font-mono text-meta text-muted-foreground"
        aria-hidden="true"
      >
        {{ labels().hint }}
      </p>
    </dialog>
  `,
})
export class CommandPaletteComponent {
  protected readonly palette = inject(CommandPaletteService);
  private readonly lang = inject(LanguageService);
  private readonly launcher = inject(AskLauncherService);
  private readonly theme = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>("dialog");
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>("input");

  protected readonly labels = computed(() => CHROME[this.lang.lang()].palette);
  protected readonly query = signal("");
  private readonly active = signal(0);

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
        id: "palette-ask",
        label: labels.palette.ask,
        icon: "lucideSparkles",
        keywords: t.hero.askCta,
        // Home has the terminal in its About section; elsewhere it opens in a sheet.
        run: () => {
          if (this.lang.page() === "/") {
            this.launcher.focusPrompt();
            void this.router.navigate(["/", l], { fragment: "about" });
          } else {
            this.launcher.openSheet();
          }
        },
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
        run: () => this.theme.toggle(),
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

  protected readonly flat = computed(() => this.groups().flatMap((group) => group.commands));
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
        this.active.set(0);
        dialog.showModal();
        this.input().nativeElement.focus();
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
    this.active.set(0);
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
    if (!move || count === 0) return;
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

  /** A file, not a page: saved through a plain link, never the router. */
  private download(href: string): void {
    const link = this.doc.createElement("a");
    link.href = href;
    link.download = "";
    link.click();
  }
}
