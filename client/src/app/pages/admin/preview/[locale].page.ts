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

/** The assistant's ways in on the site's pages: inert here, where it does not answer. */
const ASK_ENTRIES =
  "app-ask-stage, button.reader-ask, button.code-explain, button.reader-ask-selection";

/** A request's URL string, whether passed as a string, `URL`, or `Request`. */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

/** A request to the assistant's API (`/v1/ask…`), whatever its host. */
function toAssistant(input: RequestInfo | URL): boolean {
  return new URL(requestUrl(input), location.href).pathname.includes("/v1/ask");
}

/**
 * The public shell's scope, made here: an element of the same name, so the site's rules for
 * `app-public-shell` (`styles.css`, `public-theme.css`: hyphens, wrapping, selection, more
 * contrast) reach the draft, while the real shell (its Ask pill, palette and analytics) and its
 * code never load. Admin code imports no public shell.
 */
@Component({
  selector: "app-public-shell",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "block min-h-screen pt-[env(safe-area-inset-top)]" },
  template: "<ng-content />",
})
class DraftShell {}

@Component({
  selector: "app-admin-preview-frame",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DraftShell, RouterLink, RouterOutlet, SiteFooterComponent, SiteHeaderComponent],
  host: { class: "block min-h-screen" },
  template: `
    <app-public-shell>
      @if (state.ready()) {
        <app-site-header />
        <router-outlet />
        <app-site-footer />
      } @else if (state.error()) {
        <main id="main" class="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-24">
          <h1 class="m-0 text-page-title">This draft cannot be previewed</h1>
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
                    <code class="font-mono text-xs break-all">{{
                      issue.label ?? issue.path.join(".")
                    }}</code>
                    <span class="ml-2 text-sm">{{ issue.message }}</span>
                  </span>
                  @if (issue.link) {
                    <a class="text-sm underline underline-offset-4" [routerLink]="issue.link"
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
        <p class="m-0 px-6 py-24 text-center text-sm text-muted-foreground" role="status">
          Loading the draft…
        </p>
      }
    </app-public-shell>

    <!-- The admin's own words over the site: which draft, the other language, and what does not work here. -->
    <aside
      class="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-50 flex max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-border-strong bg-card px-3 py-2 text-sm text-foreground shadow-e3"
      aria-label="Draft preview"
    >
      <div class="flex flex-wrap items-center gap-x-1">
        <span class="mr-2 flex items-center gap-2 font-medium">
          <span class="size-2 shrink-0 rounded-full bg-signal" aria-hidden="true"></span>
          Draft preview, {{ name(state.locale()) }}
        </span>
        <a
          class="inline-flex min-h-8 touch-manipulation items-center rounded-sm px-2 underline-offset-4 hover:underline"
          [href]="switchHref()"
          [attr.hreflang]="other()"
          (click)="switchLocale($event)"
          >{{ name(other()) }}</a
        >
        <button
          type="button"
          class="inline-flex min-h-8 cursor-pointer touch-manipulation items-center rounded-sm px-2 underline-offset-4 hover:underline"
          (click)="refresh()"
        >
          Refresh
        </button>
        <a
          class="inline-flex min-h-8 touch-manipulation items-center rounded-sm px-2 underline-offset-4 hover:underline"
          routerLink="/admin/preview"
          >Close</a
        >
      </div>
      <p class="m-0 text-hint text-muted-foreground">
        The assistant answers only on the live site.
      </p>
    </aside>
  `,
})
export default class AdminPreviewFrame {
  protected readonly state = inject(PreviewState);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

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
    const root: HTMLElement = this.host.nativeElement;
    const click = (event: MouseEvent) => this.onClick(event);
    const submit = (event: Event) => this.onSubmit(event);
    // The pages add the assistant's ways in as they render; a selection's button goes on `body`.
    const still = () => {
      for (const entry of root.ownerDocument.querySelectorAll<HTMLElement>(ASK_ENTRIES)) {
        entry.inert = true;
      }
    };
    let entries: MutationObserver | undefined;
    afterNextRender(() => {
      // Capture phase: before the link's own handler (RouterLink) runs.
      root.addEventListener("click", click, { capture: true });
      root.addEventListener("submit", submit, { capture: true });
      entries = new MutationObserver(still);
      entries.observe(root.ownerDocument.body, { childList: true, subtree: true });
      still();
    });
    // No request leaves for the assistant from this tab, whatever a page asks (read next's map, a
    // question): refused in the browser, never sent.
    const fetchFirst = isPlatformBrowser(inject(PLATFORM_ID)) ? globalThis.fetch : undefined;
    if (fetchFirst) {
      globalThis.fetch = (input, init) =>
        toAssistant(input)
          ? Promise.reject(new TypeError("The assistant answers only on the live site."))
          : fetchFirst(input, init);
    }
    inject(DestroyRef).onDestroy(() => {
      root.removeEventListener("click", click, { capture: true });
      root.removeEventListener("submit", submit, { capture: true });
      entries?.disconnect();
      if (fetchFirst) {
        globalThis.fetch = fetchFirst;
      }
    });
  }

  protected name(locale: string): string {
    return locale === "de" ? "German" : "English";
  }

  protected switchLocale(event: MouseEvent): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void this.router.navigateByUrl(this.switchHref());
  }

  protected refresh(): void {
    // A fresh app, so every store fetches the draft again.
    location.reload();
  }

  private onClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0) {
      return;
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }

    const target = previewTarget(new URL(anchor.href), location.origin);
    if (!target) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if ("navigate" in target) {
      void this.router.navigateByUrl(target.navigate);
    } else if ("hold" in target) {
      toast.info("Not opened", { description: target.hold });
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
