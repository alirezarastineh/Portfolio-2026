import { DOCUMENT } from "@angular/common";
import {
  afterNextRender,
  ApplicationRef,
  ChangeDetectionStrategy,
  Component,
  computed,
  createComponent,
  createEnvironmentInjector,
  DestroyRef,
  effect,
  type ElementRef,
  EnvironmentInjector,
  inject,
  input,
  linkedSignal,
  signal,
  type ComponentRef,
  type Signal,
  type Type,
  untracked,
  viewChild,
  type WritableSignal,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideMonitor, lucideSmartphone, lucideX } from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmSpinner } from "@spartan-ng/helm/spinner";
import { HlmToggleGroupImports } from "@spartan-ng/helm/toggle-group";

import { ADMIN_STYLES_ID } from "../admin-styles";
import type { LocaleView } from "../components/field-pair.component";
import { LoadErrorComponent } from "../components/load-state.component";
import { MediaLibraryService } from "../media-library.service";
import { CONTENT_PREVIEW } from "../../content/content-source";
import { ContentStore } from "../../content/content.store";
import type { AppContent, Locale } from "../../content/schema";
import { LanguageService } from "../../services/language.service";
import type { LiveCompose } from "./live-content";
import { LivePreviewService, type PreviewDevice } from "./live-preview.service";

/** Edits settle this long before the page redraws. */
const DEBOUNCE_MS = 150;
/** The page's width in each device, in CSS pixels. */
const WIDTHS: Record<PreviewDevice, number> = { desktop: 1280, phone: 390 };
/** Room around the phone, so it reads as a device and not a column. */
const PHONE_GAP = 12;
/** A laptop's first screen at 1280 px wide, in CSS pixels. */
const FIRST_SCREEN = 800;
/** A section loads with its code (`@defer`): how long to wait for it before giving up on scrolling. */
const FIND_MS = 5000;

/** A card's or an entry's title, the same in every language or per language. */
export type PreviewFocus = string | Partial<Record<Locale, string>> | null;

/** The public pages' content store, fed from here instead of from the API. */
class LiveContentStore {
  private readonly state: Record<Locale, WritableSignal<AppContent | null>> = {
    en: signal<AppContent | null>(null),
    de: signal<AppContent | null>(null),
  };

  content(locale: Locale): Signal<AppContent | null> {
    return this.state[locale].asReadonly();
  }

  ensure(locale: Locale): Promise<AppContent> {
    const content = this.state[locale]();
    return content ? Promise.resolve(content) : Promise.reject(new Error("not composed yet"));
  }

  set(locale: Locale, content: AppContent): void {
    this.state[locale].set(content);
  }
}

/**
 * The public home page beside an editor, drawn from the saved draft with the
 * editor's unsaved state over it (`compose`), 150 ms after the typing stops.
 * The real components render it: what shows is what saving and publishing
 * would put live.
 *
 * It renders into a same-origin frame with no address of its own (nothing is
 * loaded, so the site's frame and CSP rules do not come into it): the page's
 * layout follows the frame's own width, so "phone" is the real 390 px layout,
 * not the desktop one squeezed. Desktop renders at 1280 px and is scaled to
 * fit. The frame carries the site's stylesheet and the components' styles, the
 * theme of the admin, and the language chosen here.
 *
 * It is a picture: the page inside is inert (no focus, no clicks, no hover,
 * though it scrolls), so nothing in it can send a message, ask the assistant or
 * navigate the admin away from unsaved edits.
 */
