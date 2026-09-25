import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  provideHttpClient,
  withInterceptors,
  withRequestsMadeViaParent,
} from "@angular/common/http";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  PLATFORM_ID,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterLink, RouterOutlet } from "@angular/router";
import type { RouteMeta } from "@analogjs/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideBriefcase,
  lucideEye,
  lucideFileText,
  lucideHistory,
  lucideHouse,
  lucideImage,
  lucideImages,
  lucideInbox,
  lucideLayers,
  lucideLogOut,
  lucideNewspaper,
  lucidePenLine,
  lucideScale,
  lucideSearch,
  lucideSend,
  lucideShare2,
  lucideSparkles,
  lucideSquareUser,
  lucideUser,
} from "@ng-icons/lucide";
import type { BrnDialogState } from "@spartan-ng/brain/dialog";
import { HlmBreadcrumbImports } from "@spartan-ng/helm/breadcrumb";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmCommandImports } from "@spartan-ng/helm/command";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSidebarImports } from "@spartan-ng/helm/sidebar";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmToaster } from "@spartan-ng/helm/sonner";
import { filter } from "rxjs";

import { adminApiInterceptor } from "../admin/admin-api.interceptor";
import { adminAuthGuard } from "../admin/admin-auth.guard";
import { AdminApiService } from "../admin/admin-api.service";
import { addAdminStyles } from "../admin/admin-styles";
import { AdminSessionService } from "../admin/admin-session.service";
import { isSaveShortcut } from "../admin/components/editor-chrome.component";
import { MediaLibraryService } from "../admin/media-library.service";
import { UiSectionService } from "../admin/ui-section.service";
import { UnsavedChangesService } from "../admin/unsaved-changes.service";

export const routeMeta: RouteMeta = {
  title: "Admin",
  // Belt and braces alongside robots.txt and the Caddy X-Robots-Tag header.
  meta: [{ name: "robots", content: "noindex, nofollow" }],
  canActivateChild: [adminAuthGuard],
  /**
   * The admin's own HttpClient: credentials and the CSRF header on every API
   * call, on top of the app's interceptors. Provided here rather than at the
   * root so the interceptor and the API client ship in the admin's lazy chunk,
   * not in every visitor's bundle. The services that talk to the API are
   * provided alongside, so they get this client and not the root one.
   */
  providers: [
    provideHttpClient(withInterceptors([adminApiInterceptor]), withRequestsMadeViaParent()),
    AdminApiService,
    AdminSessionService,
    MediaLibraryService,
    UiSectionService,
  ],
};

interface NavItem {
  path: string;
  label: string;
  icon: string;
  group: "Overview" | "Content" | "Library";
}

const NAV: NavItem[] = [
  { path: "/admin", label: "Dashboard", icon: "lucideHouse", group: "Overview" },
  { path: "/admin/preview", label: "Preview draft", icon: "lucideEye", group: "Overview" },
  { path: "/admin/publications", label: "Publications", icon: "lucideHistory", group: "Overview" },
  { path: "/admin/inbox", label: "Inbox", icon: "lucideInbox", group: "Overview" },
  { path: "/admin/assistant", label: "Assistant", icon: "lucideSparkles", group: "Overview" },
  { path: "/admin/hero", label: "Hero & identity", icon: "lucideSquareUser", group: "Content" },
  { path: "/admin/about", label: "About", icon: "lucideFileText", group: "Content" },
  { path: "/admin/skills", label: "Skills", icon: "lucideLayers", group: "Content" },
  { path: "/admin/projects", label: "Projects", icon: "lucideImage", group: "Content" },
  { path: "/admin/experience", label: "Experience", icon: "lucideBriefcase", group: "Content" },
  { path: "/admin/writing", label: "Writing", icon: "lucideNewspaper", group: "Content" },
  { path: "/admin/contact", label: "Contact copy", icon: "lucideSend", group: "Content" },
  { path: "/admin/socials", label: "Socials", icon: "lucideShare2", group: "Content" },
  { path: "/admin/copy", label: "Page copy", icon: "lucidePenLine", group: "Content" },
  { path: "/admin/legal", label: "Legal pages", icon: "lucideScale", group: "Content" },
  { path: "/admin/seo", label: "SEO & meta", icon: "lucideSearch", group: "Content" },
  { path: "/admin/media", label: "Media", icon: "lucideImages", group: "Library" },
];

const GROUPS: NavItem["group"][] = ["Overview", "Content", "Library"];

