import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";

import { PictureComponent } from "../components/picture.component";
import { SectionHeadingComponent } from "../components/section-heading.component";
import { AVAILABILITY_DOT, availabilityLabel } from "../content/availability";
import { placeName } from "../content/place";
import { CHROME } from "../i18n/chrome";
import { LanguageService } from "../services/language.service";

/**
 * The About section: how he works, as prose, and beside it from `lg` (below it
 * on phones) a card with the person: photo, bio and a few facts. The assistant
 * that lived here is the panel every page opens (plan 4 U10).
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

        <div class="grid grid-cols-12 gap-x-(--col-gap) gap-y-8">
          <!-- The CMS may break it into paragraphs with new lines. -->
          <p
            class="col-span-12 m-0 max-w-[54ch] whitespace-pre-line text-pretty leading-relaxed text-foreground/85 lg:col-span-8"
          >
            {{ lang.t().about.philosophy }}
          </p>

          <!-- The person. -->
          <div class="surface-card col-span-12 flex flex-col gap-5 self-start p-6 lg:col-span-4">
            <div class="flex items-center gap-4">
              <div
                class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted font-mono text-muted-foreground"
              >
                @if (identity().avatar; as avatar) {
                  <app-picture
                    [image]="avatar"
                    alt=""
                    [sizes]="'64px'"
                    [imgClass]="'block size-full object-cover'"
                  />
                } @else {
                  <span aria-hidden="true">{{ initials() }}</span>
                }
              </div>
              <p class="m-0 flex min-w-0 flex-col">
                <span class="text-h4 text-foreground">{{ identity().name }}</span>
                <span class="font-mono text-meta text-muted-foreground">{{
                  identity().handle
                }}</span>
              </p>
            </div>
            @if (bio()) {
              <p class="m-0 text-pretty leading-relaxed text-muted-foreground">{{ bio() }}</p>
            }
            <dl class="facts border-t border-border pt-5">
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
          </div>
        </div>
      </div>
    </section>
  `,
})
export class AboutSectionComponent {
  readonly lang = inject(LanguageService);

  protected readonly chrome = computed(() => CHROME[this.lang.lang()].about);

  protected readonly identity = computed(() => this.lang.content().identity);
  protected readonly bio = computed(() => this.lang.t().about.bio?.trim() ?? "");
  protected readonly initials = computed(() =>
    this.identity()
      .name.split(/\s+/)
      .map((part) => part.charAt(0))
      .join("")
      .slice(0, 2)
      .toUpperCase(),
  );

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
