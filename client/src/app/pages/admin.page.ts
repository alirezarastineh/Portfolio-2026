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
  DestroyRef,
  effect,
  inject,
  Injector,
  PLATFORM_ID,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterOutlet,
  type ActivatedRouteSnapshot,
  type RouterStateSnapshot,
} from "@angular/router";
import type { RouteMeta } from "@analogjs/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideBot,
  lucideBriefcase,
  lucideChevronRight,
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
  lucideLink,
  lucideListChecks,
  lucideLogOut,
  lucideSignpost,
  lucideNewspaper,
  lucidePenLine,
  lucidePlus,
  lucideRefreshCw,
  lucideRocket,
  lucideScale,
  lucideSearch,
  lucideSend,
  lucideShare2,
  lucideSquareUser,
  lucideSunMoon,
  lucideTriangleAlert,
  lucideUser,
} from "@ng-icons/lucide";
import { BrnCommand } from "@spartan-ng/brain/command";
import type { BrnDialogState } from "@spartan-ng/brain/dialog";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmCommandImports } from "@spartan-ng/helm/command";
import { HlmDropdownMenuImports } from "@spartan-ng/helm/dropdown-menu";
import { HlmSidebarImports, HlmSidebarService } from "@spartan-ng/helm/sidebar";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmToaster } from "@spartan-ng/helm/sonner";
import { filter } from "rxjs";

import { adminApiInterceptor } from "../admin/admin-api.interceptor";
import { adminAuthGuard } from "../admin/admin-auth.guard";
import { AdminApiService } from "../admin/admin-api.service";
import { addAdminStyles } from "../admin/admin-styles";
import { AdminSessionService } from "../admin/admin-session.service";
import { ConfirmService } from "../admin/components/confirm-dialog.component";
import { isSaveShortcut } from "../admin/components/editor-chrome.component";
import { CopilotLedger } from "../admin/copilot-ledger";
import { PublishDialogComponent } from "../admin/components/publish-dialog.component";
import { RecoveryBannerComponent } from "../admin/components/recovery-banner.component";
import { SessionDialogComponent } from "../admin/components/session-dialog.component";
import {
  isRailKey,
  isShortcutTarget,
  ShortcutSheetComponent,
} from "../admin/components/shortcut-sheet.component";
import { createBlankPost, createBlankProject } from "../admin/create-entities";
import { MediaLibraryService } from "../admin/media-library.service";
import { inDraft } from "../admin/change-trace";
import { ACCOUNT, crumbsFor, navItemFor, PAGES, RAIL, remember, titleFor } from "../admin/nav";
import { LivePreviewService } from "../admin/preview/live-preview.service";
import { changesLabel } from "../admin/publish-summary";
import { AdminPulseService } from "../admin/pulse.service";
import { RecoveryService } from "../admin/recovery.service";
import { UiSectionService } from "../admin/ui-section.service";
import { UnsavedChangesService } from "../admin/unsaved-changes.service";
import { ThemeService } from "../services/theme.service";

export const routeMeta: RouteMeta = {
  title: adminTitle,
  // The title follows each page inside the layout, so it is worked out on every navigation.
  runGuardsAndResolvers: "always",
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
    CopilotLedger,
    LivePreviewService,
    MediaLibraryService,
    UiSectionService,
  ],
};

/** Something a rail entry reports: a count, or an alert, with the words for it. */
interface NavBadge {
  count: number;
  alert: boolean;
  /** Read after the entry's name: "Inbox, 2 new". */
  words: string;
}

