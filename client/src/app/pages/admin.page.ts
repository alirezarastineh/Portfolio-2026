import { DOCUMENT, isPlatformBrowser } from "@angular/common";
import {
  provideHttpClient,
  withInterceptors,
  withRequestsMadeViaParent,
} from "@angular/common/http";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injector,
  PLATFORM_ID,
  signal,
  untracked,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { NavigationEnd, Router, RouterLink, RouterOutlet } from "@angular/router";
import type { RouteMeta } from "@analogjs/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideBriefcase,
  lucideExternalLink,
  lucideEye,
  lucideFileText,
  lucideHistory,
  lucideHouse,
  lucideImage,
  lucideImages,
  lucideInbox,
  lucideKeyboard,
  lucideLayers,
  lucideLogOut,
  lucideNewspaper,
  lucideCircleCheck,
  lucidePenLine,
  lucidePlus,
  lucideRocket,
  lucideScale,
  lucideSearch,
  lucideSend,
  lucideShare2,
  lucideSparkles,
  lucideSquareUser,
  lucideSunMoon,
  lucideUser,
} from "@ng-icons/lucide";
import type { BrnDialogState } from "@spartan-ng/brain/dialog";
import { toast } from "@spartan-ng/brain/sonner";
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
import { PublishDialogComponent } from "../admin/components/publish-dialog.component";
import {
  isShortcutTarget,
  ShortcutSheetComponent,
} from "../admin/components/shortcut-sheet.component";
import { createBlankPost, createBlankProject } from "../admin/create-entities";
import { MediaLibraryService } from "../admin/media-library.service";
import { LivePreviewService } from "../admin/preview/live-preview.service";
import { changesLabel } from "../admin/publish-summary";
import { AdminPulseService } from "../admin/pulse.service";
import { UiSectionService } from "../admin/ui-section.service";
import { UnsavedChangesService } from "../admin/unsaved-changes.service";
import { ThemeService } from "../services/theme.service";

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
    AdminPulseService,
    AdminSessionService,
    LivePreviewService,
    MediaLibraryService,
    UiSectionService,
  ],
};

interface NavItem {
  path: string;
  label: string;
  icon: string;
  group: "Overview" | "Content";
}

/** Something a sidebar entry reports: a count, or an alert, with the words for it. */
interface NavBadge {
  count: number;
  alert: boolean;
  /** Read after the entry's name: "Inbox, 2 new". */
  words: string;
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
  // Last in Content rather than a group of one: its label and padding cost a row.
  { path: "/admin/media", label: "Media", icon: "lucideImages", group: "Content" },
];

const GROUPS: NavItem["group"][] = ["Overview", "Content"];

/** Long enough for the palette to close and give focus back before an action takes it. */
const PALETTE_CLOSE_MS = 120;

/** Room kept above and below the current entry: clear of the list's faded edges. */
const ENTRY_MARGIN = 40;

/**
 * Scrolls the sidebar's list, and only it, until the current page's entry is
 * in view (`scrollIntoView` would move the page too).
 */
function revealCurrentEntry(doc: Document): void {
  const list = doc.querySelector<HTMLElement>('[data-slot="sidebar-content"]');
  const entry = list?.querySelector<HTMLElement>('[aria-current="page"]');
  if (!list || !entry) return;
  const area = list.getBoundingClientRect();
  const box = entry.getBoundingClientRect();
  if (box.top < area.top + ENTRY_MARGIN) {
    list.scrollTop -= area.top + ENTRY_MARGIN - box.top;
  } else if (box.bottom > area.bottom - ENTRY_MARGIN) {
    list.scrollTop += box.bottom - (area.bottom - ENTRY_MARGIN);
  }
}

