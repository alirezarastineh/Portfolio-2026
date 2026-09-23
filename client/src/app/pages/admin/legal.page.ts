import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
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
import { SaveBarComponent } from "../../admin/components/editor-chrome.component";
import { RichTextComponent } from "../../admin/components/rich-text.component";
import {
  UiGroupEditorComponent,
  type UiFieldDef,
} from "../../admin/components/ui-group-editor.component";
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
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-28">
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
              />
            </div>
            <app-rich-text
              mode="long"
              [label]="'Text (' + locale + ')'"
              [ngModel]="d[active()][locale].body"
              (ngModelChange)="patch(locale, { body: $event })"
            />
          </section>
          <hlm-separator />
        }

        <app-save-bar [dirty]="dirty()" [saving]="saving()" (save)="save()" (discard)="discard()" />
      }
    </div>

    <app-ui-group-editor
      group="legal"
      title="Legal labels"
      description="The footer links and the “last updated” label."
      [fields]="labelFields"
    />
  `,
})
export default class AdminLegalPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly unsaved = inject(UnsavedChangesService);

  protected readonly docList = DOCS;
  protected readonly labelFields = LABEL_FIELDS;
  protected readonly locales: Locale[] = ["en", "de"];
  protected readonly active = signal<LegalDoc>("imprint");
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly docs = signal<Docs | null>(null);

  private pristine: Docs | null = null;
  private readonly tokens: Record<LegalDoc, string | null> = { imprint: null, privacy: null };

  protected readonly dirty = computed(
    () => JSON.stringify(this.docs()) !== JSON.stringify(this.pristine),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.unsaved.clear("legal"));
  }

  ngOnInit(): void {
    void this.load();
  }

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
    this.pristine = docs;
  }

  protected patch(locale: Locale, change: Partial<LegalSectionInput>): void {
    const doc = this.active();
    this.docs.update((d) =>
      d ? { ...d, [doc]: { ...d[doc], [locale]: { ...d[doc][locale], ...change } } } : d,
    );
    this.unsaved.set("legal", this.dirty());
  }

  protected discard(): void {
    this.docs.set(this.pristine ? structuredClone(this.pristine) : null);
    this.unsaved.clear("legal");
  }

  protected async save(): Promise<void> {
    const docs = this.docs();
    if (!docs || !this.pristine || this.saving()) return;
    this.saving.set(true);

    for (const { id } of DOCS) {
      if (JSON.stringify(docs[id]) === JSON.stringify(this.pristine[id])) continue;
      const result = await this.api.putSection(id, docs[id], this.tokens[id]);
      if (!result.ok) {
        this.saving.set(false);
        toast.error("Not saved", {
          description:
            result.status === 409
              ? "This page changed in another tab. Reload before saving."
              : "Every title needs text in both languages.",
        });
        return;
      }
      this.tokens[id] = result.data.updatedAt;
    }

    this.saving.set(false);
    this.pristine = structuredClone(docs);
    this.docs.set(structuredClone(docs));
    this.unsaved.clear("legal");
    toast.success("Draft saved");
  }
}