@Component({
  selector: "app-live-preview",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmButton, HlmSpinner, HlmToggleGroupImports, LoadErrorComponent, NgIcon],
  viewProviders: [provideIcons({ lucideMonitor, lucideSmartphone, lucideX })],
  host: { class: "flex h-full min-h-0 flex-col bg-background" },
  template: `
    <div class="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
      <h2 class="m-0 mr-auto flex items-center gap-2 font-mono text-meta text-foreground">
        <span class="size-1.5 rounded-full bg-accent-orange" aria-hidden="true"></span>
        live preview
      </h2>
      <div
        hlmToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Preview language"
        [nullable]="false"
        [value]="locale()"
        (valueChange)="onLocale($event)"
      >
        @for (option of locales; track option) {
          <button
            hlmToggleGroupItem
            type="button"
            class="font-mono text-xs uppercase tracking-label"
            [value]="option"
          >
            {{ option }}
          </button>
        }
      </div>
      <div
        hlmToggleGroup
        type="single"
        variant="outline"
        size="sm"
        aria-label="Preview width"
        [nullable]="false"
        [value]="preview.device()"
        (valueChange)="onDevice($event)"
      >
        <button hlmToggleGroupItem type="button" value="desktop" aria-label="Desktop">
          <ng-icon name="lucideMonitor" size="14" aria-hidden="true" />
        </button>
        <button hlmToggleGroupItem type="button" value="phone" aria-label="Phone">
          <ng-icon name="lucideSmartphone" size="14" aria-hidden="true" />
        </button>
      </div>
      <button
        hlmBtn
        variant="ghost"
        size="icon-sm"
        type="button"
        aria-label="Close the preview"
        (click)="preview.open.set(false)"
      >
        <ng-icon name="lucideX" size="14" aria-hidden="true" />
      </button>
    </div>
    @if (note(); as text) {
      <p class="m-0 border-b border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
        {{ text }}
      </p>
    }

    <div #viewport class="relative min-h-0 flex-1 overflow-hidden bg-muted/40">
      <iframe
        #frame
        title="Live preview of the page, with unsaved edits"
        tabindex="-1"
        class="absolute origin-top-left border-0 bg-background"
        [class]="preview.device() === 'phone' ? 'rounded-xl shadow-e2 ring-1 ring-border' : ''"
        [style.width.px]="logicalWidth()"
        [style.height.px]="frameHeight()"
        [style.left.px]="offsetX()"
        [style.top.px]="offsetY()"
        [style.transform]="'scale(' + scale() + ')'"
      ></iframe>

      @switch (base().state) {
        @case ("loading") {
          <div
            class="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 font-mono text-meta text-muted-foreground"
            role="status"
          >
            <hlm-spinner class="size-4" />
            loading the draft…
          </div>
        }
        @case ("failed") {
          <div class="absolute inset-0 overflow-y-auto bg-background p-4">
            <app-load-error
              compact
              title="Nothing to preview against yet"
              [reason]="failure()"
              (retry)="retry()"
            />
          </div>
        }
      }
    </div>
  `,
})
export class LivePreviewComponent {
  /** The editor's unsaved state over the draft. */
  readonly compose = input.required<LiveCompose>();
  /** The home page section to show: its id (`hero`, `projects`, `about`, …). */
  readonly anchor = input.required<string>();
  /** The title of the card or entry to bring into view in it (per language), when there is one. */
  readonly focus = input<PreviewFocus>(null);
  /**
   * What the focus is (a project's or an entry's id): the preview scrolls to it
   * when this changes, not while its title is being typed.
   */
  readonly focusKey = input<string | null>(null);
  /** A line over the page: why it shows something the site would not, say. */
  readonly note = input<string | null>(null);
  /** The editor's language view: the preview follows it while it shows one language. */
  readonly view = input<LocaleView>("both");

  protected readonly preview = inject(LivePreviewService);
  private readonly library = inject(MediaLibraryService);
  private readonly appRef = inject(ApplicationRef);
  private readonly environment = inject(EnvironmentInjector);
  private readonly doc = inject(DOCUMENT);

  protected readonly locales: Locale[] = ["en", "de"];
  protected readonly locale = linkedSignal<LocaleView, Locale>({
    source: this.view,
    computation: (view, previous) => (view === "both" ? (previous?.value ?? "en") : view),
  });
  protected readonly base = computed(() => this.preview.base(this.locale()));
  protected readonly failure = computed(() => {
    const base = this.base();
    if (base.state !== "failed") return "";
    const n = base.issues.length;
    if (!n) return base.error;
    const label = n === 1 ? "problem" : "problems";
    return `The saved draft has ${n} ${label} to fix before it builds (${base.error}).`;
  });

  /** The page as it would be published with this editor's edits. */
  private readonly content = computed<AppContent | null>(() => {
    const base = this.base();
    if (base.state !== "ready") return null;
    const byId = new Map(this.library.assets().map((asset) => [asset.id, asset]));
    return this.compose()(base.content, this.locale(), (id) => (id ? byId.get(id) : undefined));
  });

