import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideExternalLink, lucideFileText, lucideGithub } from "@ng-icons/lucide";

import { ScrambleTextComponent } from "./scramble-text.component";
import type { Project } from "../data/projects.data";
import { LanguageService } from "../services/language.service";

interface DetailBlock {
  label: string;
  body: string;
  list?: string[];
}

interface ExternalLink {
  label: string;
  href: string;
  icon: string;
}

@Component({
  selector: "app-project-card",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, ScrambleTextComponent],
  viewProviders: [provideIcons({ lucideExternalLink, lucideFileText, lucideGithub })],
  host: {
    class: "block",
  },
  template: `
    <article
      class="grid grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_60px_-30px_oklch(0_0_0/70%)] lg:h-full lg:grid-cols-[3fr_2fr]"
    >
      <div
        class="relative aspect-16/10 overflow-hidden border-b border-border bg-[oklch(0.27_0_0)] lg:aspect-auto lg:border-b-0 lg:border-r"
      >
        <img
          [src]="project().image"
          [alt]="project().name + ' preview'"
          loading="lazy"
          decoding="async"
          class="block size-full object-cover"
        />
        <div
          class="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_55%,oklch(0.18_0_0/65%)_100%)]"
          aria-hidden="true"
        ></div>
        <span
          class="absolute left-5 top-5 rounded-md border border-border bg-card/70 px-2.5 py-1 font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground backdrop-blur-sm"
        >
          {{ indexLabel() }}
        </span>
      </div>

      <div class="flex flex-col gap-5 p-6 sm:p-8 lg:overflow-y-auto">
        <p class="font-mono text-[0.72rem] uppercase tracking-[0.22em] text-muted-foreground">
          {{ project().descriptor }}
        </p>
        <h3
          class="m-0 font-mono text-2xl font-medium leading-tight text-foreground sm:text-[1.7rem]"
        >
          <app-scramble-text [text]="project().name" />
        </h3>
        <p class="m-0 text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
          {{ project().hook }}
        </p>

        <dl class="m-0 grid gap-4">
          @for (block of blocks(); track block.label) {
            <div class="flex flex-col gap-1.5">
              <dt
                class="font-mono text-[0.68rem] uppercase tracking-[0.22em] text-accent-orange"
              >
                {{ block.label }} ▸
              </dt>
              @if (block.list) {
                <dd class="m-0">
                  <ul class="m-0 flex list-none flex-col gap-1 p-0" role="list">
                    @for (item of block.list; track item) {
                      <li
                        class="flex items-baseline gap-2 text-sm leading-relaxed text-foreground/90"
                      >
                        <span class="text-accent-indigo" aria-hidden="true">·</span>
                        <span>{{ item }}</span>
                      </li>
                    }
                  </ul>
                </dd>
              } @else {
                <dd class="m-0 text-sm leading-relaxed text-foreground/90">{{ block.body }}</dd>
              }
            </div>
          }
        </dl>

        <ul
          class="m-0 mt-auto flex list-none flex-wrap gap-2 p-0 pt-2"
          role="list"
          [attr.aria-label]="lang.t().projectCard.techStackAriaLabel"
        >
          @for (tech of project().stack; track tech) {
            <li
              class="rounded-md border border-border bg-card/60 px-2 py-1 font-mono text-[0.7rem] tracking-[0.01em] text-foreground/85"
            >
              {{ tech }}
            </li>
          }
        </ul>

        @if (links().length) {
          <nav class="flex flex-wrap gap-2" aria-label="Project links">
            @for (link of links(); track link.href) {
              <a
                class="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-transparent px-3 font-mono text-[0.78rem] text-foreground transition-colors duration-200 ease-in-out hover:border-accent-indigo/50 hover:text-accent-indigo"
                [href]="link.href"
                target="_blank"
                rel="noreferrer noopener"
              >
                <ng-icon [name]="link.icon" size="14" aria-hidden="true" />
                <span>{{ link.label }}</span>
              </a>
            }
          </nav>
        }
      </div>
    </article>
  `,
})
export class ProjectCardComponent {
  readonly lang = inject(LanguageService);
  readonly project = input.required<Project>();
  readonly index = input<number>(0);

  readonly indexLabel = computed(() => {
    const i = this.index() + 1;
    return this.lang.t().projectCard.caseLabel(i);
  });

  readonly blocks = computed<DetailBlock[]>(() => {
    const p = this.project();
    const c = this.lang.t().projectCard;
    return [
      { label: c.problem, body: p.problem },
      { label: c.arch, body: p.aiArchitecture },
      { label: c.infra, body: p.fullStackInfra },
      { label: c.outcomes, body: "", list: p.outcomes },
    ];
  });

  readonly links = computed<ExternalLink[]>(() => {
    const l = this.project().links;
    const c = this.lang.t().projectCard;
    const out: ExternalLink[] = [];
    if (l.live) out.push({ label: c.live, href: l.live, icon: "lucideExternalLink" });
    if (l.repo) out.push({ label: c.repo, href: l.repo, icon: "lucideGithub" });
    if (l.caseStudy)
      out.push({ label: c.caseStudy, href: l.caseStudy, icon: "lucideFileText" });
    return out;
  });
}