/** The tab's title: the page, then the admin ("Legal · Admin"); a project or post leads with its slug. */
function adminTitle(_route: ActivatedRouteSnapshot, state: RouterStateSnapshot): string {
  return titleFor(state.url.split(/[?#]/)[0] ?? "");
}

type PublishState = "checking" | "failed" | "publish" | "published";

/** What Publish says: nothing is claimed before the server has answered. */
const PUBLISH: Record<PublishState, { word: string; icon: string | null }> = {
  checking: { word: "Checking…", icon: null },
  failed: { word: "Could not check", icon: "lucideRefreshCw" },
  publish: { word: "Publish", icon: null },
  published: { word: "All live", icon: "lucideCircleCheck" },
};

type ActionId =
  "publish" | "preview-en" | "preview-de" | "new-project" | "new-post" | "theme" | "keys";

interface PaletteAction {
  id: ActionId;
  label: string;
  icon: string;
  disabled?: boolean;
  /** Opens a new tab, said to a screen reader. */
  newTab?: boolean;
  /** Its own key, shown at the end. */
  key?: string;
  /** A state beside it ("checking…"). */
  note?: string;
}

/** A page visited or an action run, as Find keeps them in this browser. */
interface RecentEntry {
  key: string;
  path?: string;
  label?: string;
  action?: ActionId;
}

/** Projects, posts, experience and media by name: what Find searches as you type. */
interface FoundGroup {
  label: string;
  icon: string;
  items: { key: string; label: string; search: string; path: string }[];
}

const RECENT_KEY = "admin.find.recent";
const ACTION_IDS: ReadonlySet<string> = new Set<ActionId>([
  "publish",
  "preview-en",
  "preview-de",
  "new-project",
  "new-post",
  "theme",
  "keys",
]);

/** Long enough for the palette to close and give focus back before an action takes it. */
const PALETTE_CLOSE_MS = 120;

/** Room kept above and below the current entry: clear of the list's faded edges. */
const ENTRY_MARGIN = 40;

/**
 * Scrolls the rail's list, and only it, until the current page's entry is
 * in view (`scrollIntoView` would move the page too).
 */
function revealCurrentEntry(doc: Document): void {
  const list = doc.querySelector<HTMLElement>('[data-slot="sidebar-content"]');
  const entry = list?.querySelector<HTMLElement>('[aria-current="true"]');
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

/** Find's recent entries, as stored; anything else in storage is left out. */
function readRecent(): RecentEntry[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter(
      (entry: RecentEntry) =>
        typeof entry?.key === "string" &&
        (entry.path?.startsWith("/admin") === true ||
          (entry.action !== undefined && ACTION_IDS.has(entry.action))),
    );
  } catch {
    return [];
  }
}

@Component({
  selector: "app-admin-layout",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmButton,
    HlmCommandImports,
    HlmDropdownMenuImports,
    HlmSidebarImports,
    HlmSkeleton,
    HlmToaster,
    NgIcon,
    PublishDialogComponent,
    RecoveryBannerComponent,
    RouterLink,
    RouterOutlet,
    SessionDialogComponent,
    ShortcutSheetComponent,
  ],
  viewProviders: [
    provideIcons({
      lucideBot,
      lucideBriefcase,
      lucideChevronRight,
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
      lucideLink,
      lucideListChecks,
      lucideLogOut,
      lucideSignpost,
      lucideNewspaper,
      lucidePenLine,
      lucidePlus,
      lucideRefreshCw,
      lucideRocket,
      lucideScale,
      lucideSearch,
      lucideSend,
      lucideShare2,
      lucideSquareUser,
      lucideSunMoon,
      lucideTriangleAlert,
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
      <hlm-toaster position="bottom-right" [theme]="theme.theme()" />
      <app-session-dialog />
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
      <!-- The first stop: past the rail and the top bar, to the page's heading. -->
      <a
        href="#main"
        class="fixed left-2 top-2 z-50 -translate-y-16 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background focus:translate-y-0 pointer-coarse:py-3"
        (click)="skipToContent($event)"
        >Skip to content</a
      >

      <div hlmSidebarWrapper>
        <hlm-sidebar collapsible="icon">
          <!-- The landmark goes with the rail's content: into the sheet on a phone. -->
          <nav aria-label="Admin" class="flex min-h-0 flex-1 flex-col">
            <div
              hlmSidebarHeader
              class="h-12 shrink-0 justify-center border-b border-border px-4 py-0"
            >
              <p
                class="m-0 truncate text-sm font-semibold text-foreground group-data-[collapsible=icon]:hidden"
                translate="no"
              >
                Alireza Rastineh
              </p>
            </div>

            <div hlmSidebarContent>
              @for (group of rail; track $index) {
                <div hlmSidebarGroup>
                  @if (group.label) {
                    <div hlmSidebarGroupLabel [id]="'rail-group-' + $index">
                      {{ group.label }}
                    </div>
                  }
                  <div hlmSidebarGroupContent>
                    <ul
                      hlmSidebarMenu
                      [attr.aria-labelledby]="group.label ? 'rail-group-' + $index : null"
                    >
                      @for (item of group.items; track item.path) {
                        @let badge = badges()[item.path];
                        @let current = item === currentItem();
                        @let dirty = current && unsaved.hasAny();
                        @let draft = !dirty && notLive().has(item.path);
                        <li hlmSidebarMenuItem>
                          <!-- Named in full, so it keeps a name collapsed to icons, where the words hide. -->
                          <a
                            hlmSidebarMenuButton
                            class="relative data-sub:pl-8 group-has-data-[sidebar=menu-badge]/menu-item:pr-9"
                            [attr.data-sub]="item.parent ? '' : null"
                            [routerLink]="item.path"
                            [isActive]="current"
                            [tooltip]="item.label"
                            [attr.aria-label]="navName(item.label, badge, dirty, draft)"
                            [attr.aria-current]="current ? 'true' : null"
                          >
                            <ng-icon [name]="item.icon" size="16" aria-hidden="true" />
                            <span>{{ item.label }}</span>
                            @if (badge || dirty || draft) {
                              <!-- Collapsed to icons: a dot on the icon. -->
                              <i
                                class="absolute right-2.5 top-1 hidden size-2 rounded-full ring-2 ring-background forced-color-adjust-none forced-colors:bg-[Highlight] group-data-[collapsible=icon]:block"
                                [class]="
                                  dirty
                                    ? 'bg-signal'
                                    : draft
                                      ? 'bg-input-line forced-colors:bg-[GrayText]'
                                      : badge?.alert
                                        ? 'bg-destructive'
                                        : 'bg-foreground'
                                "
                                aria-hidden="true"
                              ></i>
                            }
                          </a>
                          @if (badge || dirty || draft) {
                            <span hlmSidebarMenuBadge aria-hidden="true">
                              <!-- Ringed in the page's colour: the signal on the current entry's
                                   surface is 2.97:1 in light, on the ring 3.3. -->
                              @if (dirty) {
                                <span
                                  class="size-2 rounded-full bg-signal ring-2 ring-background forced-color-adjust-none forced-colors:bg-[Highlight]"
                                  title="Unsaved changes"
                                ></span>
                              } @else if (draft) {
                                <span
                                  class="size-2 rounded-full bg-input-line ring-2 ring-background forced-color-adjust-none forced-colors:bg-[GrayText]"
                                  title="Changes not live"
                                ></span>
                              }
                              @if (badge?.alert) {
                                <span
                                  class="size-2 rounded-full bg-destructive forced-color-adjust-none forced-colors:bg-[Highlight]"
                                ></span>
                              } @else if (badge?.count) {
                                <span>{{ badge?.count }}</span>
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

            <div hlmSidebarFooter class="border-t border-border py-1.5">
              <ul hlmSidebarMenu>
                <!-- The account, the theme and signing out share a row (stacked when collapsed). -->
                <li
                  hlmSidebarMenuItem
                  class="flex items-center gap-1 group-data-[collapsible=icon]:flex-col"
                >
                  <a
                    hlmSidebarMenuButton
                    class="min-w-0 flex-1 text-hint group-data-[collapsible=icon]:flex-none"
                    routerLink="/admin/account"
                    [isActive]="accountCurrent()"
                    [tooltip]="email()"
                    [attr.aria-label]="'Account: ' + email()"
                    [attr.aria-current]="accountCurrent() ? 'true' : null"
                  >
                    <ng-icon name="lucideUser" size="16" aria-hidden="true" />
                    <span class="truncate">{{ email() }}</span>
                  </a>
                  <button
                    hlmSidebarMenuButton
                    class="w-8 shrink-0 justify-center pointer-coarse:w-11"
                    [closeMobileSidebarOnClick]="false"
                    [tooltip]="themeLabel()"
                    [title]="themeLabel()"
                    [attr.aria-label]="themeLabel()"
                    (click)="toggleTheme()"
                  >
                    <ng-icon name="lucideSunMoon" size="16" aria-hidden="true" />
                  </button>
                  <button
                    hlmSidebarMenuButton
                    class="w-8 shrink-0 justify-center pointer-coarse:w-11"
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
          </nav>
        </hlm-sidebar>

        <div hlmSidebarInset class="min-w-0">
          <!-- Clear of a notch on the right in landscape; the rail covers the left. -->
          <header
            class="sticky top-0 z-40 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background pl-2 pr-[max(0.5rem,env(safe-area-inset-right))] md:pl-3 md:pr-[max(0.75rem,env(safe-area-inset-right))]"
          >
            <button
              hlmSidebarTrigger
              aria-label="Navigation"
              aria-keyshortcuts="["
              title="Navigation ([)"
            ></button>

            <nav aria-label="Breadcrumb" class="min-w-0 flex-1">
              <ol class="m-0 flex min-w-0 list-none items-center gap-1 p-0 text-sm">
                @for (crumb of crumbs(); track crumb.path; let first = $first, last = $last) {
                  @if (!first) {
                    <li class="flex shrink-0 text-faint-foreground" aria-hidden="true">
                      <ng-icon name="lucideChevronRight" size="14" aria-hidden="true" />
                    </li>
                  }
                  @if (last) {
                    <li class="min-w-0">
                      <span
                        aria-current="page"
                        class="block truncate text-foreground"
                        [class.font-medium]="!crumb.value"
                        [class.text-data]="crumb.value"
                        [attr.translate]="crumb.value ? 'no' : null"
                        >{{ crumb.label }}</span
                      >
                    </li>
                  } @else {
                    <li class="shrink-0">
                      <a
                        class="inline-flex min-h-6 items-center text-muted-foreground hover:text-foreground hover:underline pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                        [routerLink]="crumb.path"
                        >{{ crumb.label }}</a
                      >
                    </li>
                  }
                }
              </ol>
            </nav>

            <!-- Find at every width: the word and its key from 768, the icon on a phone. -->
            <button
              hlmBtn
              variant="outline"
              size="sm"
              class="w-44 justify-start border-border-strong font-normal text-muted-foreground max-md:w-8 max-md:justify-center max-md:border-transparent max-md:px-0 max-md:pointer-coarse:w-11"
              aria-haspopup="dialog"
              aria-keyshortcuts="Control+K Meta+K"
              (click)="paletteOpen.set(true)"
            >
              <ng-icon name="lucideSearch" size="16" aria-hidden="true" />
              <span class="max-md:sr-only">Find</span>
              <kbd class="key-cap ml-auto max-md:hidden" aria-hidden="true">{{ paletteKey }}</kbd>
            </button>

            <!-- On a phone the draft opens from Find. -->
            <button
              hlmBtn
              variant="outline"
              size="sm"
              class="max-md:hidden"
              [hlmDropdownMenuTrigger]="previewMenu"
            >
              <ng-icon name="lucideEye" size="16" aria-hidden="true" />
              Preview
              <!-- Chevron-right turned down: chevron-down would join the icon chunk visitors load. -->
              <ng-icon name="lucideChevronRight" size="14" class="rotate-90" aria-hidden="true" />
            </button>
            <ng-template #previewMenu>
              <hlm-dropdown-menu class="w-40">
                <button hlmDropdownMenuItem (triggered)="previewEn()">
                  English<span class="sr-only">&ngsp;(opens in a new tab)</span>
                </button>
                <button hlmDropdownMenuItem (triggered)="previewDe()">
                  German<span class="sr-only">&ngsp;(opens in a new tab)</span>
                </button>
              </hlm-dropdown-menu>
            </ng-template>

            <!-- The one orange fill, while changes wait; quiet otherwise. -->
            <button
              hlmBtn
              size="sm"
              class="shrink-0"
              [variant]="publishState() === 'publish' ? 'signal' : 'outline'"
              [disabled]="publishState() === 'checking' || publishState() === 'published'"
              [attr.aria-label]="publishName()"
              (click)="onPublish()"
            >
              @if (publishIcon(); as icon) {
                <ng-icon [name]="icon" size="16" aria-hidden="true" />
              }
              {{ publishWords().word }}
              @if (publishState() === "publish" && pendingCount(); as n) {
                <!-- A kept space: "Publish 3", two words, as the name says it (axe's label-in-name). -->
                &ngsp;<span class="tabular-nums">{{ n }}</span>
              }
            </button>
          </header>

          <!-- Clipped sideways: a stuck page header's surface reaches past the column to both edges.
               Behind the open sheet on a phone, the page is inert. -->
          <main
            id="main"
            class="min-w-0 overflow-x-clip px-4 pb-8 pt-5 md:pl-6 md:pr-[max(1.5rem,env(safe-area-inset-right))]"
            [attr.inert]="sidebar.openMobile() ? '' : null"
          >
            <app-recovery-banner />
            <router-outlet />
          </main>
        </div>
      </div>

      <hlm-command-dialog
        [state]="paletteOpen() ? 'open' : 'closed'"
        (stateChange)="onPaletteState($event)"
        title="Find"
        description="Pages, actions, and projects, posts, experience and media files by name"
      >
        <!-- Each opening starts from an empty search. -->
        <hlm-command [(search)]="paletteSearch">
          <hlm-command-input placeholder="Find a page, an action or content…" />
          <hlm-command-list>
            <!-- Only when a search finds nothing: at rest the list is full. -->
            <div *hlmCommandEmptyState hlmCommandEmpty>
              @if (found().state === "loading") {
                Looking through projects, posts, experience and media…
              } @else {
                No matches. Find looks through pages, actions, projects, posts, experience and media
                file names.
              }
            </div>

            @if (!paletteSearch() && recent().length) {
              <hlm-command-group>
                <hlm-command-group-label>Recent</hlm-command-group-label>
                @for (entry of recent(); track entry.key) {
                  <button
                    hlmCommandItem
                    [value]="'recent ' + entry.key"
                    [disabled]="entry.disabled"
                    (selected)="openRecent(entry)"
                  >
                    <ng-icon [name]="entry.icon" size="14" aria-hidden="true" />
                    <span>{{ entry.label }}</span>
                  </button>
                }
              </hlm-command-group>
            }

            <hlm-command-group>
              <hlm-command-group-label>Actions</hlm-command-group-label>
              <!-- Always listed, so the list's order (and the first, active item) is fixed from the start. -->
              @for (action of actions(); track action.id) {
                <button
                  hlmCommandItem
                  [value]="action.label"
                  [disabled]="!!action.disabled"
                  (selected)="run(action.id)"
                >
                  <ng-icon [name]="action.icon" size="14" aria-hidden="true" />
                  <span>{{ action.label }}</span>
                  @if (action.newTab) {
                    <span class="sr-only">(opens in a new tab)</span>
                  }
                  @if (action.note) {
                    <span class="ml-auto text-xs text-muted-foreground">{{ action.note }}</span>
                  }
                  @if (action.key) {
                    <kbd class="key-cap ml-auto" aria-hidden="true">{{ action.key }}</kbd>
                  }
                </button>
              }
            </hlm-command-group>

            <hlm-command-group>
              <hlm-command-group-label>Pages</hlm-command-group-label>
              @for (item of pages; track item.path) {
                <button hlmCommandItem [value]="item.label" (selected)="go(item.path)">
                  <ng-icon [name]="item.icon" size="14" aria-hidden="true" />
                  <span>{{ item.label }}</span>
                </button>
              }
            </hlm-command-group>

            <!-- Content only once a search is typed: at rest it would bury the rest. -->
            @if (paletteSearch()) {
              @for (group of found().groups; track group.label) {
                <hlm-command-group>
                  <hlm-command-group-label>{{ group.label }}</hlm-command-group-label>
                  @for (item of group.items; track item.key) {
                    <button hlmCommandItem [value]="item.search" (selected)="go(item.path)">
                      <ng-icon [name]="group.icon" size="14" aria-hidden="true" />
                      <span class="truncate" translate="no">{{ item.label }}</span>
                    </button>
                  }
                </hlm-command-group>
              }
              @if (found().state === "failed") {
                <p class="m-0 px-2 py-3 text-hint text-muted-foreground">
                  Some content did not load, so Find covers less of it. It tries again when Find
                  opens next.
                </p>
              }
            }
          </hlm-command-list>
          <!-- What a search found, for a screen reader: the list itself says nothing. -->
          <p class="sr-only" aria-live="polite">{{ paletteStatus() }}</p>
        </hlm-command>
      </hlm-command-dialog>

      <!-- The one review dialog: the top bar's Publish, Today and Find open it. -->
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
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly doc = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  protected readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly session = inject(AdminSessionService);
  protected readonly unsaved = inject(UnsavedChangesService);
  protected readonly pulse = inject(AdminPulseService);
  protected readonly sidebar = inject(HlmSidebarService);
  private readonly recovery = inject(RecoveryService);

  protected readonly theme = inject(ThemeService);

  protected readonly rail = RAIL;
  protected readonly pages = PAGES;
  protected readonly email = computed(() => this.session.user()?.email ?? "account");
  protected readonly paletteOpen = signal(false);
  protected readonly paletteSearch = signal("");
  protected readonly shortcutsOpen = signal(false);
  private readonly command = viewChild(BrnCommand);
  private readonly recentEntries = signal<RecentEntry[]>(this.isBrowser ? readRecent() : []);
  protected readonly found = signal<{
    state: "idle" | "loading" | "ready" | "failed";
    groups: FoundGroup[];
  }>({ state: "idle", groups: [] });

  /** Stops waiting for a page's heading: the next navigation, or the person acting first. */
  private stopArrival: () => void = () => undefined;
  private destroyed = false;

  constructor() {
    addAdminStyles(this.doc);
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.stopArrival();
    });

    // On a short window the rail's list scrolls: the page's own entry is
    // brought into it after each navigation (Media, say, is near the end).
    effect(() => {
      this.url();
      if (!this.ready()) return;
      afterNextRender({ read: () => revealCurrentEntry(this.doc) }, { injector: this.injector });
    });

    // A navigation to another page starts it at the top, with its heading focused,
    // and Find remembers the page.
    let previous: string | null = null;
    effect(() => {
      const path = this.url();
      if (!this.ready() || this.isLogin() || this.isPreviewFrame()) return;
      untracked(() => {
        if (previous !== null && path !== previous) this.arrive();
        previous = path;
        this.rememberPage(path);
      });
    });

    // A fresh search each time the palette opens, from its first entry; content loads on the
    // first opening. The entries were made with this layout, before any page was visited, so
    // the first is chosen again here: the newest recent page, or the first action.
    effect(() => {
      if (!this.paletteOpen()) return;
      untracked(() => {
        this.paletteSearch.set("");
        this.command()?.keyManager.setFirstItemActive();
        void this.loadFound();
      });
    });

    // Content shows from the first search, and as its loads arrive: brain picks the active entry
    // before those render, so a hidden one would take Enter. The first one found is chosen after.
    effect(() => {
      this.paletteSearch();
      this.found();
      afterNextRender(
        () => {
          const keys = this.command()?.keyManager;
          if (keys && !keys.activeItem?.visible()) keys.setFirstItemActive();
        },
        { injector: this.injector },
      );
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

    effect(() => {
      const lost = this.session.lost();
      untracked(() => this.pulse.pause(lost));
    });
  }

  /** Per rail entry: what needs a look there. */
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

  /** The number on Publish: changes, or the problems that stop them. */
  protected readonly pendingCount = computed(() => {
    const review = this.pulse.review();
    if (!review) return 0;
    return review.issues || review.total;
  });

  protected readonly publishState = computed<PublishState>(() => {
    if (this.pulse.status() === null) {
      return this.pulse.failed().has("status") ? "failed" : "checking";
    }
    return this.pulse.unpublished() ? "publish" : "published";
  });
  protected readonly publishWords = computed(() => PUBLISH[this.publishState()]);
  /** Problems to fix first carry a warning sign beside the count: never colour alone. */
  protected readonly publishIcon = computed(() =>
    this.publishState() === "publish" && this.pulse.review()?.issues
      ? "lucideTriangleAlert"
      : this.publishWords().icon,
  );

  /** Ctrl K, or ⌘K on a Mac. */
  protected readonly paletteKey =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? "")
      ? "⌘K"
      : "Ctrl K";

  protected readonly publishName = computed(() => {
    const state = this.publishState();
    if (state === "failed") return "Could not check what is unpublished: try again";
    if (state !== "publish") return PUBLISH[state].word;
    const review = this.pulse.review();
    if (review?.issues) {
      return `Publish: ${review.issues} ${review.issues === 1 ? "problem" : "problems"} to fix first`;
    }
    return review?.total ? `Publish: ${changesLabel(review.total)} unpublished` : "Publish";
  });

  protected readonly themeLabel = computed(() =>
    this.theme.theme() === "dark" ? "Switch to the light theme" : "Switch to the dark theme",
  );

  /** Find's actions, in a fixed order: the first is the one Enter runs on opening. */
  protected readonly actions = computed<PaletteAction[]>(() => [
    {
      id: "publish",
      label: "Review and publish…",
      icon: "lucideRocket",
      disabled: !this.pulse.unpublished(),
      note: this.publishState() === "publish" ? "" : this.publishWords().word.toLowerCase(),
    },
    {
      id: "preview-en",
      label: "Preview the draft in English",
      icon: "lucideExternalLink",
      newTab: true,
    },
    {
      id: "preview-de",
      label: "Preview the draft in German",
      icon: "lucideExternalLink",
      newTab: true,
    },
    { id: "new-project", label: "New project", icon: "lucidePlus" },
    { id: "new-post", label: "New post", icon: "lucidePlus" },
    { id: "theme", label: this.themeLabel(), icon: "lucideSunMoon" },
    { id: "keys", label: "Keyboard shortcuts", icon: "lucideKeyboard", key: "?" },
  ]);

  /** How many entries a search finds, matched as Find matches them (brain's default filter). */
  protected readonly paletteStatus = computed(() => {
    const search = this.paletteSearch().toLowerCase();
    if (!search) return "";
    const values = [
      ...this.actions().map((action) => action.label),
      ...PAGES.map((page) => page.label),
      ...this.found().groups.flatMap((group) => group.items.map((item) => item.search)),
    ];
    const count = values.filter((value) => value.toLowerCase().includes(search)).length;
    if (count) return `${count} ${count === 1 ? "match" : "matches"}`;
    return this.found().state === "loading" ? "Looking through the content…" : "No matches";
  });

  /** At rest: the pages visited and the actions run lately, newest first, this page left out. */
  protected readonly recent = computed(() => {
    const here = this.url();
    const actions = this.actions();
    return this.recentEntries()
      .flatMap((entry) => {
        if (entry.path) {
          if (entry.path === here) return [];
          const icon = navItemFor(entry.path)?.icon ?? "lucideFileText";
          return [
            { key: entry.key, label: entry.label ?? entry.path, icon, disabled: false, entry },
          ];
        }
        const action = actions.find((a) => a.id === entry.action);
        if (!action) return [];
        return [
          {
            key: entry.key,
            label: action.label,
            icon: action.icon,
            disabled: !!action.disabled,
            entry,
          },
        ];
      })
      .slice(0, 5);
  });

  protected navName(
    label: string,
    badge: NavBadge | undefined,
    dirty: boolean,
    draft: boolean,
  ): string {
    const parts = [label];
    if (badge) parts.push(badge.words);
    if (dirty) parts.push("unsaved changes");
    if (draft) parts.push("changes not live");
    return parts.join(", ");
  }

  /** The pages whose content the review says differs from live: their rail entry's grey dot. */
  protected readonly notLive = computed(() => {
    const marks = this.pulse.marks();
    return new Set(
      PAGES.filter((item) => item.content?.some((path) => inDraft(marks, path))).map(
        (item) => item.path,
      ),
    );
  });

  /** `router.url` is not reactive, so re-read it whenever navigation settles. */
  private readonly navigated = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)),
    { initialValue: null },
  );

  private readonly url = computed(() => {
    this.navigated();
    return this.router.url.split(/[?#]/)[0] ?? "";
  });

  /** The page the URL is on, for the rail's current entry. */
  protected readonly currentItem = computed(() => navItemFor(this.url()));
  protected readonly accountCurrent = computed(() => this.currentItem() === ACCOUNT);
  protected readonly crumbs = computed(() => crumbsFor(this.url()));

  protected readonly isLogin = computed(() => this.url().startsWith("/admin/login"));

  /** `/admin/preview/<locale>/…` renders the public site without the admin around it. */
  protected readonly isPreviewFrame = computed(() => /^\/admin\/preview\/[^/?#]+/.test(this.url()));

  /**
   * The chrome stays hidden until the session has resolved, so a populated
   * rail never flashes at someone about to be bounced to the login screen.
   *
   * Login is exempt: the guard lets that route through once `ensure()` says no
   * one is signed in, so the page needs no second wait here.
   */
  protected readonly ready = computed(() => {
    if (!this.isBrowser) return false;
    if (this.isLogin()) return true;
    return this.session.checked() && this.session.user() !== null;
  });

  protected onKeydown(event: KeyboardEvent): void {
    if (this.isLogin() || this.isPreviewFrame() || !this.ready()) return;
    // Ctrl+S / ⌘S saves in an editor (its save bar handles it); elsewhere in
    // the admin it does nothing rather than offer to save the page as HTML.
    if (isSaveShortcut(event)) {
      event.preventDefault();
      return;
    }
    // The sign-in dialog holds the keyboard: no palette or sheet over it.
    if (this.session.lost()) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      this.paletteOpen.update((open) => !open);
      return;
    }
    if (isRailKey(event)) {
      event.preventDefault();
      this.sidebar.toggleSidebar();
      return;
    }
    if (event.key === "?" && isShortcutTarget(event)) {
      event.preventDefault();
      this.shortcutsOpen.set(true);
    }
  }

  /** Into the page itself: its heading, or the page while it has none yet. */
  protected skipToContent(event: Event): void {
    const main = this.doc.getElementById("main");
    if (!main) return;
    event.preventDefault();
    const heading = main.querySelector<HTMLElement>("h1");
    if (heading) {
      heading.focus();
      return;
    }
    main.setAttribute("tabindex", "-1");
    main.focus();
  }

  protected onPaletteState(state: BrnDialogState): void {
    this.paletteOpen.set(state === "open");
  }

  protected go(path: string): void {
    this.paletteOpen.set(false);
    // Navigation still passes through canDeactivate, so unsaved work is guarded.
    void this.router.navigateByUrl(path);
  }

  protected openRecent(row: { entry: RecentEntry }): void {
    const { path, action } = row.entry;
    if (path) this.go(path);
    else if (action) this.run(action);
  }

  protected run(id: ActionId): void {
    this.recentEntries.update((list) => remember(list, { key: `action:${id}`, action: id }));
    this.storeRecent();
    const actions: Record<ActionId, () => void | Promise<void>> = {
      publish: this.publish,
      "preview-en": this.previewEn,
      "preview-de": this.previewDe,
      "new-project": this.newProject,
      "new-post": this.newPost,
      theme: this.toggleTheme,
      keys: this.showShortcuts,
    };
    this.after(actions[id]);
  }

  /**
   * A palette action runs once the palette has closed and handed focus back,
   * so a dialog it opens keeps the focus.
   */
  protected after(action: () => void | Promise<void>): void {
    this.paletteOpen.set(false);
    setTimeout(() => void action(), PALETTE_CLOSE_MS);
  }

  /** Publish opens the review; after a failed check it asks the server again. */
  protected onPublish(): void {
    if (this.publishState() === "failed") void this.pulse.refresh(["status", "review"]);
    else this.pulse.publishOpen.set(true);
  }

  protected readonly publish = (): void => this.pulse.publishOpen.set(true);
  /** The draft in a new tab, at the open editor's own section where it names one. */
  protected readonly previewEn = (): void =>
    openTab(`/admin/preview/en${this.currentItem()?.preview ?? ""}`);
  protected readonly previewDe = (): void =>
    openTab(`/admin/preview/de${this.currentItem()?.preview ?? ""}`);
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

  protected async logout(): Promise<void> {
    if (this.unsaved.hasAny()) {
      const leave = await this.confirm.ask({
        title: "Sign out and lose your unsaved changes?",
        description: "The edits on this page have not been saved to the draft.",
        confirmLabel: "Discard and sign out",
        cancelLabel: "Stay",
        destructive: true,
      });
      if (!leave) return;
      this.unsaved.clearAll();
    }
    // A deliberate sign-out: no unsaved copy stays on this device.
    await this.recovery.clearAll();
    await this.api.logout();
    this.pulse.reset();
    this.session.clear();
    void this.router.navigate(["/admin/login"]);
  }

  /**
   * After a navigation: the new page from its top, and its heading focused once it
   * renders (an editor's waits for its data). Someone who presses a key or points
   * first keeps their focus where they put it.
   */
  private arrive(): void {
    this.stopArrival();
    this.doc.defaultView?.scrollTo(0, 0);
    const main = this.doc.getElementById("main");
    if (!main) return;
    let watch: MutationObserver | null = null;
    const stop = (): void => {
      watch?.disconnect();
      this.doc.removeEventListener("keydown", stop, true);
      this.doc.removeEventListener("pointerdown", stop, true);
      this.stopArrival = () => undefined;
    };
    const land = (): boolean => {
      const heading = main.querySelector<HTMLElement>("h1");
      if (!heading) return false;
      stop();
      heading.focus({ preventScroll: true });
      return true;
    };
    this.doc.addEventListener("keydown", stop, true);
    this.doc.addEventListener("pointerdown", stop, true);
    this.stopArrival = stop;
    afterNextRender(
      {
        read: () => {
          if (this.stopArrival !== stop || land()) return;
          watch = new MutationObserver(() => land());
          watch.observe(main, { childList: true, subtree: true });
        },
      },
      { injector: this.injector },
    );
  }

  /** A page in Find's recent list, under the words its breadcrumb uses. */
  private rememberPage(path: string): void {
    const crumbs = crumbsFor(path);
    if (!crumbs.length) return;
    const label = crumbs.map((crumb) => crumb.label).join(" › ");
    this.recentEntries.update((list) => remember(list, { key: path, path, label }));
    this.storeRecent();
  }

  private storeRecent(): void {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recentEntries()));
    } catch {
      // Storage blocked: the list holds for this visit.
    }
  }

  /** Projects, posts, experience, Profile's links and media by name, loaded when Find first opens. */
  private async loadFound(): Promise<void> {
    const { state } = this.found();
    if (state === "loading" || state === "ready") return;
    this.found.set({ state: "loading", groups: [] });
    const [projects, posts, experiences, links, media] = await Promise.all([
      this.api.listProjects(),
      this.api.listPosts(),
      this.api.listExperiences(),
      this.api.listSocials(),
      this.api.listMedia(),
    ]);
    if (this.destroyed) return;
    const groups: FoundGroup[] = [];
    if (projects.ok) {
      groups.push({
        label: "Work",
        icon: "lucideBriefcase",
        items: projects.data.projects.map((p) => {
          const name = p.translations.en?.name || p.slug;
          return {
            key: p.id,
            label: name,
            search: [name, p.translations.de?.name, p.slug].filter(Boolean).join(" "),
            path: `/admin/projects/${p.slug}`,
          };
        }),
      });
    }
    if (posts.ok) {
      groups.push({
        label: "Writing",
        icon: "lucideNewspaper",
        items: posts.data.posts.map((p) => {
          const title = p.translations.en?.title || p.translations.de?.title || p.slug;
          return {
            key: p.id,
            label: title,
            search: [title, p.translations.de?.title, p.slug].filter(Boolean).join(" "),
            path: `/admin/writing/${p.slug}`,
          };
        }),
      });
    }
    // shortcut: experience, the links and media open their page, not the entry, until U14 and U15
    // give an entry an address (`?edit=<id>`).
    if (experiences.ok) {
      groups.push({
        label: "Experience",
        icon: "lucideSignpost",
        items: experiences.data.experiences.map((e) => {
          const label = [e.translations.en.title, e.orgName].filter(Boolean).join(", ");
          return {
            key: e.id,
            label,
            search: `${label} ${e.translations.de.title}`,
            path: "/admin/experience",
          };
        }),
      });
    }
    // The Socials page went (plan 5, U11): its links are found here, and edited on Profile.
    if (links.ok) {
      groups.push({
        label: "Links",
        icon: "lucideLink",
        items: links.data.socials.map((s) => ({
          key: s.id,
          label: s.label,
          search: `${s.label} ${s.href}`,
          path: "/admin/hero",
        })),
      });
    }
    if (media.ok) {
      groups.push({
        label: "Media",
        icon: "lucideImage",
        items: media.data.media.map((m) => ({
          key: m.id,
          label: m.originalName,
          search: m.originalName,
          path: "/admin/media",
        })),
      });
    }
    const failed = !projects.ok || !posts.ok || !experiences.ok || !links.ok || !media.ok;
    this.found.set({ state: failed ? "failed" : "ready", groups });
  }
}