@Component({
  selector: "app-admin-layout",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmBreadcrumbImports,
    HlmButton,
    HlmCommandImports,
    HlmSeparator,
    HlmSidebarImports,
    HlmSkeleton,
    HlmToaster,
    NgIcon,
    RouterLink,
    RouterOutlet,
  ],
  viewProviders: [
    provideIcons({
      lucideBriefcase,
      lucideEye,
      lucideFileText,
      lucideHistory,
      lucideHouse,
      lucideImage,
      lucideImages,
      lucideInbox,
      lucideLayers,
      lucideLogOut,
      lucideNewspaper,
      lucidePenLine,
      lucideScale,
      lucideSearch,
      lucideSend,
      lucideShare2,
      lucideSparkles,
      lucideSquareUser,
      lucideUser,
    }),
  ],
  host: {
    class: "block min-h-screen bg-background",
    "(document:keydown)": "onKeydown($event)",
  },
  template: `
    <!-- Browser only: the toaster reads window.matchMedia, which the server's DOM lacks. -->
    @if (isBrowser) {
      <hlm-toaster position="bottom-right" />
    }

    @if (!ready()) {
      <!-- SSR and the pre-hydration moment: the guard defers to the browser. -->
      <div class="mx-auto flex max-w-5xl flex-col gap-4 p-8">
        <hlm-skeleton class="h-8 w-48" />
        <hlm-skeleton class="h-4 w-72" />
        <hlm-skeleton class="h-64 w-full" />
      </div>
    } @else if (isLogin() || isPreviewFrame()) {
      <!-- The login screen, and the draft preview: the public site's own pages. -->
      <router-outlet />
    } @else {
      <div hlmSidebarWrapper>
        <hlm-sidebar collapsible="icon">
          <div hlmSidebarHeader>
            <a routerLink="/admin" class="flex items-center gap-2 px-2 py-1.5">
              <span class="size-2 shrink-0 rounded-full bg-accent-orange"></span>
              <span
                class="font-mono text-sm font-semibold tracking-tight group-data-[collapsible=icon]:hidden"
              >
                admin
              </span>
            </a>
          </div>

          <div hlmSidebarContent>
            @for (group of groups; track group) {
              <div hlmSidebarGroup>
                <div hlmSidebarGroupLabel>{{ group }}</div>
                <div hlmSidebarGroupContent>
                  <ul hlmSidebarMenu>
                    @for (item of itemsIn(group); track item.path) {
                      <li hlmSidebarMenuItem>
                        <a
                          hlmSidebarMenuButton
                          [routerLink]="item.path"
                          [isActive]="isCurrent(item.path)"
                          [attr.aria-current]="isCurrent(item.path) ? 'page' : null"
                        >
                          <ng-icon [name]="item.icon" size="16" aria-hidden="true" />
                          <span>{{ item.label }}</span>
                        </a>
                        @if (unsaved.hasAny() && isCurrent(item.path)) {
                          <span
                            hlmSidebarMenuBadge
                            title="Unsaved changes"
                            aria-label="Unsaved changes"
                          >
                            <span class="size-1.5 rounded-full bg-accent-orange"></span>
                          </span>
                        }
                      </li>
                    }
                  </ul>
                </div>
              </div>
            }
          </div>

          <div hlmSidebarFooter>
            <ul hlmSidebarMenu>
              <li hlmSidebarMenuItem>
                <a
                  hlmSidebarMenuButton
                  routerLink="/admin/account"
                  [isActive]="isCurrent('/admin/account')"
                >
                  <ng-icon name="lucideUser" size="16" aria-hidden="true" />
                  <span class="truncate">{{ email() }}</span>
                </a>
              </li>
              <li hlmSidebarMenuItem>
                <button hlmSidebarMenuButton (click)="logout()">
                  <ng-icon name="lucideLogOut" size="16" aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </li>
            </ul>
          </div>
        </hlm-sidebar>

        <main hlmSidebarInset class="min-w-0">
          <header class="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
            <button hlmSidebarTrigger aria-label="Toggle sidebar"></button>
            <hlm-separator orientation="vertical" class="h-4" />
            <nav hlmBreadcrumb aria-label="Breadcrumb">
              <ol hlmBreadcrumbList>
                <li hlmBreadcrumbItem>
                  <a hlmBreadcrumbLink routerLink="/admin">admin</a>
                </li>
                @if (currentItem(); as item) {
                  @if (item.path !== "/admin") {
                    <li hlmBreadcrumbSeparator></li>
                    <li hlmBreadcrumbItem>
                      <span hlmBreadcrumbPage>{{ item.label }}</span>
                    </li>
                  }
                }
                @if (projectSlug(); as slug) {
                  <li hlmBreadcrumbSeparator></li>
                  <li hlmBreadcrumbItem>
                    <span hlmBreadcrumbPage class="font-mono">{{ slug }}</span>
                  </li>
                }
              </ol>
            </nav>
            <button
              hlmBtn
              variant="outline"
              size="sm"
              class="ml-auto hidden gap-2 font-mono text-[0.72rem] text-muted-foreground sm:inline-flex"
              (click)="paletteOpen.set(true)"
              aria-label="Open the command palette"
            >
              <ng-icon name="lucideSearch" size="13" aria-hidden="true" />
              <span>Jump to…</span>
              <kbd class="rounded border border-border px-1 text-[0.65rem]">⌘K</kbd>
            </button>
          </header>

          <div class="px-6 py-8">
            @if (needsTotp()) {
              <div
                class="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-orange/40 bg-accent-orange/10 px-4 py-3"
                role="alert"
              >
                <p class="m-0 text-sm">
                  Two-factor authentication is not enabled. This panel is reachable from the public
                  internet.
                </p>
                <a hlmBtn size="sm" routerLink="/admin/account">Enable now</a>
              </div>
            }
            <router-outlet />
          </div>
        </main>
      </div>

      <hlm-command-dialog
        [state]="paletteOpen() ? 'open' : 'closed'"
        (stateChange)="onPaletteState($event)"
        title="Jump to"
        description="Go to any admin section"
      >
        <hlm-command>
          <hlm-command-input placeholder="Jump to a section…" />
          <hlm-command-list>
            <div hlmCommandEmpty>No section matches.</div>
            @for (group of groups; track group) {
              <hlm-command-group>
                <hlm-command-group-label>{{ group }}</hlm-command-group-label>
                @for (item of itemsIn(group); track item.path) {
                  <button hlmCommandItem [value]="item.label" (selected)="go(item.path)">
                    <ng-icon [name]="item.icon" size="14" aria-hidden="true" />
                    <span class="ml-2">{{ item.label }}</span>
                  </button>
                }
              </hlm-command-group>
            }
            <hlm-command-group>
              <hlm-command-group-label>Account</hlm-command-group-label>
              <button hlmCommandItem value="Account" (selected)="go('/admin/account')">
                <ng-icon name="lucideUser" size="14" aria-hidden="true" />
                <span class="ml-2">Account &amp; security</span>
              </button>
            </hlm-command-group>
          </hlm-command-list>
        </hlm-command>
      </hlm-command-dialog>
    }
  `,
})
export default class AdminLayout {
  private readonly api = inject(AdminApiService);
  private readonly router = inject(Router);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly session = inject(AdminSessionService);
  protected readonly unsaved = inject(UnsavedChangesService);

