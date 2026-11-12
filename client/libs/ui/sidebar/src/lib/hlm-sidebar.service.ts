import {
  computed,
  DestroyRef,
  DOCUMENT,
  inject,
  Injectable,
  type Signal,
  signal,
} from "@angular/core";
import { injectHlmSidebarConfig } from "./hlm-sidebar.token";

export type SidebarVariant = "sidebar" | "floating" | "inset";

@Injectable({ providedIn: "root" })
export class HlmSidebarService {
  private readonly _config = injectHlmSidebarConfig();
  private readonly _document = inject(DOCUMENT);
  private readonly _window = this._document.defaultView;
  private readonly _phone = this._query(`(max-width: ${this._config.mobileBreakpoint})`);
  private readonly _wide = this._query(`(min-width: ${this._config.openBreakpoint})`);
  private readonly _isMobile = signal(this._phone?.matches ?? false);
  private readonly _isWide = signal(this._wide?.matches ?? true);
  /** Wide: open unless collapsed there, a choice kept between visits. */
  private readonly _wideOpen = signal(this._read() !== "false");
  /** Between a phone and wide: collapsed, unless opened during this visit. */
  private readonly _narrowOpen = signal(false);
  private readonly _openMobile = signal<boolean>(false);
  private readonly _variant = signal<SidebarVariant>("sidebar");

  public readonly open: Signal<boolean> = computed(() =>
    this._isWide() ? this._wideOpen() : this._narrowOpen(),
  );
  public readonly openMobile: Signal<boolean> = this._openMobile.asReadonly();
  public readonly isMobile: Signal<boolean> = this._isMobile.asReadonly();
  public readonly variant: Signal<SidebarVariant> = this._variant.asReadonly();

  public readonly state = computed<"expanded" | "collapsed">(() =>
    this.open() ? "expanded" : "collapsed",
  );

  constructor() {
    // Read at once, not after the first render: the rail never shows a state it is about to leave.
    const onPhone = (e: MediaQueryListEvent) => {
      this._isMobile.set(e.matches);
      // A phone's sheet does not stay open behind a wider layout.
      if (!e.matches) this._openMobile.set(false);
    };
    const onWide = (e: MediaQueryListEvent) => this._isWide.set(e.matches);
    this._phone?.addEventListener("change", onPhone);
    this._wide?.addEventListener("change", onWide);
    inject(DestroyRef).onDestroy(() => {
      this._phone?.removeEventListener("change", onPhone);
      this._wide?.removeEventListener("change", onWide);
    });
  }

  public setOpen(open: boolean): void {
    if (!this._isWide()) {
      this._narrowOpen.set(open);
      return;
    }
    this._wideOpen.set(open);
    try {
      this._window?.localStorage.setItem(this._config.sidebarStorageKey, String(open));
    } catch {
      // Storage blocked: the choice holds for this visit.
    }
  }

  public setOpenMobile(open: boolean): void {
    if (this._isMobile()) {
      this._openMobile.set(open);
    }
  }

  public setVariant(variant: SidebarVariant): void {
    this._variant.set(variant);
  }

  public toggleSidebar(): void {
    if (this._isMobile()) {
      this._openMobile.update((value) => !value);
    } else {
      this.setOpen(!this.open());
    }
  }

  /** No window on the server: no query, and the defaults hold. */
  private _query(query: string): MediaQueryList | null {
    return typeof this._window?.matchMedia === "function" ? this._window.matchMedia(query) : null;
  }

  private _read(): string | null {
    try {
      return this._window?.localStorage.getItem(this._config.sidebarStorageKey) ?? null;
    } catch {
      return null;
    }
  }
}