  private readonly frame = viewChild.required<ElementRef<HTMLIFrameElement>>("frame");
  private readonly viewport = viewChild.required<ElementRef<HTMLElement>>("viewport");
  private readonly box = signal({ width: 0, height: 0 });

  protected readonly logicalWidth = computed(() => WIDTHS[this.preview.device()]);
  private readonly gap = computed(() => (this.preview.device() === "phone" ? PHONE_GAP : 0));
  protected readonly scale = computed(() => {
    const room = this.box().width - this.gap() * 2;
    return room > 0 ? Math.min(1, room / this.logicalWidth()) : 1;
  });
  protected readonly frameHeight = computed(() =>
    Math.max(0, (this.box().height - this.gap() * 2) / this.scale()),
  );
  protected readonly offsetX = computed(() =>
    Math.max(this.gap(), (this.box().width - this.logicalWidth() * this.scale()) / 2),
  );
  protected readonly offsetY = computed(() => this.gap());

  private frameDoc: Document | null = null;
  private readonly store = new LiveContentStore();
  private injector: EnvironmentInjector | null = null;
  private page: ComponentRef<unknown> | null = null;
  private mounting = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shownLocale: Locale | null = null;
  /** Bumped by each scroll request: an older one still waiting for its section gives up. */
  private revealing = 0;
  /** The site's styles in the frame, by the node in the admin's head they copy. */
  private readonly mirrored = new Map<Node, Node>();

  constructor() {
    const destroyRef = inject(DestroyRef);
    effect(() => this.preview.ensure(this.locale()));

    afterNextRender(() => {
      void this.library.load();
      this.prepareFrame(destroyRef);
      const resize = new ResizeObserver(([entry]) => {
        if (entry)
          this.box.set({ width: entry.contentRect.width, height: entry.contentRect.height });
      });
      resize.observe(this.viewport().nativeElement);
      destroyRef.onDestroy(() => resize.disconnect());
    });

    effect(() => {
      const content = this.content();
      const locale = this.locale();
      if (content) untracked(() => this.schedule(content, locale));
    });

    // A different section, card or width: bring it into view again.
    effect(() => {
      this.anchor();
      this.focusKey();
      this.preview.device();
      untracked(() => {
        if (this.page) void this.reveal();
      });
    });

    destroyRef.onDestroy(() => {
      clearTimeout(this.timer);
      this.revealing++;
      if (this.page) {
        this.appRef.detachView(this.page.hostView);
        this.page.destroy();
      }
      this.injector?.destroy();
    });
  }

  protected onLocale(value: unknown): void {
    if (value === "en" || value === "de") this.locale.set(value);
  }

  protected onDevice(value: unknown): void {
    if (value === "desktop" || value === "phone") this.preview.device.set(value);
  }

  protected retry(): void {
    void this.preview.load(this.locale(), true);
  }

