import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { MatchMarkComponent, MatchMarks } from "../ask/match-marks";
import { PictureComponent } from "../components/picture.component";
import { SectionHeadingComponent } from "../components/section-heading.component";
import { formatDuration, formatMonth, formatPeriod } from "../content/period";
import type { EmploymentType, Experience, ExperienceKind } from "../content/schema";
import { CHROME } from "../i18n/chrome";
import { fmt } from "../i18n/interpolate";
import { LanguageService } from "../services/language.service";

interface Group {
  kind: ExperienceKind;
  label: string;
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
  /** The highlights always shown; the rest fold behind "+N more". */
  highlights: string[];
  more: string[];
}

const KIND_ORDER: ExperienceKind[] = ["work", "education", "certification"];

/** Highlights shown before the rest fold away. */
const HIGHLIGHTS = 3;

/**
 * The CV as a timeline drawn from the page's line: work, education and certifications under
 * headings of their own, each entry a tick on the line, in the order set in the admin. Rendered
 * only when there is something to show. Phones read the role, its organisation, then its dates;
 * from `md` the dates stand in a column of their own at the left, from `lg` held in view while the
 * entry scrolls past.
 */
@Component({
  selector: "app-experience-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatchMarkComponent, PictureComponent, SectionHeadingComponent],
  host: { class: "block" },
  template: `
    @if (groups().length) {
      <section
        id="experience"
        aria-labelledby="experience-heading"
        class="container-site section-y relative"
      >
        <div class="flex flex-col gap-12">
          <app-section-heading
            headingId="experience-heading"
            [heading]="lang.t().experience.heading"
          />

          @for (group of groups(); track group.kind) {
            <div class="flex flex-col gap-6">
              <h3 class="m-0 text-title text-foreground">{{ group.label }}</h3>

              <ol class="m-0 flex list-none flex-col gap-8 p-0 lg:gap-10" role="list">
                @for (entry of group.entries; track entry.experience.id) {
                  <li class="relative">
                    <!-- Its tick on the page's line, lit as the line reaches it (motion.css). -->
                    <span class="page-line-node" aria-hidden="true"></span>
                    <article
                      class="flex flex-col gap-3 md:grid md:grid-cols-12 md:gap-x-(--col-gap)"
                    >
                      <div class="flex flex-col gap-1 md:col-span-9 md:col-start-4 md:row-start-1">
                        <h4 class="m-0 text-subtitle text-foreground">
                          {{ entry.experience.title }}
                        </h4>
                        <p class="m-0 flex flex-wrap items-center gap-x-2 text-muted-foreground">
                          @if (entry.experience.org.logo; as logo) {
                            <app-picture
                              class="block size-5 shrink-0"
                              [image]="logo"
                              alt=""
                              [sizes]="'20px'"
                              [imgClass]="'block size-full object-contain'"
                            />
                          }
                          <!-- A link only with an address: bound, not branched, so no space
                               lands before the comma. -->
                          <span
                            ><a
                              [class]="
                                entry.experience.org.url ? 'link-underline' : 'text-foreground'
                              "
                              [attr.href]="entry.experience.org.url || null"
                              [attr.target]="entry.experience.org.url ? '_blank' : null"
                              [attr.rel]="entry.experience.org.url ? 'noreferrer noopener' : null"
                              >{{ entry.experience.org.name
                              }}<span aria-hidden="true" [hidden]="!entry.experience.org.url">
                                ↗</span
                              ></a
                            >{{ entry.details ? ", " + entry.details : "" }}</span
                          >
                        </p>
                      </div>

                      <!-- After the role on phones; its own column from md, held in view from lg
                           while the entry scrolls past. -->
                      <p
                        class="m-0 text-data text-muted-foreground md:col-span-3 md:col-start-1 md:row-span-2 md:row-start-1 md:flex md:flex-col md:self-start lg:sticky lg:top-24"
                      >
                        <time
                          class="text-foreground"
                          [attr.datetime]="entry.experience.period.start"
                          >{{ entry.when }}</time
                        >
                        @if (entry.duration) {
                          <span class="md:hidden">, </span><span>{{ entry.duration }}</span>
                        }
                      </p>

                      <div class="flex flex-col gap-3 md:col-span-9 md:col-start-4 md:row-start-2">
                        @if (marks.count("experience:" + entry.experience.id); as n) {
                          <app-match-mark [n]="n" />
                        }
                        @if (entry.experience.summary) {
                          <p class="m-0 max-w-[60ch] text-pretty text-foreground/85">
                            {{ entry.experience.summary }}
                          </p>
                        }
                        @if (entry.highlights.length) {
                          <ul class="list-trace m-0 p-0 text-small text-foreground/90" role="list">
                            @for (highlight of entry.highlights; track $index) {
                              <li class="text-pretty">{{ highlight }}</li>
                            }
                          </ul>
                        }
                        @if (entry.more.length) {
                          <details class="disclosure">
                            <summary class="press w-fit">
                              {{ moreLabel(entry.more.length) }}
                            </summary>
                            <ul
                              class="list-trace m-0 p-0 pt-1.5 text-small text-foreground/90"
                              role="list"
                            >
                              @for (highlight of entry.more; track $index) {
                                <li class="text-pretty">{{ highlight }}</li>
                              }
                            </ul>
                          </details>
                        }
                        @if (entry.experience.skills.length) {
                          <p class="m-0 text-small text-muted-foreground" translate="no">
                            {{ entry.experience.skills.join(", ") }}
                          </p>
                        }
                        @if (entry.experience.credential?.url; as url) {
                          <a
                            class="link-underline w-fit text-small"
                            [href]="url"
                            target="_blank"
                            rel="noreferrer noopener"
                            >{{ lang.t().experience.credential
                            }}<span aria-hidden="true"> ↗</span></a
                          >
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
  protected readonly marks = inject(MatchMarks);

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
      entries: experiences.filter((e) => e.kind === kind).map((e) => this.entry(e)),
    })).filter((group) => group.entries.length > 0);
  });

  protected moreLabel(n: number): string {
    return fmt(CHROME[this.lang.lang()].experience.more, { n });
  }

  private entry(experience: Experience): Entry {
    const t = this.lang.t().experience;
    const locale = this.lang.lang();
    const { period, highlights } = experience;
    const folded = {
      highlights: highlights.slice(0, HIGHLIGHTS),
      more: highlights.slice(HIGHLIGHTS),
    };

    if (experience.kind === "certification") {
      const issued = formatMonth(period.start, locale, period.precision);
      return {
        experience,
        when: period.end
          ? `${issued} – ${formatMonth(period.end, locale, period.precision)}`
          : issued,
        duration: "",
        details: experience.location,
        ...folded,
      };
    }

    return {
      experience,
      when: formatPeriod(period, locale, t.present, period.precision),
      duration: formatDuration(period, t, this.now, period.precision),
      details: [this.employmentLabel(experience.employmentType), experience.location]
        .filter(Boolean)
        .join(", "),
      ...folded,
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
