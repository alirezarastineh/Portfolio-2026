import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideArrowLeft } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import {
  AdminApiService,
  type MediaAsset,
  type PostRow,
  type PostTranslationInput,
} from "../../../admin/admin-api.service";
import { countChangedFields } from "../../../admin/changed-fields";
import { EditorLayoutComponent } from "../../../admin/components/editor-layout.component";
import { postOutline, type OutlineItem } from "../../../admin/editor-outline";
import { CopilotSuggestComponent } from "../../../admin/components/copilot-suggest.component";
import {
  FieldIssueComponent,
  SaveBarComponent,
} from "../../../admin/components/editor-chrome.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
  NotFoundStateComponent,
} from "../../../admin/components/load-state.component";
import { AdminPageHeaderComponent } from "../../../admin/components/page-header.component";
import { FieldIssues, focusFirstInvalid } from "../../../admin/issues";
import { toastIssues } from "../../../admin/save-feedback";
import { MediaFieldComponent } from "../../../admin/components/media-field.component";
import { RichTextComponent } from "../../../admin/components/rich-text.component";
import { StringListComponent } from "../../../admin/components/string-list.component";
import { UnsavedChangesService, unsavedChangesGuard } from "../../../admin/unsaved-changes.service";
import type { Locale } from "../../../content/schema";

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

function blankTranslation(): PostTranslationInput {
  return { title: "", excerpt: "", body: "", seoTitle: "", seoDescription: "" };
}

