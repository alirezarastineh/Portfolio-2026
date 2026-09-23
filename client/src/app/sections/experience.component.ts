import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideAward,
  lucideBriefcase,
  lucideExternalLink,
  lucideGraduationCap,
} from "@ng-icons/lucide";

import { PictureComponent } from "../components/picture.component";
import { SectionHeadingComponent } from "../components/section-heading.component";
import { formatDuration, formatMonth, formatPeriod } from "../content/period";
import type { EmploymentType, Experience, ExperienceKind } from "../content/schema";
import { LanguageService } from "../services/language.service";

interface Group {
  kind: ExperienceKind;
  label: string;
  icon: string;
  entries: Entry[];
}

interface Entry {
  experience: Experience;
  /** `Mar 2024 – Present`; for a certification, when it was issued (and until when). */
  when: string;
  /** `2 yr 3 mo`; empty for certifications, which have no duration. */
  duration: string;
  /** Employment type and location, as one line. */
  details: string;
}

const KIND_ORDER: ExperienceKind[] = ["work", "education", "certification"];
const KIND_ICON: Record<ExperienceKind, string> = {
  work: "lucideBriefcase",
  education: "lucideGraduationCap",
  certification: "lucideAward",
};

/**
 * The CV as a timeline: work, education and certifications, each in the
 * order set in the admin. Rendered only when there is something to show.
 */
@Component({
  selector: "app-experience-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, PictureComponent, SectionHeadingComponent],
  viewProviders: [
    provideIcons({ lucideAward, lucideBriefcase, lucideExternalLink, lucideGraduationCap }),
  ],
  host: { class: "block" },
  template: `
    @if (groups().length) {
      <section
        id="experience"
        aria-labelledby="experience-heading"
        class="relative px-6 py-24 sm:px-8 sm:py-28 lg:px-12 lg:py-32"
      >
        <div class="mx-auto flex max-w-5xl flex-col gap-12">
          <app-section-heading
            headingId="experience-heading"
            [heading]="lang.t().experience.heading"
            [eyebrow]="lang.t().experience.subtitle"
          />

          @for (group of groups(); track group.kind) {
            <div class="flex flex-col gap-6">
              <h3
                class="m-0 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.22em] text-accent-orange"
              >
                <ng-icon [name]="group.icon" size="14" aria-hidden="true" />
                {{ group.label }}
              </h3>

              <ol class="m-0 flex list-none flex-col border-l border-border p-0" role="list">
                @for (entry of group.entries; track entry.experience.id) {
                  <li class="relative pb-10 pl-8 last:pb-0">
                    <!-- Filled while ongoing. -->
                    <span
                      class="absolute -left-1.25 top-2 size-2.25 rounded-full border border-accent-orange"
                      [class.bg-accent-orange]="!entry.experience.period.end"
                      [class.bg-background]="!!entry.experience.period.end"
                      aria-hidden="true"
                    ></span>

                    <article class="flex flex-col gap-3 sm:flex-row sm:gap-5">
                      <div
                        class="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-card font-mono text-sm text-muted-foreground"
                        aria-hidden="true"
                      >
                        @if (entry.experience.org.logo; as logo) {
                          <app-picture
                            [image]="logo"
                            alt=""
                            sizes="44px"
                            imgClass="block size-full object-contain p-1"
                          />
                        } @else {
                          {{ initial(entry.experience.org.name) }}
                        }
                      </div>

                      <div class="flex min-w-0 flex-col gap-2">
                        <h4 class="m-0 text-lg font-medium leading-snug text-foreground">
                          {{ entry.experience.title }}
                        </h4>
                        <p class="m-0 text-sm text-muted-foreground">
                          @if (entry.experience.org.url) {
                            <a
                              class="text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-accent-indigo"
                              [href]="entry.experience.org.url"
                              target="_blank"
                              rel="noreferrer noopener"
                              >{{ entry.experience.org.name }}</a
                            >
                          } @else {
                            <span class="text-foreground">{{ entry.experience.org.name }}</span>
                          }
                          @if (entry.details) {
                            <span> · {{ entry.details }}</span>
                          }
                        </p>
                        <p class="m-0 font-mono text-xs text-muted-foreground">
                          <time [attr.datetime]="entry.experience.period.start">{{
                            entry.when
                          }}</time>
                          @if (entry.duration) {
                            <span> · {{ entry.duration }}</span>
                          }
                        </p>

                        @if (entry.experience.summary) {
                          <p
                            class="m-0 max-w-3xl text-pretty leading-relaxed text-muted-foreground"
                          >
                            {{ entry.experience.summary }}
                          </p>
                        }
                        @if (entry.experience.highlights.length) {
                          <ul class="m-0 flex list-none flex-col gap-1.5 p-0" role="list">
                            @for (highlight of entry.experience.highlights; track $index) {
                              <li
                                class="flex items-baseline gap-2 text-sm leading-relaxed text-foreground/90"
                              >
                                <span class="text-accent-orange" aria-hidden="true">▸</span>
                                <span>{{ highlight }}</span>
                              </li>
                            }
                          </ul>
                        }
                        @if (entry.experience.skills.length) {
                          <ul class="m-0 mt-1 flex list-none flex-wrap gap-2 p-0" role="list">
                            @for (skill of entry.experience.skills; track skill) {
                              <li
                                class="rounded-md border border-border bg-muted/50 px-2 py-0.5 font-mono text-[0.7rem] text-foreground/85"
                              >
                                {{ skill }}
                              </li>
                            }
                          </ul>
                        }
                        @if (entry.experience.credential?.url; as url) {
                          <a
                            class="inline-flex w-fit items-center gap-1.5 font-mono text-xs text-foreground underline decoration-accent-orange/60 underline-offset-4 transition-colors hover:decoration-accent-indigo"
                            [href]="url"
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {{ lang.t().experience.credential }}
                            <ng-icon name="lucideExternalLink" size="12" aria-hidden="true" />
                          </a>
                        }
                      </div>
                    </article>
                  </li>
                }
              </ol>
            </div>
          }
        </div>
      </section>
    }
  `,
})
export class ExperienceSectionComponent {
  protected readonly lang = inject(LanguageService);