/** A new tab that cannot reach back into the admin. */
function openTab(href: string): void {
  const opened = window.open(href, "_blank");
  if (opened) opened.opener = null;
}

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
    PublishDialogComponent,
    RouterLink,
    RouterOutlet,
    ShortcutSheetComponent,
  ],
  viewProviders: [
    provideIcons({
      lucideBriefcase,
      lucideCircleCheck,
      lucideExternalLink,
      lucideEye,
      lucideFileText,
      lucideHistory,
      lucideHouse,
      lucideImage,
      lucideImages,
      lucideInbox,
      lucideKeyboard,
      lucideLayers,
      lucideLogOut,
      lucideNewspaper,
      lucidePenLine,
      lucidePlus,
      lucideRocket,
      lucideScale,
      lucideSearch,
      lucideSend,
      lucideShare2,
      lucideSparkles,
      lucideSquareUser,
      lucideSunMoon,
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
        <!-- A landmark of its own: everything in it is the admin's navigation. -->
        <hlm-sidebar collapsible="icon" role="navigation" aria-label="Admin">
          <div hlmSidebarHeader>
            <!-- The public site's mark; collapsed to icons, the mark alone. -->
            <a
              routerLink="/admin"
              class="flex h-8 items-center gap-2 px-2 font-mono text-sm font-semibold text-foreground group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:justify-center"
            >
              <span aria-hidden="true"
                ><span class="text-accent-orange">&gt;</span
                ><span class="wordmark-caret">_</span></span
              >
              <span class="group-data-[collapsible=icon]:sr-only">admin</span>
            </a>
          </div>

          <div hlmSidebarContent>
            @for (group of groups; track group) {
              <div hlmSidebarGroup>
                <div hlmSidebarGroupLabel>{{ group }}</div>
                <div hlmSidebarGroupContent>
                  <ul hlmSidebarMenu>
                    @for (item of itemsIn(group); track item.path) {
                      @let badge = badges()[item.path];
                      @let dirty = unsaved.hasAny() && isCurrent(item.path);
                      <li hlmSidebarMenuItem>
                        <!-- Named in full, so it keeps a name collapsed to icons, where the words hide. -->
                        <a
                          hlmSidebarMenuButton
                          class="relative group-has-data-[sidebar=menu-badge]/menu-item:pr-9"
                          [routerLink]="item.path"
                          [isActive]="isCurrent(item.path)"
                          [tooltip]="item.label"
                          [attr.aria-label]="navName(item.label, badge, dirty)"
                          [attr.aria-current]="isCurrent(item.path) ? 'page' : null"
                        >
                          <ng-icon [name]="item.icon" size="16" aria-hidden="true" />
                          <span>{{ item.label }}</span>
                          @if (badge || dirty) {
                            <i
                              class="absolute right-1 top-1 hidden size-1.5 rounded-full group-data-[collapsible=icon]:block"
                              [class]="badge?.alert ? 'bg-destructive' : 'bg-accent-orange'"
                              aria-hidden="true"
                            ></i>
                          }
                        </a>
                        @if (badge || dirty) {
                          <span hlmSidebarMenuBadge class="gap-1.5" aria-hidden="true">
                            @if (dirty) {
                              <span
                                class="size-1.5 rounded-full bg-accent-orange"
                                title="Unsaved changes"
                              ></span>
                            }
                            @if (badge?.alert) {
                              <span class="size-2 rounded-full bg-destructive"></span>
                            } @else if (badge?.count) {
                              <span class="font-mono text-xs">{{ badge?.count }}</span>
                            }
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
              <!-- Always in reach: publishing needs no trip to the dashboard. -->
              <li hlmSidebarMenuItem>
                <button
                  hlmSidebarMenuButton
                  variant="outline"
                  class="relative"
                  [disabled]="!pulse.unpublished()"
                  [tooltip]="publishName()"
                  [attr.aria-label]="publishName()"
                  (click)="pulse.publishOpen.set(true)"
                >
                  <ng-icon
                    [name]="pulse.unpublished() ? 'lucideRocket' : 'lucideCircleCheck'"
                    size="16"
                    aria-hidden="true"
                  />
                  <span>{{ pulse.unpublished() ? "Publish" : "All published" }}</span>
                  @if (pulse.unpublished()) {
                    @if (pendingCount(); as n) {
                      <span
                        class="ml-auto rounded-full px-1.5 font-mono text-xs"
                        [class]="
                          pulse.review()?.issues
                            ? 'bg-destructive/15 text-destructive'
                            : 'bg-accent-orange-soft text-foreground'
                        "
                        >{{ n }}</span
                      >
                    }
                    <i
                      class="absolute right-1 top-1 hidden size-1.5 rounded-full bg-accent-orange group-data-[collapsible=icon]:block"
                      aria-hidden="true"
                    ></i>
                  }
                </button>
              </li>
              <!-- The account and signing out share a row (stacked when collapsed to icons):
                   a row less keeps the whole list in view on a laptop's screen. -->
              <li
                hlmSidebarMenuItem
                class="flex items-center gap-1 group-data-[collapsible=icon]:flex-col"
              >
                <a
                  hlmSidebarMenuButton
                  class="min-w-0 flex-1"
                  routerLink="/admin/account"
                  [isActive]="isCurrent('/admin/account')"
                  [tooltip]="email()"
                  [attr.aria-label]="'Account: ' + email()"
                >
                  <ng-icon name="lucideUser" size="16" aria-hidden="true" />
                  <span class="truncate">{{ email() }}</span>
                </a>
                <button
                  hlmSidebarMenuButton
                  class="w-auto shrink-0"
                  tooltip="Sign out"
                  title="Sign out"
                  aria-label="Sign out"
                  (click)="logout()"
                >
                  <ng-icon name="lucideLogOut" size="16" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </div>
        </hlm-sidebar>

        <!-- Clipped sideways: a stuck page header's surface reaches past the column to both edges. -->
        <main hlmSidebarInset class="min-w-0 overflow-x-clip">
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
              class="ml-auto hidden gap-2 text-muted-foreground sm:inline-flex"
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K"
              (click)="paletteOpen.set(true)"
            >
              <ng-icon name="lucideSearch" size="14" aria-hidden="true" />
              <span>Jump to…</span>
              <kbd class="kbd" aria-hidden="true">⌘K</kbd>
            </button>
          </header>

          <!-- The page header's own padding makes up the top. -->
          <div class="px-6 pb-8 pt-5">
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
        description="Go to any admin section, or run an action"
      >
        <!-- Each opening starts from an empty search. -->
        <hlm-command [(search)]="paletteSearch">
          <hlm-command-input placeholder="Jump to a section or action…" />
          <hlm-command-list>
            <div hlmCommandEmpty>Nothing matches.</div>
            <hlm-command-group>
              <hlm-command-group-label>Actions</hlm-command-group-label>
              <!-- Always listed, so the list's order (and the first, active item) is fixed from the start. -->
              <button
                hlmCommandItem
                value="Review and publish"
                [disabled]="!pulse.unpublished()"
                (selected)="after(publish)"
              >
                <ng-icon name="lucideRocket" size="14" aria-hidden="true" />
                <span class="ml-2">Review and publish…</span>
                @if (!pulse.unpublished()) {
                  <span class="ml-auto font-mono text-xs text-muted-foreground">all published</span>
                }
              </button>
              <button
                hlmCommandItem
                value="Preview the draft in English"
                (selected)="after(previewEn)"
              >
                <ng-icon name="lucideExternalLink" size="14" aria-hidden="true" />
                <span class="ml-2">Preview the draft in English</span>
                <span class="sr-only">(opens in a new tab)</span>
              </button>
              <button
                hlmCommandItem
                value="Preview the draft in German"
                (selected)="after(previewDe)"
              >
                <ng-icon name="lucideExternalLink" size="14" aria-hidden="true" />
                <span class="ml-2">Preview the draft in German</span>
                <span class="sr-only">(opens in a new tab)</span>
              </button>
              <button hlmCommandItem value="New project" (selected)="after(newProject)">
                <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
                <span class="ml-2">New project</span>
              </button>
              <button hlmCommandItem value="New post" (selected)="after(newPost)">
                <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
                <span class="ml-2">New post</span>
              </button>
              <button hlmCommandItem [value]="themeLabel()" (selected)="after(toggleTheme)">
                <ng-icon name="lucideSunMoon" size="14" aria-hidden="true" />
                <span class="ml-2">{{ themeLabel() }}</span>
              </button>
              <button hlmCommandItem value="Keyboard shortcuts" (selected)="after(showShortcuts)">
                <ng-icon name="lucideKeyboard" size="14" aria-hidden="true" />
                <span class="ml-2">Keyboard shortcuts</span>
                <kbd class="kbd ml-auto" aria-hidden="true">?</kbd>
              </button>
            </hlm-command-group>
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

      <!-- The one review dialog: the sidebar's Publish, the dashboard and the palette open it. -->
      <app-publish-dialog
        [open]="pulse.publishOpen()"
        (openChange)="pulse.publishOpen.set($event)"
        (published)="pulse.published()"
      />

      <app-shortcut-sheet [(open)]="shortcutsOpen" />
    }
  `,
})
export default class AdminLayout {
  private readonly api = inject(AdminApiService);
  private readonly router = inject(Router);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly session = inject(AdminSessionService);
  protected readonly unsaved = inject(UnsavedChangesService);
  protected readonly pulse = inject(AdminPulseService);

  private readonly theme = inject(ThemeService);

  protected readonly groups = GROUPS;
  protected readonly email = computed(() => this.session.user()?.email ?? "account");
  protected readonly paletteOpen = signal(false);
  protected readonly paletteSearch = signal("");
  protected readonly shortcutsOpen = signal(false);

  constructor() {
    const doc = inject(DOCUMENT);
    const injector = inject(Injector);
    addAdminStyles(doc);

    // On a short window the sidebar's list scrolls: the page's own entry is
    // brought into it after each navigation (Media, say, is last).
    effect(() => {
      this.url();
      if (!this.ready()) return;
      afterNextRender({ read: () => revealCurrentEntry(doc) }, { injector });
    });

    // A fresh search each time the palette opens.
    effect(() => {
      if (this.paletteOpen()) untracked(() => this.paletteSearch.set(""));
    });

    // The counts load once the admin shows, and are dropped at the sign-in screen.
    effect(() => {
      const login = this.isLogin();
      const chrome = this.ready() && !login && !this.isPreviewFrame();
      untracked(() => {
        if (chrome) this.pulse.start();
        else if (login) this.pulse.reset();
      });
    });
  }

  /** Per sidebar entry: what needs a look there. */
  protected readonly badges = computed<Partial<Record<string, NavBadge>>>(() => {
    const badges: Partial<Record<string, NavBadge>> = {};
    const translations = this.pulse.i18n()?.length ?? 0;
    if (translations) {
      badges["/admin"] = {
        count: translations,
        alert: false,
        words: `${translations} ${translations === 1 ? "translation" : "translations"} to check`,
      };
    }
    const fresh = this.pulse.newMessages();
    if (fresh) badges["/admin/inbox"] = { count: fresh, alert: false, words: `${fresh} new` };
    const alert = this.pulse.assistantAlert();
    if (alert) badges["/admin/assistant"] = { count: 0, alert: true, words: alert };
    return badges;
  });

  /** The number on the Publish button: changes, or the problems that stop them. */
  protected readonly pendingCount = computed(() => {
    const review = this.pulse.review();
    if (!review) return 0;
    return review.issues || review.total;
  });

  protected readonly publishName = computed(() => {
    if (!this.pulse.unpublished()) return "All published";
    const review = this.pulse.review();
    if (review?.issues) {
      return `Publish: ${review.issues} ${review.issues === 1 ? "problem" : "problems"} to fix first`;
    }
    return review?.total ? `Publish: ${changesLabel(review.total)} unpublished` : "Publish";
  });

  protected navName(label: string, badge: NavBadge | undefined, dirty: boolean): string {
    const parts = [label];
    if (badge) parts.push(badge.words);
    if (dirty) parts.push("unsaved changes");
    return parts.join(", ");
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
      return;
    }
    if (event.key === "?" && isShortcutTarget(event)) {
      event.preventDefault();
      this.shortcutsOpen.set(true);
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

  /**
   * A palette action runs once the palette has closed and handed focus back,
   * so a dialog it opens keeps the focus.
   */
  protected after(action: () => void | Promise<void>): void {
    this.paletteOpen.set(false);
    setTimeout(() => void action(), PALETTE_CLOSE_MS);
  }

  protected readonly publish = (): void => this.pulse.publishOpen.set(true);
  protected readonly previewEn = (): void => openTab("/admin/preview/en");
  protected readonly previewDe = (): void => openTab("/admin/preview/de");
  protected readonly toggleTheme = (): void => this.theme.toggle();
  protected readonly showShortcuts = (): void => this.shortcutsOpen.set(true);

  protected readonly newProject = async (): Promise<void> => {
    const created = await createBlankProject(this.api);
    if (!created.ok) {
      toast.error("Could not add project", { description: created.error });
      return;
    }
    await this.openCreated(["/admin/projects", created.slug], "Project added");
  };

  protected readonly newPost = async (): Promise<void> => {
    const created = await createBlankPost(this.api);
    if (!created.ok) {
      toast.error("Could not create the post", { description: created.error });
      return;
    }
    await this.openCreated(["/admin/writing", created.slug], "Post created");
  };

  /** Opens what was just created, unless leaving the page was refused (unsaved edits). */
  private async openCreated(path: string[], done: string): Promise<void> {
    const went = await this.router.navigate(path);
    if (!went)
      toast.success(done, { description: "It is in the list for when you are done here." });
  }

  protected readonly themeLabel = computed(() =>
    this.theme.theme() === "dark" ? "Switch to the light theme" : "Switch to the dark theme",
  );

  protected async logout(): Promise<void> {
    await this.api.logout();
    this.pulse.reset();
    this.session.clear();
    void this.router.navigate(["/admin/login"]);
  }
}