/** `2026-09-22T10:30` in the browser's time zone, as a `datetime-local` wants it. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type PostDraft = PostRow;

@Component({
  selector: "app-admin-post-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    CopilotSuggestComponent,
    EditorLayoutComponent,
    FieldIssueComponent,
    FormSkeletonComponent,
    FormsModule,
    HlmBadge,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmSeparator,
    HlmSwitch,
    HlmTextarea,
    LoadErrorComponent,
    MediaFieldComponent,
    NgIcon,
    NotFoundStateComponent,
    RichTextComponent,
    RouterLink,
    SaveBarComponent,
    StringListComponent,
  ],
  viewProviders: [provideIcons({ lucideArrowLeft })],
  host: { class: "block" },
  template: `
    <app-editor-layout [outline]="outline()">
      <div class="flex flex-col gap-6 pb-28">
        <a hlmBtn variant="ghost" size="sm" class="self-start" routerLink="/admin/writing">
          <ng-icon name="lucideArrowLeft" size="14" aria-hidden="true" />
          <span class="ml-1.5">All posts</span>
        </a>

        @if (loading()) {
          <app-form-skeleton [rows]="7" />
        } @else if (loadError(); as reason) {
          <app-load-error title="Could not load the post" [reason]="reason" (retry)="reload()" />
        } @else if (!post()) {
          <app-not-found-state what="post" back="/admin/writing" backLabel="All posts" />
        } @else if (post(); as p) {
          <app-page-header
            [title]="p.translations.en?.title || p.translations.de?.title || p.slug"
            [meta]="'/writing/' + p.slug"
            [preview]="previewPath()"
          >
            <span headerStatus class="flex flex-wrap gap-1.5">
              <span hlmBadge [variant]="statusVariant()" class="font-mono">{{
                statusLabel()
              }}</span>
              @if (dirty()) {
                <span
                  hlmBadge
                  variant="outline"
                  class="border-accent-orange/50 font-mono text-accent-orange"
                  >unsaved</span
                >
              }
            </span>
          </app-page-header>

          <section
            id="post-details"
            aria-labelledby="post-details-title"
            class="flex flex-col gap-4"
          >
            <h2 id="post-details-title" class="m-0 text-h4">Details</h2>
            <div class="grid gap-4 sm:grid-cols-2">
              <div hlmField>
                <label hlmFieldLabel for="post-slug">Slug</label>
                <input
                  hlmInput
                  id="post-slug"
                  maxlength="80"
                  [ngModel]="p.slug"
                  (ngModelChange)="patch({ slug: $event })"
                  [attr.aria-invalid]="issues.get('slug') ? true : null"
                  [attr.aria-describedby]="issues.get('slug') ? 'post-slug-issue' : null"
                />
                <app-field-issue id="post-slug-issue" [message]="issues.get('slug')" />
              </div>
              <div hlmField>
                <label hlmFieldLabel for="post-date">Publish date</label>
                <input
                  hlmInput
                  id="post-date"
                  type="datetime-local"
                  [ngModel]="localDate()"
                  (ngModelChange)="setDate($event)"
                  [attr.aria-invalid]="issues.get('publishedAt') ? true : null"
                  [attr.aria-describedby]="
                    issues.get('publishedAt') ? 'post-date-issue post-date-hint' : 'post-date-hint'
                  "
                />
                <span id="post-date-hint" class="text-xs text-muted-foreground">
                  In the future = scheduled: it appears with the first publish after this time.
                </span>
                <app-field-issue id="post-date-issue" [message]="issues.get('publishedAt')" />
              </div>
              <label class="flex items-center gap-3 text-sm font-medium">
                <hlm-switch
                  [checked]="p.status === 'published'"
                  (checkedChange)="setPublished($event)"
                />
                <span>{{
                  p.status === "published" ? "Published" : "Draft — not on the site"
                }}</span>
              </label>
              <div hlmField>
                <label hlmFieldLabel for="post-canonical"
                  >Canonical URL (if first published elsewhere)</label
                >
                <input
                  hlmInput
                  id="post-canonical"
                  maxlength="500"
                  [ngModel]="p.canonicalUrl"
                  (ngModelChange)="patch({ canonicalUrl: $event })"
                  [attr.aria-invalid]="issues.get('canonicalUrl') ? true : null"
                  [attr.aria-describedby]="
                    issues.get('canonicalUrl') ? 'post-canonical-issue' : null
                  "
                />
                <app-field-issue id="post-canonical-issue" [message]="issues.get('canonicalUrl')" />
              </div>
            </div>
            <app-field-issue id="post-translations-issue" [message]="issues.get('translations')" />
          </section>

          <hlm-separator />

          <section id="post-cover" aria-labelledby="post-cover-title" class="flex flex-col gap-4">
            <h2 id="post-cover-title" class="m-0 text-h4">Cover</h2>
            <app-media-field
              id="post-cover-image"
              label="Cover image"
              [path]="p.coverPath"
              (chosen)="chooseCover($event)"
            />
          </section>

          <hlm-separator />

          <section id="post-tags" aria-labelledby="post-tags-title" class="flex flex-col gap-4">
            <h2 id="post-tags-title" class="m-0 text-h4">Tags</h2>
            <app-string-list
              label="Tags"
              singular="tag"
              emptyText="No tags yet."
              [max]="20"
              [value]="p.tags"
              (valueChange)="patch({ tags: $event })"
            />
            <app-field-issue id="post-tags-issue" [message]="issues.under('tags')" />
          </section>

          @for (locale of locales; track locale) {
            <hlm-separator />
            <section
              [id]="'post-' + locale"
              [attr.aria-labelledby]="'post-' + locale + '-title'"
              class="flex flex-col gap-4"
            >
              <!-- The switch is the section's heading: whether this language exists at all. -->
              <h2 [id]="'post-' + locale + '-title'" class="m-0">
                <label class="flex items-center gap-3 text-h4">
                  <hlm-switch
                    [checked]="p.translations[locale] !== null"
                    (checkedChange)="setLocale(locale, $event)"
                  />
                  <span>{{ locale === "en" ? "English" : "German" }} version</span>
                </label>
              </h2>

              @if (p.translations[locale]; as t) {
                <div hlmField>
                  <label hlmFieldLabel [for]="'post-title-' + locale">Title</label>
                  <input
                    hlmInput
                    [id]="'post-title-' + locale"
                    maxlength="200"
                    [ngModel]="t.title"
                    (ngModelChange)="patchText(locale, { title: $event })"
                    [attr.aria-invalid]="textIssue(locale, 'title') ? true : null"
                    [attr.aria-describedby]="
                      textIssue(locale, 'title') ? 'post-title-' + locale + '-issue' : null
                    "
                  />
                  <app-field-issue
                    [id]="'post-title-' + locale + '-issue'"
                    [message]="textIssue(locale, 'title')"
                  />
                </div>
                <div hlmField>
                  <label hlmFieldLabel [for]="'post-excerpt-' + locale">Excerpt</label>
                  <textarea
                    hlmTextarea
                    rows="2"
                    maxlength="600"
                    [id]="'post-excerpt-' + locale"
                    [ngModel]="t.excerpt"
                    (ngModelChange)="patchText(locale, { excerpt: $event })"
                  ></textarea>
                </div>
                <app-rich-text
                  mode="long"
                  [label]="'Body (' + locale + ')'"
                  [ngModel]="t.body"
                  (ngModelChange)="patchText(locale, { body: $event })"
                />
                <app-field-issue
                  [id]="'post-body-' + locale + '-issue'"
                  [message]="textIssue(locale, 'body')"
                />
                <div class="grid gap-4 sm:grid-cols-2">
                  <div hlmField>
                    <label hlmFieldLabel [for]="'post-seo-title-' + locale"
                      >Search title (optional)</label
                    >
                    <input
                      hlmInput
                      maxlength="120"
                      [id]="'post-seo-title-' + locale"
                      [ngModel]="t.seoTitle"
                      (ngModelChange)="patchText(locale, { seoTitle: $event })"
                    />
                  </div>
                  <div hlmField>
                    <label hlmFieldLabel [for]="'post-seo-description-' + locale"
                      >Search description</label
                    >
                    <input
                      hlmInput
                      maxlength="300"
                      [id]="'post-seo-description-' + locale"
                      [ngModel]="t.seoDescription"
                      (ngModelChange)="patchText(locale, { seoDescription: $event })"
                    />
                    <app-copilot-suggest
                      class="self-end"
                      [locale]="locale"
                      [source]="seoSources[locale]"
                      (suggested)="patchText(locale, { seoDescription: $event })"
                    />
                  </div>
                </div>
              } @else {
                <p class="m-0 text-sm text-muted-foreground">
                  This post does not exist in {{ locale.toUpperCase() }}; its alternate link stays
                  empty.
                </p>
              }
            </section>
          }

          <app-save-bar
            [dirty]="dirty()"
            [saving]="saving()"
            [problems]="issues.count()"
            [changes]="changes()"
            [previewHref]="previewPath()"
            (save)="save()"
            (discard)="discard()"
          />
        }
      </div>
    </app-editor-layout>
  `,
})
export default class AdminPostEditorPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly unsaved = inject(UnsavedChangesService);

  private readonly host = inject(ElementRef<HTMLElement>);

  protected readonly locales: Locale[] = ["en", "de"];
  protected readonly loading = signal(true);
  /** The API's reason when the post did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly post = signal<PostDraft | null>(null);

  /** As saved: a draft, scheduled for later, or published. */
  protected readonly statusLabel = computed(() => {
    this.revision();
    const saved = this.pristine;
    if (!saved || saved.status === "draft") return "draft";
    return saved.publishedAt && Date.parse(saved.publishedAt) > Date.now()
      ? "scheduled"
      : "published";
  });

  protected readonly statusVariant = computed(() => {
    const label = this.statusLabel();
    if (label === "published") return "default";
    return label === "scheduled" ? "secondary" : "outline";
  });

  /** The saved post's draft page, in English when it has one. */
  protected readonly previewPath = computed(() => {
    this.revision();
    const saved = this.pristine;
    if (!saved) return null;
    const locale = saved.translations.en ? "en" : "de";
    return `/admin/preview/${locale}/writing/${encodeURIComponent(saved.slug)}`;
  });
  /** The last save's problems, by the input's path (`translations.de.title`). */
  protected readonly issues = new FieldIssues();

  protected textIssue(locale: Locale, key: string): string | null {
    return this.issues.get(`translations.${locale}.${key}`);
  }

  /** What the copilot describes when asked for a search description. */
  protected readonly seoSources: Record<Locale, () => string> = {
    en: () => this.postText("en"),
    de: () => this.postText("de"),
  };

  private postText(locale: Locale): string {
    const t = this.post()?.translations[locale];
    if (!t) return "";
    return [t.title, t.excerpt, t.body].filter(Boolean).join("\n");
  }

  private pristine: PostDraft | null = null;
  private readonly revision = signal(0);

  protected readonly dirty = computed(() => {
    this.revision();
    const current = this.post();
    return current !== null && JSON.stringify(current) !== JSON.stringify(this.pristine);
  });

  /** The cover's path follows its id: one field. */
  protected readonly changes = computed(() => {
    this.revision();
    return countChangedFields(this.pristine, this.post(), ["coverPath"]);
  });

  /** The sections for the rail: how far along each is, and the last save's problems in it. */
  protected readonly outline = computed<OutlineItem[]>(() => {
    const p = this.post();
    return p
      ? postOutline(
          p,
          this.issues.entries().map(([path]) => path),
        )
      : [];
  });

  protected readonly localDate = computed(() => toLocalInput(this.post()?.publishedAt ?? null));

  constructor() {
    effect(() => this.unsaved.set("post", this.dirty()));
    inject(DestroyRef).onDestroy(() => this.unsaved.clear("post"));
  }

  ngOnInit(): void {
    void this.load();
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  private async load(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get("slug");
    const list = await this.api.listPosts();
    const id = list.ok ? list.data.posts.find((p) => p.slug === slug)?.id : undefined;
    const result = id ? await this.api.getPost(id) : null;
    this.loading.set(false);

    if (!list.ok) {
      this.loadError.set(list.error);
      return;
    }
    if (result && !result.ok) {
      this.loadError.set(result.error);
      return;
    }
    this.loadError.set(null);
    const found = result?.ok ? result.data.post : null;
    this.post.set(found ? structuredClone(found) : null);
    this.pristine = found ? structuredClone(found) : null;
    this.revision.update((v) => v + 1);
  }

  protected patch(change: Partial<PostDraft>): void {
    this.post.update((p) => (p ? { ...p, ...change } : p));
    this.revision.update((v) => v + 1);
    // `translations` is patched whole; its per-field messages clear in patchText.
    for (const key of Object.keys(change)) {
      if (key !== "translations") this.issues.resolve(key);
    }
  }

  protected setDate(value: string): void {
    this.patch({ publishedAt: value ? new Date(value).toISOString() : null });
  }

  protected setPublished(published: boolean): void {
    const current = this.post();
    this.patch({
      status: published ? "published" : "draft",
      // Publishing without a date means "now".
      publishedAt:
        published && !current?.publishedAt
          ? new Date().toISOString()
          : (current?.publishedAt ?? null),
    });
  }

  protected setLocale(locale: Locale, exists: boolean): void {
    const current = this.post();
    if (!current) return;
    this.issues.resolve("translations");
    this.patch({
      translations: {
        ...current.translations,
        [locale]: exists ? (current.translations[locale] ?? blankTranslation()) : null,
      },
    });
  }

  protected patchText(locale: Locale, change: Partial<PostTranslationInput>): void {
    const current = this.post();
    const translation = current?.translations[locale];
    if (!current || !translation) return;
    this.patch({
      translations: { ...current.translations, [locale]: { ...translation, ...change } },
    });
    for (const key of Object.keys(change)) this.issues.resolve(`translations.${locale}.${key}`);
  }

  protected chooseCover(asset: MediaAsset | null): void {
    this.patch({ coverId: asset?.id ?? null, coverPath: asset?.path ?? null });
  }

  protected discard(): void {
    this.post.set(this.pristine ? structuredClone(this.pristine) : null);
    this.revision.update((v) => v + 1);
    this.issues.clear();
  }

  protected async save(): Promise<void> {
    const current = this.post();
    if (!current || this.saving()) return;

    this.saving.set(true);
    const result = await this.api.updatePost(current.id, {
      slug: current.slug,
      status: current.status,
      publishedAt: current.publishedAt,
      coverId: current.coverId,
      tags: current.tags.filter((t) => t.trim() !== ""),
      canonicalUrl: current.canonicalUrl.trim(),
      translations: current.translations,
    });
    this.saving.set(false);

    if (!result.ok) {
      if (result.error === "duplicate_slug") {
        this.issues.add("slug", "Another post already uses this slug");
        focusFirstInvalid(this.host.nativeElement);
      } else if (result.issues?.length) {
        this.issues.set(result.issues);
        toastIssues(result.issues);
        focusFirstInvalid(this.host.nativeElement);
      } else {
        toast.error("Save failed", { description: result.error });
      }
      return;
    }

    const slugChanged = this.pristine?.slug !== current.slug;
    this.pristine = structuredClone(current);
    this.revision.update((v) => v + 1);
    this.issues.clear();
    toast.success("Draft saved");
    if (slugChanged)
      void this.router.navigate(["/admin/writing", current.slug], { replaceUrl: true });
  }
}
