import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterLink, RouterOutlet } from "@angular/router";
import type { RouteMeta } from "@analogjs/router";
import { toast } from "@spartan-ng/brain/sonner";
import { filter, map } from "rxjs";

import { editorLinkFor } from "../../../admin/editor-links";
import { PREVIEW_PREFIX, previewedPath, previewTarget } from "../../../admin/preview/preview-links";
import {
  PREVIEW_PROVIDERS,
  PreviewState,
  previewContentResolver,
} from "../../../admin/preview/preview-route";
import { SiteFooterComponent } from "../../../components/site-footer.component";
import { SiteHeaderComponent } from "../../../components/site-header.component";
import { otherLocale, swapLocale } from "../../../content/locale";

/**
 * `/admin/preview/en/...`: the public site's own pages, rendered from the
 * unpublished draft. Everything below reads content through the stores these
 * providers replace, so what shows here is what the next publish would put
 * live. The admin layout renders this without its chrome (see `admin.page.ts`).
 */
export const routeMeta: RouteMeta = {
  providers: PREVIEW_PROVIDERS,
  resolve: { draft: previewContentResolver },
};

@Component({
  selector: "app-admin-preview-frame",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet, SiteFooterComponent, SiteHeaderComponent],
  host: { class: "block min-h-screen" },
  template: `
    @if (state.ready()) {
      <app-site-header />
      <router-outlet />
      <app-site-footer />
    } @else if (state.error()) {
      <main id="main" class="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-24">
        <h1 class="m-0 font-mono text-2xl tracking-tight">This draft cannot be previewed</h1>
        @if (state.issues().length) {
          <p class="m-0 text-sm text-muted-foreground">
            Publishing would refuse it for the same reasons. Fix these, then refresh.
          </p>
          <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
            @for (issue of issues(); track $index) {
              <li
                class="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span class="min-w-0">
                  <code class="font-mono text-[0.75rem] break-all">{{
                    issue.label ?? issue.path.join(".")
                  }}</code>
                  <span class="ml-2 text-sm">{{ issue.message }}</span>
                </span>
                @if (issue.link) {
                  <a
                    class="font-mono text-[0.78rem] underline underline-offset-4"
                    [routerLink]="issue.link"
                    >Fix</a
                  >
                }
              </li>
            }
          </ul>
        } @else {
          <p class="m-0 text-sm text-muted-foreground">
            The draft could not be loaded ({{ state.error() }}).
          </p>
        }
      </main>
    } @else {
      <p class="m-0 px-6 py-24 text-center font-mono text-sm text-muted-foreground" role="status">
        loading the draft…
      </p>
    }

    <aside
      class="fixed bottom-4 left-4 z-50 flex items-center gap-1 rounded-full border border-border bg-card/95 py-1 pl-3 pr-1 font-mono text-[0.72rem] text-foreground shadow-lg backdrop-blur"
      aria-label="Draft preview"
    >
      <span class="flex items-center gap-2 pr-1">
        <span class="size-2 rounded-full bg-accent-orange" aria-hidden="true"></span>
        draft preview
      </span>
      <a
        class="rounded-full px-2.5 py-1 uppercase hover:bg-muted"
        [href]="switchHref()"
        [attr.hreflang]="other()"
        [attr.aria-label]="'Preview in ' + (other() === 'de' ? 'German' : 'English')"
        (click)="switchLocale($event)"
        >{{ other() }}</a
      >
      <button
        type="button"
        class="cursor-pointer rounded-full px-2.5 py-1 hover:bg-muted"
        (click)="refresh()"
      >
        refresh
      </button>
      <a class="rounded-full px-2.5 py-1 hover:bg-muted" routerLink="/admin/preview">close</a>
    </aside>
  `,
})
export default class AdminPreviewFrame {
  protected readonly state = inject(PreviewState);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly issues = computed(() =>
    this.state.issues().map((issue) => ({ ...issue, link: editorLinkFor(issue) })),
  );

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  protected readonly other = computed(() => otherLocale(this.state.locale()));
  /** The same page in the other language, still in the preview. */
  protected readonly switchHref = computed(
    () => `${PREVIEW_PREFIX}${swapLocale(previewedPath(this.url()), this.other())}`,
  );

  constructor() {
    const root = this.host.nativeElement;
    const click = (event: MouseEvent) => this.onClick(event);
    const submit = (event: Event) => this.onSubmit(event);
    afterNextRender(() => {
      // Capture phase: before the link's own handler (RouterLink) runs.
      root.addEventListener("click", click, { capture: true });
      root.addEventListener("submit", submit, { capture: true });
    });
    inject(DestroyRef).onDestroy(() => {
      root.removeEventListener("click", click, { capture: true });
      root.removeEventListener("submit", submit, { capture: true });
    });
  }

  protected switchLocale(event: MouseEvent): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    void this.router.navigateByUrl(this.switchHref());
  }

  protected refresh(): void {
    // A fresh app, so every store fetches the draft again.
    location.reload();
  }

  private onClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const target = previewTarget(new URL(anchor.href), location.origin);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    if ("navigate" in target) {
      void this.router.navigateByUrl(target.navigate);
    } else {
      window.open(target.newTab, "_blank", "noopener");
    }
  }

  /** The contact form would send a real message: not from a preview. */
  private onSubmit(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    toast.info("Not sent", { description: "Forms do nothing in the draft preview." });
  }
}
