import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
} from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import type { RouteMeta } from "@analogjs/router";
import { FormControl, FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideExternalLink } from "@ng-icons/lucide";
import { BrnTabsContent } from "@spartan-ng/brain/tabs";
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from "@spartan-ng/helm/alert";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmTabsImports } from "@spartan-ng/helm/tabs";
import { map } from "rxjs";

import {
  AdminApiService,
  type ApiIssue,
  type LegalSectionInput,
} from "../../admin/admin-api.service";
import { countChangedFields } from "../../admin/changed-fields";
import {
  rollUp,
  stateOf,
  TRACE_WORDS,
  type DraftMarks,
  type TraceState,
} from "../../admin/change-trace";
import { BilingualFieldComponent } from "../../admin/components/bilingual-field.component";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import {
  FieldIssueComponent,
  LocaleToggleComponent,
} from "../../admin/components/editor-chrome.component";
import { EditorHeaderComponent } from "../../admin/components/editor-header.component";
import type { LocaleView } from "../../admin/components/field-pair.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../admin/components/load-state.component";
import { RichTextComponent } from "../../admin/components/rich-text.component";
import { FieldIssues, focusFirstInvalid } from "../../admin/issues";
import { storedView, storeView } from "../../admin/language-view";
import { hasPostalAddress } from "../../admin/postal-address";
import { LivePreviewService } from "../../admin/preview/live-preview.service";
import { AdminPulseService } from "../../admin/pulse.service";
import { RecoveryService } from "../../admin/recovery.service";
import { askStale, toastDiscarded, toastIssues, toastNotSaved } from "../../admin/save-feedback";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import { isLocale } from "../../content/locale";
import type { Doc, LegalDoc, Locale } from "../../content/schema";

type Docs = Record<LegalDoc, Record<Locale, LegalSectionInput>>;
type Field = keyof LegalSectionInput;

const DOCS: { id: LegalDoc; label: string; name: string }[] = [
  { id: "imprint", label: "Imprint", name: "The imprint" },
  { id: "privacy", label: "Privacy", name: "The privacy policy" },
];
const LOCALES: Locale[] = ["en", "de"];
const FIELDS: Field[] = ["title", "body"];
const LANGUAGE: Record<Locale, string> = { en: "English", de: "German" };

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

function docOf(
  data: Partial<Record<Locale, LegalSectionInput>>,
): Record<Locale, LegalSectionInput> {
  const empty = (): LegalSectionInput => ({ title: "", body: "" });
  return { en: data.en ?? empty(), de: data.de ?? empty() };
}

/** A document's field is in the draft when its draft and live differ there, in either language. */
function docInDraft(marks: DraftMarks | null, id: LegalDoc, field: Field): boolean {
  const pick = (doc: Doc | null) => (doc?.kind === "legal" ? doc[field] : undefined);
  return LOCALES.some((locale) => {
    const change = marks?.docs?.[locale]?.find((d) => d.key === `legal:${id}`);
    return !!change && pick(change.draft) !== pick(change.live);
  });
}

/**
 * The Impressum and the Datenschutzerklärung (plan 5, U14), legally required for a site run from
 * Germany, so both stay in both languages; the text is the operator's to keep accurate. The shown
 * document is in the address (`?doc=privacy`), both documents' edits live in the page, and one
 * Save sends each that changed.
 */
