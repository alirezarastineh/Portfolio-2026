import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from "@spartan-ng/helm/alert";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmTabsImports } from "@spartan-ng/helm/tabs";

import { AdminApiService, type LegalSectionInput } from "../../admin/admin-api.service";
import {
  FieldIssueComponent,
  SaveBarComponent,
} from "../../admin/components/editor-chrome.component";
import { RichTextComponent } from "../../admin/components/rich-text.component";
import {
  UiGroupEditorComponent,
  type UiFieldDef,
} from "../../admin/components/ui-group-editor.component";
import { FieldIssues, focusFirstInvalid } from "../../admin/issues";
import { toastIssues, toastStale } from "../../admin/save-feedback";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import type { LegalDoc, Locale } from "../../content/schema";

type Docs = Record<LegalDoc, Record<Locale, LegalSectionInput>>;

const DOCS: { id: LegalDoc; label: string }[] = [
  { id: "imprint", label: "Imprint / Impressum" },
  { id: "privacy", label: "Privacy / Datenschutz" },
];

const LABEL_FIELDS: UiFieldDef[] = [
  { key: "nav", label: "Footer group label" },
  { key: "imprint", label: "Imprint link" },
  { key: "privacy", label: "Privacy link" },
  { key: "updated", label: "“Last updated” label" },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

/**
 * The Impressum and the Datenschutzerklärung. Legally required for a site run
 * from Germany, so both must stay in both languages; the text is yours to keep
 * accurate — this only stores it.
 */
@Component({
  selector: "app-admin-legal",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FieldIssueComponent,
    FormsModule,
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmSeparator,
    HlmSkeleton,
    HlmTabsImports,
    RichTextComponent,
    SaveBarComponent,
    UiGroupEditorComponent,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6">
      <header>
        <h1 class="m-0 font-mono text-2xl tracking-tight">Legal pages</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          /legal/imprint and /legal/privacy, in both languages. Live after the next publish.
        </p>
      </header>

      <div hlmAlert>
        <h2 hlmAlertTitle>Your responsibility</h2>
        <p hlmAlertDescription>
          The first version is a draft written from what this site does; it is not legal advice. § 5
          DDG requires a postal address in the imprint.
        </p>
      </div>

      @if (loading()) {
        <hlm-skeleton class="h-96 w-full" />
      } @else if (docs(); as d) {
        <div hlmTabs [tab]="active()" (tabActivated)="active.set($any($event))">
          <div hlmTabsList aria-label="Legal page">
            @for (doc of docList; track doc.id) {
              <button [hlmTabsTrigger]="doc.id">{{ doc.label }}</button>
            }
          </div>
        </div>

        @for (locale of locales; track locale) {
          <section class="flex flex-col gap-3">
            <p class="m-0 font-mono text-[0.7rem] uppercase tracking-[0.2em] text-muted-foreground">
              {{ locale }}
            </p>
            <div hlmField>
              <label hlmFieldLabel [for]="'legal-title-' + locale">Title</label>
              <input
                hlmInput
                maxlength="120"
                [id]="'legal-title-' + locale"
                [ngModel]="d[active()][locale].title"
                (ngModelChange)="patch(locale, { title: $event })"
                [attr.aria-invalid]="issue(locale, 'title') ? true : null"
                [attr.aria-describedby]="
                  issue(locale, 'title') ? 'legal-title-' + locale + '-issue' : null
                "
              />
              <app-field-issue
                [id]="'legal-title-' + locale + '-issue'"
                [message]="issue(locale, 'title')"
              />
            </div>
            <app-rich-text
              mode="long"
              [label]="'Text (' + locale + ')'"
              [ngModel]="d[active()][locale].body"
              (ngModelChange)="patch(locale, { body: $event })"
            />
            <app-field-issue
              [id]="'legal-body-' + locale + '-issue'"
              [message]="issue(locale, 'body')"
            />
          </section>
          <hlm-separator />
        }
      }
    </div>

    <div class="mt-6 pb-28">
      <app-ui-group-editor
        #labels
        group="legal"
        title="Legal labels"
        description="The footer links and the “last updated” label."
        [fields]="labelFields"
        [saveBar]="false"
        [level]="2"
      />
    </div>

    @if (!loading() && docs()) {
      <app-save-bar
        [dirty]="dirty()"
        [saving]="saving()"
        [problems]="problems()"
        (save)="save()"
        (discard)="discard()"
      />
    }
  `,
})
export default class AdminLegalPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly labels = viewChild.required(UiGroupEditorComponent);

  protected readonly docList = DOCS;
  protected readonly labelFields = LABEL_FIELDS;
  protected readonly locales: Locale[] = ["en", "de"];
  protected readonly active = signal<LegalDoc>("imprint");
  protected readonly loading = signal(true);
  private readonly savingDocs = signal(false);
  protected readonly docs = signal<Docs | null>(null);
  private readonly pristine = signal<Docs | null>(null);
  /** Keyed `<doc>.<locale>.<field>`. */
  private readonly issues = new FieldIssues();

  private readonly tokens: Record<LegalDoc, string | null> = { imprint: null, privacy: null };

  private readonly docsDirty = computed(
    () => JSON.stringify(this.docs()) !== JSON.stringify(this.pristine()),
  );
  protected readonly dirty = computed(() => this.docsDirty() || this.labels().dirty());
  protected readonly saving = computed(() => this.savingDocs() || this.labels().saving());
  protected readonly problems = computed(() => this.issues.count() + this.labels().problems());

  constructor() {
    inject(DestroyRef).onDestroy(() => this.unsaved.clear("legal"));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected issue(locale: Locale, field: keyof LegalSectionInput): string | null {
    return this.issues.get(`${this.active()}.${locale}.${field}`);
  }

  /** (Re)loads both documents, dropping local edits to them. */
  private async load(): Promise<void> {
    const [imprint, privacy] = await Promise.all(
      DOCS.map((doc) => this.api.getSection<LegalSectionInput>(doc.id)),
    );
    this.loading.set(false);
    if (!imprint?.ok || !privacy?.ok) {
      toast.error("Could not load the legal pages");
      return;
    }

    const empty = (): LegalSectionInput => ({ title: "", body: "" });
    const docs: Docs = {
      imprint: { en: imprint.data.data.en ?? empty(), de: imprint.data.data.de ?? empty() },
      privacy: { en: privacy.data.data.en ?? empty(), de: privacy.data.data.de ?? empty() },
    };
    this.tokens.imprint = imprint.data.updatedAt;
    this.tokens.privacy = privacy.data.updatedAt;
    this.docs.set(structuredClone(docs));
    this.pristine.set(docs);
    this.issues.clear();
    this.unsaved.clear("legal");
  }

  protected patch(locale: Locale, change: Partial<LegalSectionInput>): void {
    const doc = this.active();
    this.docs.update((d) =>
      d ? { ...d, [doc]: { ...d[doc], [locale]: { ...d[doc][locale], ...change } } } : d,
    );
    for (const field of Object.keys(change)) this.issues.resolve(`${doc}.${locale}.${field}`);
    this.unsaved.set("legal", this.docsDirty());
  }

  protected discard(): void {
    const pristine = this.pristine();
    this.docs.set(pristine ? structuredClone(pristine) : null);
    this.issues.clear();
    this.unsaved.clear("legal");
    this.labels().discard();
  }

  /** The documents that changed, then the labels: one save bar, one Ctrl+S. */
  protected async save(): Promise<void> {
    const docs = this.docs();
    const pristine = this.pristine();
    if (!docs || !pristine || this.saving()) return;
    this.savingDocs.set(true);

    for (const { id } of DOCS) {
      if (JSON.stringify(docs[id]) === JSON.stringify(pristine[id])) continue;
      const result = await this.api.putSection(id, docs[id], this.tokens[id]);
      if (!result.ok) {
        this.savingDocs.set(false);
        if (result.status === 409) {
          toastStale(() => this.load(), "This page");
        } else if (result.issues?.length) {
          // `[locale, field]` of this document.
          this.issues.set(result.issues.map((i) => ({ ...i, path: [id, ...i.path] })));
          this.active.set(id);
          toastIssues(result.issues);
          focusFirstInvalid(this.host.nativeElement);
        } else {
          toast.error("Not saved", { description: result.error });
        }
        return;
      }
      this.tokens[id] = result.data.updatedAt;
      this.pristine.update((p) => (p ? { ...p, [id]: structuredClone(docs[id]) } : p));
    }
    this.savingDocs.set(false);
    this.unsaved.clear("legal");

    if (await this.labels().save()) toast.success("Draft saved");
  }
}
