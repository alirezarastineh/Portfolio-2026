import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { PictureComponent } from "../components/picture.component";
import { SectionHeadingComponent } from "../components/section-heading.component";
import { AVAILABILITY_DOT, availabilityLabel } from "../content/availability";
import { placeName } from "../content/place";
import { CHROME } from "../i18n/chrome";
import { LanguageService } from "../services/language.service";

/** The figure's words, in the receipt's terms (sources checked, invented references removed). */
const ANSWER_STEPS = {
  en: {
    title: "How an answer is made",
    steps: [
      ["Question", "You ask the assistant about my work, in your own words."],
      ["Search", "It searches this site’s pages: projects, experience, writing."],
      ["Answer", "It answers from what it found and names each source."],
      [
        "Check",
        "Each source it names is checked against what it read; an invented one is removed before the answer appears.",
      ],
    ],
  },
  de: {
    title: "Wie eine Antwort entsteht",
    steps: [
      ["Frage", "Sie fragen den Assistenten in eigenen Worten nach meiner Arbeit."],
      ["Suche", "Er durchsucht die Seiten dieser Website: Projekte, Werdegang, Artikel."],
      ["Antwort", "Er antwortet aus dem Gefundenen und nennt jede Quelle."],
      [
        "Prüfung",
        "Jede genannte Quelle wird mit dem Gelesenen abgeglichen; eine erfundene wird entfernt, bevor die Antwort erscheint.",
      ],
    ],
  },
} as const;

/**
 * The About section, in one column: the statement, how he works as prose, a few facts, and how the
 * assistant makes an answer, drawn on the line. With a portrait it stands beside them from `lg`
 * (after the statement on phones); without one there is no frame and no initials.
 */
@Component({
  selector: "app-about-section",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PictureComponent, SectionHeadingComponent],
  host: {
    class: "block",
  },
  template: `
    <section id="about" aria-labelledby="about-heading" class="container-site section-y relative">
      <div class="flex flex-col gap-12">
        <app-section-heading headingId="about-heading" [heading]="lang.t().about.heading" />

        <!-- The statement and its prose close together, the facts and the figure apart. From lg the
             portrait spans the column's rows; the last row takes what it adds. -->
        <div class="grid grid-cols-12 gap-x-(--col-gap) gap-y-6 lg:grid-rows-[auto_auto_auto_1fr]">
          @if (bio()) {
            <p class="col-span-12 m-0 text-balance text-title text-foreground lg:col-span-7">
              {{ bio() }}
            </p>
          }
          @if (identity().avatar; as avatar) {
            <div
              class="col-span-12 sm:col-span-6 lg:col-span-4 lg:col-start-9 lg:row-span-4 lg:row-start-1"
            >
              <app-picture
                [image]="avatar"
                [sizes]="'(width >= 64rem) 30vw, (width >= 40rem) 50vw, 100vw'"
                [imgClass]="'block aspect-[4/5] w-full object-cover grayscale'"
              />
            </div>
          }
          <!-- The CMS may break it into paragraphs with new lines. -->
          <p
            class="col-span-12 m-0 max-w-[54ch] whitespace-pre-line text-pretty leading-relaxed text-foreground/85 lg:col-span-7"
          >
            {{ lang.t().about.philosophy }}
          </p>
          <dl class="facts col-span-12 mt-4 lg:col-span-7">
            @for (fact of facts(); track fact.label) {
              <dt>{{ fact.label }}</dt>
              <dd class="flex items-center gap-2 text-foreground">
                @if (fact.dot) {
                  <span class="status-dot" [class]="fact.dot" aria-hidden="true"></span>
                }
                {{ fact.value }}
              </dd>
            }
          </dl>
          <figure class="col-span-12 mt-4 lg:col-span-7">
            <figcaption class="mb-4 text-small font-medium text-foreground">
              {{ answer().title }}
            </figcaption>
            <ol class="answer-steps">
              @for (step of answer().steps; track step[0]) {
                <li>
                  <span class="text-data text-foreground">{{ step[0] }}</span
                  ><span>{{ step[1] }}</span>
                </li>
              }
            </ol>
          </figure>
        </div>
      </div>
    </section>
  `,
  // The assistant's trace, still: a tick to each step and the spine from the first tick to the
  // last. Borders, so forced colours keep it.
  styles: `
    .answer-steps {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .answer-steps li {
      position: relative;
      display: grid;
      grid-template-columns: 5rem minmax(0, 1fr);
      align-items: baseline;
      column-gap: 1rem;
      padding-inline-start: 1.0625rem;
      color: var(--muted-foreground);
      font-size: 0.9375rem;
      line-height: 1.5;
    }
    .answer-steps li::before,
    .answer-steps li::after {
      content: "";
      position: absolute;
      inset-inline-start: 0.1875rem;
    }
    .answer-steps li::before {
      top: 0.5lh;
      width: 0.5625rem;
      border-top: 1px solid var(--signal);
    }
    .answer-steps li::after {
      top: 0;
      bottom: -0.75rem;
      border-inline-start: 1px solid var(--signal);
    }
    .answer-steps li:first-child::after {
      top: 0.5lh;
    }
    .answer-steps li:last-child::after {
      bottom: auto;
      height: 0.5lh;
    }
  `,
})
export class AboutSectionComponent {
  readonly lang = inject(LanguageService);

  protected readonly chrome = computed(() => CHROME[this.lang.lang()].about);
  protected readonly answer = computed(() => ANSWER_STEPS[this.lang.lang()]);

  protected readonly identity = computed(() => this.lang.content().identity);
  protected readonly bio = computed(() => this.lang.t().about.bio?.trim() ?? "");

  /** Where he is, since when he has worked (with work experience), and whether he is available. */
  protected readonly facts = computed(() => {
    const { identity, experiences } = this.lang.content();
    const t = this.lang.t();
    const c = this.chrome();
    // ISO dates: the smallest string is the earliest start.
    const since = experiences
      .filter((e) => e.kind === "work")
      .reduce<string>(
        (first, e) => (!first || e.period.start < first ? e.period.start : first),
        "",
      );
    return [
      {
        label: c.based,
        value: placeName(identity.location, this.lang.lang()) || t.profile.location,
        dot: "",
      },
      ...(since ? [{ label: c.since, value: since.slice(0, 4), dot: "" }] : []),
      {
        label: c.status,
        value: availabilityLabel(t.hero, identity.availability),
        dot: AVAILABILITY_DOT[identity.availability],
      },
    ];
  });
}