@Component({
  selector: "app-admin-legal",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    BilingualFieldComponent,
    BrnTabsContent,
    EditorHeaderComponent,
    FieldIssueComponent,
    FormSkeletonComponent,
    FormsModule,
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmButton,
    HlmTabsImports,
    LoadErrorComponent,
    LocaleToggleComponent,
    NgIcon,
    RichTextComponent,
  ],
  viewProviders: [provideIcons({ lucideExternalLink })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12 xl:max-w-6xl">
      <app-editor-header
        title="Legal"
        [changes]="changes()"
        [saving]="saving()"
        [problems]="issues.count()"
        [notLive]="notLive()"
        [savedAt]="savedAt()"
        (save)="save()"
        (discard)="discard()"
      >
        <app-locale-toggle
          class="max-md:order-first"
          [view]="shownView()"
          [both]="wide()"
          (viewChange)="choose($event)"
        />
        <a
          hlmBtn
          variant="ghost"
          size="sm"
          class="max-md:hidden"
          target="_blank"
          rel="noopener"
          [href]="previewHref()"
          >{{ activeLabel() }} draft
          <ng-icon name="lucideExternalLink" size="14" class="ml-1.5" aria-hidden="true"
        /></a>
      </app-editor-header>

      <div hlmAlert>
        <h2 hlmAlertTitle>Your responsibility</h2>
        <p hlmAlertDescription>
          The first version is a draft written from what this site does; it is not legal advice.
        </p>
        @if (!addressFound()) {
          <p hlmAlertDescription>
            No postal address found in the imprint. § 5 DDG requires one: street, postcode and town.
          </p>
        }
      </div>

      @if (loading()) {
        <app-form-skeleton [rows]="4" />
      } @else if (loadError(); as reason) {
        <app-load-error
          title="Could not load the legal pages"
          [reason]="reason"
          (retry)="reload()"
        />
      } @else if (docs(); as d) {
        <div hlmTabs class="gap-6" [tab]="active()" (tabActivated)="show($event)">
          <div hlmTabsList aria-label="Legal page">
            @for (doc of docList; track doc.id) {
              <button type="button" [hlmTabsTrigger]="doc.id">
                {{ doc.label }}
                @if (tabMark(doc.id); as change) {
                  <span
                    class="size-2 shrink-0 rounded-full forced-color-adjust-none"
                    [class]="
                      change === 'unsaved'
                        ? 'bg-signal forced-colors:bg-[Highlight]'
                        : 'bg-input-line forced-colors:bg-[GrayText]'
                    "
                    aria-hidden="true"
                  ></span>
                  <span class="sr-only">, {{ change === "unsaved" ? "unsaved" : "in draft" }}</span>
                }
              </button>
            }
          </div>

          <!-- A panel per tab, for the tabs to point at; the shown document's fields fill it. -->
          @for (doc of docList; track doc.id) {
            <div [brnTabsContent]="doc.id" class="flex flex-col gap-6">
              @if (doc.id === active()) {
                @if (shownView() === "both") {
                  <div
                    class="-mb-4 grid grid-cols-2 gap-3 text-hint text-muted-foreground max-lg:hidden"
                    aria-hidden="true"
                  >
                    <span>English</span><span>German</span>
                  </div>
                }
                <app-bilingual-field
                  [id]="'legal-title'"
                  label="Title"
                  [maxLength]="120"
                  [view]="shownView()"
                  [state]="state(doc.id, 'title')"
                  [live]="liveTitles()[doc.id]"
                  [controlEn]="titles[doc.id].en"
                  [controlDe]="titles[doc.id].de"
                />
                <div class="change-trace flex flex-col gap-1.5" [attr.data-change]="mark(doc.id)">
                  <span class="text-sm font-medium">Text</span>
                  <span id="legal-body-state" class="sr-only">{{ words(doc.id) }}</span>
                  <!-- Side by side from 1024 px under Both; one above the other below it. -->
                  <div
                    [class]="shownView() === 'both' ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'"
                  >
                    @for (locale of locales(); track locale) {
                      <div class="flex min-w-0 flex-col gap-1">
                        <!-- The document is bound here, not read from the address: a debounced
                             change that lands after a tab change stays with its own document. -->
                        <app-rich-text
                          mode="long"
                          [attr.lang]="locale"
                          [label]="'Text ' + language[locale]"
                          [ngModel]="d[doc.id][locale].body"
                          (ngModelChange)="patch(doc.id, locale, { body: $event })"
                          [describedBy]="bodyDescribedBy(doc.id, locale)"
                        />
                        <app-field-issue
                          [id]="'legal-body-' + locale + '-issue'"
                          [message]="issues.get(doc.id + '.' + locale + '.body')"
                        />
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
})
export default class AdminLegalPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly confirm = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  /** The review, for the trace's draft state; absent in unit tests. */
  private readonly pulse = inject(AdminPulseService, { optional: true });
  private readonly preview = inject(LivePreviewService, { optional: true });

  protected readonly docList = DOCS;
  protected readonly language = LANGUAGE;
  /** The document the address names (`?doc=privacy`); none, or one unknown, is the imprint. */
  private readonly doc = toSignal(this.route.queryParamMap.pipe(map((q) => q.get("doc"))), {
    initialValue: null,
  });
  protected readonly active = computed<LegalDoc>(() =>
    this.doc() === "privacy" ? "privacy" : "imprint",
  );
  protected readonly activeLabel = computed(
    () => DOCS.find((doc) => doc.id === this.active())?.label ?? "Page",
  );
  protected readonly previewHref = computed(() => `/admin/preview/en/legal/${this.active()}`);

  protected readonly view = signal<LocaleView>(storedView("legal") ?? "both");
  /** English and German side by side from 1024 px; one language below it. */
  protected readonly wide = computed(() => this.preview?.wide() ?? true);
  protected readonly shownView = computed<LocaleView>(() =>
    this.view() === "both" && !this.wide() ? "en" : this.view(),
  );
  protected readonly locales = computed<Locale[]>(() => {
    const view = this.shownView();
    return view === "both" ? LOCALES : [view];
  });

  protected readonly loading = signal(true);
  /** The API's reason when the pages did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  /** When this page last saved, for the header's "Saved 14:02". */
  protected readonly savedAt = signal<number | null>(null);
  /** Per `<doc>.<field>`, when this page saved it: in the draft until a review asked after that arrives. */
  private readonly savedHere = signal<ReadonlyMap<string, number>>(new Map());
  protected readonly docs = signal<Docs | null>(null);
  private readonly pristine = signal<Docs | null>(null);
  /** Keyed `<doc>.<locale>.<field>`. */
  protected readonly issues = new FieldIssues();
  /** Each document's concurrency token, echoed back on save. */
  private readonly tokens: Record<LegalDoc, string | null> = { imprint: null, privacy: null };
  private gone = false;

  /** Each document's title in each language, mirroring the docs: the bilingual field's. */
  protected readonly titles = Object.fromEntries(
    DOCS.map(({ id }) => [
      id,
      {
        en: new FormControl("", { nonNullable: true }),
        de: new FormControl("", { nonNullable: true }),
      },
    ]),
  ) as Record<LegalDoc, Record<Locale, FormControl<string>>>;

  private readonly docsDirty = computed(
    () => JSON.stringify(this.docs()) !== JSON.stringify(this.pristine()),
  );
  protected readonly changes = computed(() => countChangedFields(this.pristine(), this.docs()));

  /** Per `<doc>.<field>`: unsaved here, in the draft, or live. */
  private readonly trace = computed(() => {
    const docs = this.docs();
    const base = this.pristine();
    const marks = this.pulse?.marks() ?? null;
    const here = this.savedHere();
    const out: Record<string, TraceState> = {};
    if (!docs || !base) {
      return out;
    }
    for (const { id } of DOCS) {
      for (const field of FIELDS) {
        const unsaved = LOCALES.some((l) => docs[id][l][field] !== base[id][l][field]);
        const draft =
          (here.get(`${id}.${field}`) ?? 0) > (marks?.asked ?? 0) || docInDraft(marks, id, field);
        out[`${id}.${field}`] = stateOf(unsaved, draft);
      }
    }
    return out;
  });

  /** Fields saved to the draft and not live; null until the review or a save here says. */
  protected readonly notLive = computed(() => {
    if (!this.pulse?.marks() && this.savedHere().size === 0) {
      return null;
    }
    return Object.values(this.trace()).filter((state) => state === "draft").length;
  });

  /** The live title of each document in both languages, for "English changed, German not". */
  protected readonly liveTitles = computed(() => {
    const docs = this.pulse?.marks()?.docs;
    const at = (id: LegalDoc, locale: Locale) => {
      const live = docs?.[locale]?.find((d) => d.key === `legal:${id}`)?.live;
      return live?.kind === "legal" ? live.title : undefined;
    };
    return Object.fromEntries(
      DOCS.map(({ id }) => {
        const [en, de] = [at(id, "en"), at(id, "de")];
        return [id, en === undefined || de === undefined ? null : { en, de }];
      }),
    ) as Record<LegalDoc, Record<Locale, string> | null>;
  });

  /** § 5 DDG: until either language's imprint names a postcode and a town, the note asks for it. */
  protected readonly addressFound = computed(() => {
    const imprint = this.docs()?.imprint;
    return !imprint || LOCALES.some((locale) => hasPostalAddress(imprint[locale].body));
  });

  constructor() {
    effect(() => this.unsaved.set("legal", this.docsDirty()));
    inject(DestroyRef).onDestroy(() => {
      this.gone = true;
      this.unsaved.clear("legal");
    });
    // A title typed, or put there by its ⋯, goes into its own document.
    for (const { id } of DOCS) {
      for (const locale of LOCALES) {
        this.titles[id][locale].valueChanges.subscribe((title) => {
          if (title !== this.docs()?.[id][locale].title) {
            this.patch(id, locale, { title });
          }
        });
      }
    }
    // One copy for both documents (the old editor's key and shape).
    inject(RecoveryService).track({
      editor: "legal",
      saved: this.pristine,
      current: this.docs,
      restore: (docs) => {
        this.docs.set(docs);
        this.fill();
        // A copy typed on the other document opens its tab.
        const other = DOCS.find(({ id }) => id !== this.active())?.id ?? DOCS[0].id;
        if (!this.edited(this.active()) && this.edited(other)) {
          void this.show(other);
        }
      },
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  /** Legal's language view, remembered in this browser. */
  protected choose(view: LocaleView): void {
    this.view.set(view);
    storeView("legal", view);
  }

  /** A tab puts its document in the address, replaced as the Inbox's filters are: Back leaves Legal. */
  protected show(id: string): Promise<boolean> {
    if (id === this.active()) {
      return Promise.resolve(true);
    }
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { doc: id === "privacy" ? id : null },
      replaceUrl: true,
    });
  }

  protected state(id: LegalDoc, field: Field): TraceState {
    return this.trace()[`${id}.${field}`] ?? "live";
  }

  protected mark(id: LegalDoc): TraceState | null {
    const state = this.state(id, "body");
    return state === "live" ? null : state;
  }

  protected words(id: LegalDoc): string {
    return TRACE_WORDS[this.state(id, "body")];
  }

  /** A tab's mark: unsaved if a field of its document is, else in the draft if one is. */
  protected tabMark(id: LegalDoc): "unsaved" | "draft" | undefined {
    return rollUp(FIELDS.map((field) => this.state(id, field)));
  }

  /** A text's description: its save problem, then the trace's words. */
  protected bodyDescribedBy(id: LegalDoc, locale: Locale): string | null {
    const ids = [
      this.issues.get(`${id}.${locale}.body`) ? `legal-body-${locale}-issue` : null,
      this.mark(id) ? "legal-body-state" : null,
    ].filter(Boolean);
    return ids.length ? ids.join(" ") : null;
  }

  private edited(id: LegalDoc): boolean {
    return JSON.stringify(this.docs()?.[id]) !== JSON.stringify(this.pristine()?.[id]);
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  private async load(): Promise<void> {
    const [imprint, privacy] = await Promise.all(
      DOCS.map((doc) => this.api.getSection<LegalSectionInput>(doc.id)),
    );
    this.loading.set(false);
    if (!imprint?.ok || !privacy?.ok) {
      const failed = [imprint, privacy].find((r) => r && !r.ok);
      this.loadError.set(failed && !failed.ok ? failed.error : "request_failed");
      return;
    }
    this.loadError.set(null);
    const docs: Docs = { imprint: docOf(imprint.data.data), privacy: docOf(privacy.data.data) };
    this.tokens.imprint = imprint.data.updatedAt;
    this.tokens.privacy = privacy.data.updatedAt;
    this.docs.set(structuredClone(docs));
    this.pristine.set(docs);
    this.issues.clear();
    this.fill();
  }

  /** The title controls take the documents' text: after a load, a discard, a reload or a copy. */
  private fill(): void {
    const docs = this.docs();
    for (const { id } of DOCS) {
      for (const locale of LOCALES) {
        const text = docs?.[id][locale].title ?? "";
        // A reset drops the field's own drafts and its Undo: only where the text moved.
        if (this.titles[id][locale].value !== text) {
          this.titles[id][locale].reset(text);
        }
      }
    }
  }

  protected patch(id: LegalDoc, locale: Locale, change: Partial<LegalSectionInput>): void {
    this.docs.update((d) =>
      d ? { ...d, [id]: { ...d[id], [locale]: { ...d[id][locale], ...change } } } : d,
    );
    for (const field of Object.keys(change)) {
      this.issues.resolve(`${id}.${locale}.${field}`);
    }
  }

  protected discard(): void {
    const edits = this.docs();
    const pristine = this.pristine();
    this.docs.set(pristine ? structuredClone(pristine) : null);
    this.issues.clear();
    this.fill();
    toastDiscarded(() => {
      this.docs.set(edits);
      this.fill();
    });
  }

  /** The documents that changed, one after the other: one Save, one Ctrl+S. */
  protected async save(): Promise<void> {
    const docs = this.docs();
    const pristine = this.pristine();
    if (!docs || !pristine || this.saving()) {
      return;
    }
    this.saving.set(true);
    const before = this.trace();
    const changed = DOCS.filter(
      ({ id }) => JSON.stringify(docs[id]) !== JSON.stringify(pristine[id]),
    );
    const saveSequentially = async (index: number): Promise<void> => {
      const entry = changed[index];
      if (!entry) {
        return;
      }
      const ok = await this.saveDoc(entry.id, docs[entry.id], before);
      if (ok && !this.gone) {
        await saveSequentially(index + 1);
      }
    };
    await saveSequentially(0);
    this.saving.set(false);
  }

  private async saveDoc(
    id: LegalDoc,
    doc: Record<Locale, LegalSectionInput>,
    before: Record<string, TraceState>,
  ): Promise<boolean> {
    const result = await this.api.putSection(id, doc, this.tokens[id]);
    if (result.ok) {
      this.tokens[id] = result.data.updatedAt;
      this.pristine.update((p) => (p ? { ...p, [id]: structuredClone(doc) } : p));
      const at = Date.now();
      this.savedHere.update((marks) => {
        const next = new Map(marks);
        for (const field of FIELDS) {
          if (before[`${id}.${field}`] === "unsaved") {
            next.set(`${id}.${field}`, at);
          }
        }
        return next;
      });
      this.savedAt.set(at);
      for (const locale of LOCALES) {
        this.titles[id][locale].markAsPristine();
      }
      return true;
    }
    if (result.status === 409) {
      await this.handleStale(id);
    } else if (result.issues?.length) {
      this.refused(id, result.issues);
    } else {
      toastNotSaved(result.error);
    }
    return false;
  }

  /** Saved elsewhere: asked by the document's name. Reload replaces that one document; Keep moves on to it. */
  private async handleStale(id: LegalDoc): Promise<void> {
    const fresh = await this.api.getSection<LegalSectionInput>(id);
    const label = DOCS.find((doc) => doc.id === id)?.name ?? id;
    const reload = await askStale(this.confirm, label);
    if (this.gone) {
      return;
    }
    if (!fresh.ok) {
      if (reload) {
        toastNotSaved(fresh.error, "Could not load the page");
      }
      return;
    }
    this.tokens[id] = fresh.data.updatedAt;
    if (!reload) {
      return;
    }
    // Only this document: the other one's edits were never stale.
    const doc = docOf(fresh.data.data);
    this.docs.update((d) => (d ? { ...d, [id]: structuredClone(doc) } : d));
    this.pristine.update((p) => (p ? { ...p, [id]: doc } : p));
    this.issues.resolve(id);
    this.fill();
  }

  /** A refused save: its document shown, its problems on their fields, the first focused. */
  private refused(id: LegalDoc, issues: readonly ApiIssue[]): void {
    // `[locale, field]` of this document.
    this.issues.set(issues.map((issue) => ({ ...issue, path: [id, ...issue.path] })));
    toastIssues(issues);
    const shown = this.shownView();
    const other = issues
      .map((issue) => issue.path[0])
      .find((locale): locale is Locale => isLocale(locale) && shown !== "both" && locale !== shown);
    if (other) {
      this.view.set(this.wide() ? "both" : other);
    }
    void this.show(id).then(() =>
      afterNextRender(
        () => {
          if (this.gone) {
            return;
          }
          for (const locale of LOCALES) {
            const message = this.issues.get(`${id}.${locale}.title`);
            if (message) {
              this.titles[id][locale].setErrors({ server: message });
            }
          }
          focusFirstInvalid(this.host.nativeElement);
        },
        { injector: this.injector },
      ),
    );
  }
}