  protected readonly groups = GROUPS;
  protected readonly email = computed(() => this.session.user()?.email ?? "account");
  protected readonly paletteOpen = signal(false);

  constructor() {
    addAdminStyles(inject(DOCUMENT));
  }

  /** `router.url` is not reactive, so re-read it whenever navigation settles. */
  private readonly navigated = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)),
    { initialValue: null },
  );

  private readonly url = computed(() => {
    this.navigated();
    return this.router.url.split("?")[0] ?? "";
  });

  /** Nudged rather than hard-blocked: locking the only operator out of their
   * own panel over a second factor they have not set up yet is worse. */
  protected readonly needsTotp = computed(
    () => this.session.user() !== null && this.session.user()?.totpEnrolled === false,
  );

  /** The most specific nav entry for the current URL, for the breadcrumb. */
  protected readonly currentItem = computed(() => {
    const url = this.url();
    return (
      [...NAV]
        .sort((a, b) => b.path.length - a.path.length)
        .find((item) => (item.path === "/admin" ? url === "/admin" : url.startsWith(item.path))) ??
      (url.startsWith("/admin/account")
        ? {
            path: "/admin/account",
            label: "Account",
            icon: "lucideUser",
            group: "Overview" as const,
          }
        : null)
    );
  });

  protected readonly projectSlug = computed(() => {
    const match = /^\/admin\/(?:projects|writing)\/([^/]+)$/.exec(this.url());
    return match ? decodeURIComponent(match[1] ?? "") : null;
  });

  protected readonly isLogin = computed(() => this.url().startsWith("/admin/login"));

  /** `/admin/preview/<locale>/…` renders the public site without the admin around it. */
  protected readonly isPreviewFrame = computed(() => /^\/admin\/preview\/[^/?#]+/.test(this.url()));

  /**
   * The chrome stays hidden until the session has resolved, so a populated
   * sidebar never flashes at someone about to be bounced to the login screen.
   *
   * Login is exempt: the guard deliberately lets that route through without
   * calling `ensure()`, so waiting on `checked()` there would hang the form
   * behind a skeleton forever.
   */
  protected readonly ready = computed(() => {
    if (!this.isBrowser) return false;
    if (this.isLogin()) return true;
    return this.session.checked() && this.session.user() !== null;
  });

  protected itemsIn(group: NavItem["group"]): NavItem[] {
    return NAV.filter((item) => item.group === group);
  }

  protected isCurrent(path: string): boolean {
    const url = this.url();
    return path === "/admin" ? url === "/admin" : url.startsWith(path);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (this.isLogin() || this.isPreviewFrame() || !this.ready()) return;
    // Ctrl+S / ⌘S saves in an editor (its save bar handles it); elsewhere in
    // the admin it does nothing rather than offer to save the page as HTML.
    if (isSaveShortcut(event)) {
      event.preventDefault();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.paletteOpen.update((open) => !open);
    }
  }

  protected onPaletteState(state: BrnDialogState): void {
    this.paletteOpen.set(state === "open");
  }

  protected go(path: string): void {
    this.paletteOpen.set(false);
    // Navigation still passes through canDeactivate, so unsaved work is guarded.
    void this.router.navigateByUrl(path);
  }

  protected async logout(): Promise<void> {
    await this.api.logout();
    this.session.clear();
    void this.router.navigate(["/admin/login"]);
  }
}
