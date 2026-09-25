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
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmField, HlmFieldLabel } from "@spartan-ng/helm/field";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTextarea } from "@spartan-ng/helm/textarea";

import {
  AdminApiService,
  type MediaAsset,
  type PostRow,
  type PostTranslationInput,
} from "../../../admin/admin-api.service";
import { CopilotSuggestComponent } from "../../../admin/components/copilot-suggest.component";
import {
  FieldIssueComponent,
  SaveBarComponent,
} from "../../../admin/components/editor-chrome.component";
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
    CopilotSuggestComponent,
    FieldIssueComponent,
    FormsModule,
    HlmButton,
    HlmField,
    HlmFieldLabel,
    HlmInput,
    HlmSeparator,
    HlmSkeleton,
    HlmSwitch,
    HlmTextarea,
    MediaFieldComponent,
    NgIcon,
    RichTextComponent,
    RouterLink,
    SaveBarComponent,
    StringListComponent,
  ],
  viewProviders: [provideIcons({ lucideArrowLeft })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-28">
      <a hlmBtn variant="ghost" size="sm" class="self-start" routerLink="/admin/writing">
        <ng-icon name="lucideArrowLeft" size="14" aria-hidden="true" />
        <span class="ml-1.5">All posts</span>
      </a>

      @if (loading()) {
        <hlm-skeleton class="h-96 w-full" />
      } @else if (!post()) {
        <p class="text-sm text-muted-foreground">Post not found.</p>
      } @else if (post(); as p) {
        <header>
          <h1 class="m-0 font-mono text-2xl tracking-tight">
            {{ p.translations.en?.title || p.translations.de?.title || p.slug }}
          </h1>
          <p class="mt-1 font-mono text-sm text-muted-foreground">/writing/{{ p.slug }}</p>
        </header>

        <section class="grid gap-4 sm:grid-cols-2">
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
            <span id="post-date-hint" class="text-[0.72rem] text-muted-foreground">
              In the future = scheduled: it appears with the first publish after this time.
            </span>
            <app-field-issue id="post-date-issue" [message]="issues.get('publishedAt')" />
          </div>
          <label class="flex items-center gap-3 font-mono text-[0.8rem]">
            <hlm-switch
              [checked]="p.status === 'published'"
              (checkedChange)="setPublished($event)"
            />
            <span>{{ p.status === "published" ? "Published" : "Draft — not on the site" }}</span>
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
              [attr.aria-describedby]="issues.get('canonicalUrl') ? 'post-canonical-issue' : null"
            />
            <app-field-issue id="post-canonical-issue" [message]="issues.get('canonicalUrl')" />
          </div>
        </section>
        <app-field-issue id="post-translations-issue" [message]="issues.get('translations')" />

        <app-media-field
          id="post-cover"
          label="Cover image"
          [path]="p.coverPath"
          (chosen)="chooseCover($event)"
        />

        <app-string-list
          label="Tags"
          singular="tag"
          emptyText="No tags yet."
          [max]="20"
          [value]="p.tags"
          (valueChange)="patch({ tags: $event })"
        />
        <app-field-issue id="post-tags-issue" [message]="issues.under('tags')" />

        @for (locale of locales; track locale) {
          <hlm-separator />
          <section class="flex flex-col gap-4">
            <label
              class="flex items-center gap-3 font-mono text-[0.8rem] uppercase tracking-[0.15em]"
            >
              <hlm-switch
                [checked]="p.translations[locale] !== null"
                (checkedChange)="setLocale(locale, $event)"
              />
              <span>{{ locale }} version</span>
            </label>

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
          (save)="save()"
          (discard)="discard()"
        />
      }
    </div>
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
  protected readonly saving = signal(false);
  protected readonly post = signal<PostDraft | null>(null);
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

  protected readonly localDate = computed(() => toLocalInput(this.post()?.publishedAt ?? null));

  constructor() {
    effect(() => this.unsaved.set("post", this.dirty()));
    inject(DestroyRef).onDestroy(() => this.unsaved.clear("post"));
  }

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const slug = this.route.snapshot.paramMap.get("slug");
    const list = await this.api.listPosts();
    const id = list.ok ? list.data.posts.find((p) => p.slug === slug)?.id : undefined;
    const result = id ? await this.api.getPost(id) : null;
    this.loading.set(false);

    if (!list.ok || (result && !result.ok)) {
      toast.error("Could not load the post");
      return;
    }
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