  /** Durations of ongoing entries count to today — the day this page is rendered. */
  private readonly now = new Date();

  protected readonly groups = computed<Group[]>(() => {
    const t = this.lang.t().experience;
    const labels: Record<ExperienceKind, string> = {
      work: t.work,
      education: t.education,
      certification: t.certifications,
    };
    const experiences = this.lang.content().experiences;
    return KIND_ORDER.map((kind) => ({
      kind,
      label: labels[kind],
      icon: KIND_ICON[kind],
      entries: experiences.filter((e) => e.kind === kind).map((e) => this.entry(e)),
    })).filter((group) => group.entries.length > 0);
  });

  protected initial(name: string): string {
    return name.trim().charAt(0).toUpperCase();
  }

  private entry(experience: Experience): Entry {
    const t = this.lang.t().experience;
    const locale = this.lang.lang();
    const { period } = experience;

    if (experience.kind === "certification") {
      const issued = formatMonth(period.start, locale, period.precision);
      return {
        experience,
        when: period.end
          ? `${issued} – ${formatMonth(period.end, locale, period.precision)}`
          : issued,
        duration: "",
        details: experience.location,
      };
    }

    return {
      experience,
      when: formatPeriod(period, locale, t.present, period.precision),
      duration: formatDuration(period, t, this.now, period.precision),
      details: [this.employmentLabel(experience.employmentType), experience.location]
        .filter(Boolean)
        .join(" · "),
    };
  }

  private employmentLabel(type: EmploymentType): string {
    const t = this.lang.t().experience;
    const labels: Record<EmploymentType, string> = {
      "": "",
      "full-time": t.fullTime,
      "part-time": t.partTime,
      contract: t.contract,
      freelance: t.freelance,
      internship: t.internship,
    };
    return labels[type];
  }
}