  /** A standards-mode document in the frame, with the site's styles and the admin's theme. */
  private prepareFrame(destroyRef: DestroyRef): void {
    const frame = this.frame().nativeElement;
    const doc = frame.contentDocument;
    if (!doc) return;
    // Only the parser sets a document's mode: without a doctype the frame would
    // lay the page out in quirks mode. Written, not loaded: no request is made.
    doc.open();
    (doc as unknown as { write(html: string): void }).write(
      '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
    );
    doc.close();
    this.frameDoc = doc;

    this.mirrorStyles();
    // The frame is as tall as the panel over the scale (2,000 px and more at
    // desktop width), not a screen: a first-screen section would stretch to
    // all of it. Held to a laptop's first screen here, in the frame alone.
    const screen = doc.createElement("style");
    screen.textContent = String.raw`@media (min-width: 1024px) { .lg\:min-h-svh { min-height: min(100svh, ${FIRST_SCREEN}px); } }`;
    doc.head.append(screen);
    this.mirrorTheme();
    const styles = new MutationObserver(() => this.mirrorStyles());
    styles.observe(this.doc.head, { childList: true });
    const theme = new MutationObserver(() => this.mirrorTheme());
    theme.observe(this.doc.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    destroyRef.onDestroy(() => {
      styles.disconnect();
      theme.disconnect();
    });

    const content = this.content();
    if (content) this.schedule(content, this.locale());
  }

  /**
   * The site's stylesheet and every component style Angular has added, but not
   * the admin's own sheet: the page is dressed as visitors see it.
   */
  private mirrorStyles(): void {
    const head = this.frameDoc?.head;
    if (!head) return;
    for (const node of Array.from(
      this.doc.head.querySelectorAll('link[rel="stylesheet"], style'),
    )) {
      if (node.id === ADMIN_STYLES_ID || this.mirrored.has(node)) continue;
      const copy = node.cloneNode(true);
      head.append(copy);
      this.mirrored.set(node, copy);
    }
    for (const [node, copy] of this.mirrored) {
      if (node.isConnected) continue;
      (copy as ChildNode).remove();
      this.mirrored.delete(node);
    }
  }

  private mirrorTheme(): void {
    const root = this.frameDoc?.documentElement;
    if (!root) return;
    const theme = this.doc.documentElement.getAttribute("data-theme"); // NOSONAR
    if (theme) root.setAttribute("data-theme", theme); // NOSONAR
    root.classList.toggle("dark", this.doc.documentElement.classList.contains("dark"));
  }

  /** New content: at once for the first page and a language switch, else once typing settles. */
  private schedule(content: AppContent, locale: Locale): void {
    clearTimeout(this.timer);
    if (!this.frameDoc) return;
    if (!this.page) {
      void this.mount(content, locale);
      return;
    }
    if (locale !== this.shownLocale) {
      this.show(content, locale);
      void this.reveal();
      return;
    }
    this.timer = setTimeout(() => this.show(content, locale), DEBOUNCE_MS);
  }

  private show(content: AppContent, locale: Locale): void {
    this.store.set(locale, content);
    this.injector?.get(LanguageService).activate(locale);
    this.frameDoc?.documentElement.setAttribute("lang", locale);
    this.shownLocale = locale;
  }

  /**
   * The home page itself, from its own route chunk (so the admin adds nothing
   * to what visitors load), with the content store and the language provided
   * again for it alone.
   */
  private async mount(content: AppContent, locale: Locale): Promise<void> {
    if (this.mounting || !this.frameDoc) return;
    this.mounting = true;
    const { default: Home } = (await import("../../pages/[locale]/index.page")) as {
      default: Type<unknown>;
    };
    const doc = this.frameDoc;
    this.injector = createEnvironmentInjector(
      [
        { provide: ContentStore, useValue: this.store },
        { provide: CONTENT_PREVIEW, useValue: true },
        LanguageService,
      ],
      this.environment,
      "live-preview",
    );
    this.show(content, locale);

    const host = doc.createElement("div");
    host.setAttribute("inert", "");
    doc.body.append(host);
    this.page = createComponent(Home, { environmentInjector: this.injector, hostElement: host });
    this.appRef.attachView(this.page.hostView);
    this.page.changeDetectorRef.detectChanges();
    this.mirrorStyles();
    this.mounting = false;
    void this.reveal();
  }

  /** Scrolls the frame to the section (and the card or entry in it) being edited. */
  private async reveal(): Promise<void> {
    const ticket = ++this.revealing;
    const win = this.frameDoc?.defaultView;
    if (!win) return;
    const started = Date.now();
    let target = this.target();
    // The sections below the hero arrive with their code: wait for this one.
    while (!target && Date.now() - started < FIND_MS) {
      await new Promise((resolve) => win.requestAnimationFrame(resolve));
      if (ticket !== this.revealing) return;
      target = this.target();
    }
    if (!target || ticket !== this.revealing) return;
    // Scrolls the frame only: scrollIntoView would move the admin page too.
    const top = target.getBoundingClientRect().top + win.scrollY - 24;
    win.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  }

  private target(): Element | null {
    const section = this.frameDoc?.getElementById(this.anchor());
    if (!section) return null;
    const wanted = this.focus();
    const focus = (typeof wanted === "string" ? wanted : wanted?.[this.locale()])?.trim();
    if (!focus) return section;
    const title = Array.from(section.querySelectorAll("h3, h4")).find(
      (el) => el.textContent?.trim() === focus,
    );
    // Found once the new text has been drawn; the section until then.
    return title?.closest("article, li") ?? section;
  }
}
