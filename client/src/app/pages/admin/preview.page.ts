import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from "@spartan-ng/helm/alert";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";

import { AdminApiService } from "../../admin/admin-api.service";
import { LocaleToggleComponent } from "../../admin/components/editor-chrome.component";
import type { LocaleView } from "../../admin/components/field-pair.component";
import type { AppContent, Locale } from "../../content/schema";

/**
 * Renders the *draft* — the working tables as they stand, before publishing.
 *
 * Deliberately a structured read-out rather than an iframe of the public site:
 * the public site only ever serves published snapshots, so an iframe would show
 * the old content and quietly mislead. This calls the same builder that publish
 * uses, so what you see here is exactly what publishing would produce.
 */
@Component({
  selector: "app-admin-preview",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmBadge,
    HlmButton,
    HlmSkeleton,
    LocaleToggleComponent,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="m-0 font-mono text-2xl tracking-tight">Preview draft</h1>
          <p class="mt-1 text-sm text-muted-foreground">
            What publishing would produce right now. Visitors still see the last
            published version.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <app-locale-toggle [(view)]="view" />
          <button hlmBtn variant="outline" (click)="load()">Refresh</button>
        </div>
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-96 w-full" />
      } @else if (error()) {
        <div hlmAlert variant="destructive">
          <h2 hlmAlertTitle>The draft is not publishable</h2>
          <p hlmAlertDescription>{{ error() }}</p>
        </div>
      } @else {
        <div [class]="view() === 'both' ? 'grid gap-6 lg:grid-cols-2' : 'grid gap-6'">
          @for (locale of visibleLocales(); track locale) {
            @if (contentFor(locale); as c) {
              <section class="flex flex-col gap-4 rounded-xl border border-border p-4">
                <div class="flex items-center gap-2">
                  <span hlmBadge variant="secondary" class="font-mono uppercase">{{ locale }}</span>
                  <span class="font-mono text-[0.7rem] text-muted-foreground">draft</span>
                </div>

                <div>
                  <p class="m-0 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">Hero</p>
                  <p class="m-0 mt-1 text-lg font-medium leading-snug">{{ c.ui.profile.heroHeadline }}</p>
                  <p class="m-0 mt-1 text-sm text-muted-foreground">{{ c.ui.profile.heroSubheadline }}</p>
                  <p class="m-0 mt-1 font-mono text-[0.72rem] text-muted-foreground">
                    {{ c.identity.handle }} · {{ c.ui.profile.role }}
                  </p>
                </div>

                <div>
                  <p class="m-0 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                    {{ c.ui.about.heading }}
                  </p>
                  <p class="m-0 mt-1 line-clamp-4 text-sm text-muted-foreground">
                    {{ c.ui.about.philosophy }}
                  </p>
                </div>

                <div>
                  <p class="m-0 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                    Skills ({{ c.skills.length }})
                  </p>
                  <ul class="m-0 mt-1 flex list-none flex-wrap gap-1.5 p-0" role="list">
                    @for (s of c.skills; track s.id) {
                      <li class="rounded border border-border px-2 py-0.5 font-mono text-[0.7rem]">
                        {{ s.title }}
                      </li>
                    }
                  </ul>
                </div>

                <div>
                  <p class="m-0 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">
                    Projects ({{ c.projects.length }})
                  </p>
                  <ul class="m-0 mt-1 flex list-none flex-col gap-2 p-0" role="list">
                    @for (p of c.projects; track p.slug) {
                      <li class="rounded-lg border border-border p-2">
                        <p class="m-0 font-mono text-[0.8rem]">{{ p.name }}</p>
                        <p class="m-0 mt-0.5 text-[0.75rem] text-muted-foreground">{{ p.hook }}</p>
                      </li>
                    }
                  </ul>
                </div>

                <div>
                  <p class="m-0 font-mono text-[0.65rem] uppercase tracking-[0.2em] text-muted-foreground">SEO</p>
                  <p class="m-0 mt-1 text-sm">{{ c.seo.title }}</p>
                  <p class="m-0 mt-0.5 text-[0.75rem] text-muted-foreground">{{ c.seo.description }}</p>
                </div>
              </section>
            }
          }
        </div>
      }
    </div>
  `,
})
export default class AdminPreviewPage implements OnInit {
  private readonly api = inject(AdminApiService);

  protected readonly view = signal<LocaleView>("both");
  protected readonly loading = signal(true);
  protected readonly error = signal("");
  private readonly drafts = signal<Partial<Record<Locale, AppContent>>>({});

  ngOnInit(): void {
    void this.load();
  }

  protected visibleLocales(): Locale[] {
    return this.view() === "both" ? ["en", "de"] : [this.view() as Locale];
  }

  protected contentFor(locale: Locale): AppContent | undefined {
    return this.drafts()[locale];
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set("");

    const [en, de] = await Promise.all([this.api.preview("en"), this.api.preview("de")]);
    this.loading.set(false);

    // A 422 means the draft fails validation — exactly what publishing would
    // hit, so surface it here rather than letting Publish fail later.
    if (!en.ok) {
      this.error.set(
        en.status === 422
          ? "A required field is empty or invalid. Check the section editors."
          : en.error,
      );
      toast.error("Draft is not publishable");
      return;
    }

    if (!de.ok) {
      this.error.set(
        de.status === 422
          ? "A required field is empty or invalid. Check the section editors."
          : de.error,
      );
      toast.error("Draft is not publishable");
      return;
    }

    this.drafts.set({ en: en.data, de: de.data });
  }
}
