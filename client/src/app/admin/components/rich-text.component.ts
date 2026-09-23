import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  forwardRef,
  inject,
  input,
  PLATFORM_ID,
  signal,
  viewChild,
  ViewEncapsulation,
} from "@angular/core";
import { FormsModule, NG_VALUE_ACCESSOR, type ControlValueAccessor } from "@angular/forms";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideBold,
  lucideCode,
  lucideHeading2,
  lucideHeading3,
  lucideImagePlus,
  lucideItalic,
  lucideLink,
  lucideList,
  lucideListOrdered,
  lucideMinus,
  lucideQuote,
  lucideRemoveFormatting,
  lucideSquareCode,
  lucideStrikethrough,
} from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDialogImports } from "@spartan-ng/helm/dialog";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmSheetImports } from "@spartan-ng/helm/sheet";
import { Editor } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";

import type { MediaAsset } from "../admin-api.service";
import { MediaPickerComponent } from "./media-picker.component";

interface ToolbarAction {
  id: string;
  icon: string;
  label: string;
  run: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
  /** Only in `long` mode: structure for case studies, posts and legal pages. */
  block?: boolean;
}

const ACTIONS: ToolbarAction[] = [
  {
    id: "bold",
    icon: "lucideBold",
    label: "Bold",
    run: (e) => e.chain().focus().toggleBold().run(),
    isActive: (e) => e.isActive("bold"),
  },
  {
    id: "italic",
    icon: "lucideItalic",
    label: "Italic",
    run: (e) => e.chain().focus().toggleItalic().run(),
    isActive: (e) => e.isActive("italic"),
  },
  {
    id: "strike",
    icon: "lucideStrikethrough",
    label: "Strikethrough",
    run: (e) => e.chain().focus().toggleStrike().run(),
    isActive: (e) => e.isActive("strike"),
  },
  {
    id: "code",
    icon: "lucideCode",
    label: "Inline code",
    run: (e) => e.chain().focus().toggleCode().run(),
    isActive: (e) => e.isActive("code"),
  },
  {
    id: "bulletList",
    icon: "lucideList",
    label: "Bullet list",
    run: (e) => e.chain().focus().toggleBulletList().run(),
    isActive: (e) => e.isActive("bulletList"),
  },
  {
    id: "orderedList",
    icon: "lucideListOrdered",
    label: "Numbered list",
    run: (e) => e.chain().focus().toggleOrderedList().run(),
    isActive: (e) => e.isActive("orderedList"),
  },
  {
    id: "h2",
    icon: "lucideHeading2",
    label: "Heading",
    block: true,
    run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e) => e.isActive("heading", { level: 2 }),
  },
  {
    id: "h3",
    icon: "lucideHeading3",
    label: "Subheading",
    block: true,
    run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e) => e.isActive("heading", { level: 3 }),
  },
  {
    id: "blockquote",
    icon: "lucideQuote",
    label: "Quote",
    block: true,
    run: (e) => e.chain().focus().toggleBlockquote().run(),
    isActive: (e) => e.isActive("blockquote"),
  },
  {
    id: "codeBlock",
    icon: "lucideSquareCode",
    label: "Code block",
    block: true,
    run: (e) => e.chain().focus().toggleCodeBlock().run(),
    isActive: (e) => e.isActive("codeBlock"),
  },
  {
    id: "hr",
    icon: "lucideMinus",
    label: "Divider",
    block: true,
    run: (e) => e.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "clear",
    icon: "lucideRemoveFormatting",
    label: "Clear formatting",
    run: (e) => e.chain().focus().unsetAllMarks().clearNodes().run(),
  },
];

/**
 * Languages a code block can declare: the ones the publish-time highlighter
 * knows (server/src/content/highlight.ts). Anything else still publishes, as
 * plain text.
 */
const CODE_LANGUAGES = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "bash",
  "python",
  "html",
  "css",
  "scss",
  "sql",
  "yaml",
  "toml",
  "dockerfile",
  "go",
  "rust",
  "java",
  "diff",
  "markdown",
  "graphql",
  "xml",
];

/** What the server's sanitizer keeps: web and mail links, or a path on this site. */
const LINK_PATTERN = /^(https?:\/\/\S+|mailto:\S+|\/[^\s]*)$/i;

/**
 * Tiptap wrapped for Angular. There is no official adapter, so this drives the
 * headless `Editor` directly.
 *
 * The value is sanitized HTML, not Tiptap JSON: the published payload stays
 * directly renderable and nothing on the public read path needs to know Tiptap
 * exists. The server sanitizes again on write — this component's output is not
 * trusted.
 *
 * `mode="long"` adds structure — headings, quotes, code blocks with a
 * language, dividers and images from the media library — for bodies.
 */
@Component({
  selector: "app-rich-text",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    HlmButton,
    HlmDialogImports,
    HlmInput,
    HlmSheetImports,
    MediaPickerComponent,
    NgIcon,
  ],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RichTextComponent), multi: true },
  ],
  viewProviders: [
    provideIcons({
      lucideBold,
      lucideCode,
      lucideHeading2,
      lucideHeading3,
      lucideImagePlus,
      lucideItalic,
      lucideLink,
      lucideList,
      lucideListOrdered,
      lucideMinus,
      lucideQuote,
      lucideRemoveFormatting,
      lucideSquareCode,
      lucideStrikethrough,
    }),
  ],
  host: { class: "block" },
  template: `
    <div class="overflow-hidden rounded-lg border border-border">
      <div
        class="flex flex-wrap items-center gap-0.5 border-b border-border bg-card/40 p-1"
        role="toolbar"
        [attr.aria-label]="label() + ' formatting'"
      >
        @for (action of actions(); track action.id) {
          <button
            type="button"
            class="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            [class.bg-accent-indigo]="activeMarks().includes(action.id)"
            [class.text-foreground]="activeMarks().includes(action.id)"
            [attr.aria-label]="action.label"
            [attr.aria-pressed]="action.isActive ? activeMarks().includes(action.id) : null"
            [title]="action.label"
            (click)="apply(action)"
          >
            <ng-icon [name]="action.icon" size="14" aria-hidden="true" />
          </button>
        }
        <button
          type="button"
          class="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          [class.bg-accent-indigo]="activeMarks().includes('link')"
          aria-label="Add or edit link"
          title="Link"
          (click)="openLinkDialog()"
        >
          <ng-icon name="lucideLink" size="14" aria-hidden="true" />
        </button>
        @if (mode() === "long") {
          <button
            type="button"
            class="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            aria-label="Insert an image from the media library"
            title="Image"
            (click)="imagePickerOpen.set(true)"
          >
            <ng-icon name="lucideImagePlus" size="14" aria-hidden="true" />
          </button>
        }
        @if (inCodeBlock()) {
          <label
            class="ml-1 flex items-center gap-1 font-mono text-[0.68rem] text-muted-foreground"
          >
            <span>language</span>
            <select
              class="h-7 rounded border border-border bg-card px-1 font-mono text-[0.7rem] text-foreground"
              [ngModel]="codeLanguage()"
              (ngModelChange)="setCodeLanguage($event)"
              aria-label="Code block language"
            >
              <option value="">plain text</option>
              @for (language of codeLanguages; track language) {
                <option [value]="language">{{ language }}</option>
              }
            </select>
          </label>
        }
      </div>

      <!-- Tiptap replaces this element's contents; Angular must not manage them. -->
      <div
        #host
        class="admin-prose px-3 py-2 text-sm leading-relaxed focus-within:outline-none"
        [class.min-h-32]="mode() === 'inline'"
        [class.min-h-96]="mode() === 'long'"
        [attr.aria-label]="label()"
      ></div>
    </div>

    <hlm-dialog
      [state]="linkDialogOpen() ? 'open' : 'closed'"
      (stateChanged)="onLinkDialogState($event)"
    >
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-md">
        <hlm-dialog-header>
          <h2 hlmDialogTitle class="font-mono text-base">Link</h2>
          <p hlmDialogDescription>
            A web address, a mailto: address, or a path on this site (/en/…).
          </p>
        </hlm-dialog-header>
        <form class="flex flex-col gap-3" (ngSubmit)="applyLink()">
          <input
            hlmInput
            name="href"
            placeholder="https://…"
            aria-label="Link address"
            [ngModel]="linkHref()"
            (ngModelChange)="linkHref.set($event)"
            autofocus
          />
          <label class="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              name="newTab"
              [ngModel]="linkNewTab()"
              (ngModelChange)="linkNewTab.set($event)"
            />
            Open in a new tab
          </label>
          @if (linkError()) {
            <p class="m-0 text-sm text-destructive" role="alert">{{ linkError() }}</p>
          }
          <hlm-dialog-footer>
            @if (activeMarks().includes("link")) {
              <button
                hlmBtn
                variant="ghost"
                type="button"
                class="mr-auto text-destructive"
                (click)="removeLink()"
              >
                Remove link
              </button>
            }
            <button hlmBtn variant="ghost" type="button" (click)="linkDialogOpen.set(false)">
              Cancel
            </button>
            <button hlmBtn type="submit">Apply</button>
          </hlm-dialog-footer>
        </form>
      </hlm-dialog-content>
    </hlm-dialog>

    @if (mode() === "long") {
      <hlm-sheet
        side="right"
        [state]="imagePickerOpen() ? 'open' : 'closed'"
        (stateChanged)="imagePickerOpen.set($event === 'open')"
      >
        <hlm-sheet-content *hlmSheetPortal="let ctx" class="w-full overflow-y-auto sm:max-w-2xl">
          <hlm-sheet-header>
            <h2 hlmSheetTitle>Insert an image</h2>
            <p hlmSheetDescription>
              It is published as a responsive picture. Set its alt text in the media library.
            </p>
          </hlm-sheet-header>
          <div class="px-4 pb-6">
            <app-media-picker (chosen)="insertImage($event)" />
          </div>
        </hlm-sheet-content>
      </hlm-sheet>
    }
  `,
  // Tiptap builds its DOM outside Angular's renderer, so none of it carries the
  // scoping attribute emulated encapsulation relies on. The `.admin-prose`
  // prefix does the scoping instead.
  encapsulation: ViewEncapsulation.None,
  styles: `
    .admin-prose p {
      margin: 0 0 0.5rem;
    }
    .admin-prose p:last-child {
      margin-bottom: 0;
    }
    .admin-prose ul,
    .admin-prose ol {
      margin: 0 0 0.5rem;
      padding-left: 1.25rem;
    }
    .admin-prose ul {
      list-style: disc;
    }
    .admin-prose ol {
      list-style: decimal;
    }
    .admin-prose h2 {
      margin: 1rem 0 0.5rem;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .admin-prose h3 {
      margin: 0.75rem 0 0.4rem;
      font-size: 1rem;
      font-weight: 600;
    }
    .admin-prose blockquote {
      margin: 0 0 0.5rem;
      border-left: 2px solid var(--color-accent-orange);
      padding-left: 0.75rem;
      font-style: italic;
    }
    .admin-prose pre {
      margin: 0 0 0.5rem;
      overflow-x: auto;
      border-radius: 0.5rem;
      background: oklch(0.2 0 0);
      padding: 0.6rem 0.8rem;
      font-family: var(--font-mono);
      font-size: 0.8rem;
    }
    .admin-prose code {
      font-family: var(--font-mono);
    }
    .admin-prose hr {
      margin: 1rem 0;
      border: 0;
      border-top: 1px solid var(--color-border);
    }
    .admin-prose img {
      max-width: 100%;
      height: auto;
      border-radius: 0.5rem;
    }
    .admin-prose img.ProseMirror-selectednode {
      outline: 2px solid var(--color-accent-indigo);
    }
    .admin-prose a {
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .admin-prose .ProseMirror {
      outline: none;
    }
  `,
})
export class RichTextComponent implements ControlValueAccessor {
  readonly label = input("Rich text");
  /** `inline` for short fields; `long` adds headings, code, images and more. */
  readonly mode = input<"inline" | "long">("inline");
  /** Debounce for pushing HTML into the form; flushed early on blur. */
  readonly debounceMs = input(250);

  protected readonly actions = computed(() =>
    this.mode() === "long" ? ACTIONS : ACTIONS.filter((a) => !a.block),
  );
  protected readonly codeLanguages = CODE_LANGUAGES;
  protected readonly activeMarks = signal<string[]>([]);
  protected readonly inCodeBlock = signal(false);
  protected readonly codeLanguage = signal("");

  protected readonly linkDialogOpen = signal(false);
  protected readonly linkHref = signal("");
  protected readonly linkNewTab = signal(false);
  protected readonly linkError = signal("");
  protected readonly imagePickerOpen = signal(false);

  private readonly host = viewChild.required<ElementRef<HTMLElement>>("host");
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly destroyRef = inject(DestroyRef);
  private editor?: Editor;

  /** Value to seed the editor with if `writeValue` arrives before it exists. */
  private pending = "";
  private lastEmitted = "";
  private disabled = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private onChange: (value: string) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  constructor() {
    // Tiptap touches `document` at construction, so it must never run during
    // SSR. The admin is browser-only anyway; this makes that explicit.
    afterNextRender(() => this.create());

    this.destroyRef.onDestroy(() => {
      // Deliver any keystrokes still waiting in the debounce before teardown.
      this.flush();
      // Leaking ProseMirror instances is the classic failure here.
      this.editor?.destroy();
    });
  }

  /* ---- ControlValueAccessor ---- */

  writeValue(value: string | null = ""): void {
    const next = value ?? "";
    this.lastEmitted = next;

    if (!this.editor) {
      this.pending = next;
      return;
    }
    // Already showing this — re-setting it would throw the caret to the start.
    if (next === this.editor.getHTML()) return;
    // emitUpdate: false — a value arriving FROM the form must not echo back
    // into it.
    this.editor.commands.setContent(next || "<p></p>", { emitUpdate: false });
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
    this.editor?.setEditable(!isDisabled);
  }

  private create(): void {
    if (!this.isBrowser) return;

    const long = this.mode() === "long";
    this.editor = new Editor({
      element: this.host().nativeElement,
      extensions: [
        StarterKit.configure({
          // Headings, quotes, code blocks and rules only where a body wants
          // them; `<u>` never, since the sanitizer drops it anyway.
          heading: long ? { levels: [2, 3] } : false,
          blockquote: long ? {} : false,
          codeBlock: long ? {} : false,
          horizontalRule: long ? {} : false,
          underline: false,
          link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
        }),
        ...(long ? [Image.configure({ inline: false, allowBase64: false })] : []),
      ],
      content: this.pending || "<p></p>",
      editable: !this.disabled,
      onUpdate: ({ editor }) => {
        this.schedule(editor.getHTML());
        this.refreshActive(editor);
      },
      onSelectionUpdate: ({ editor }) => this.refreshActive(editor),
      // Blur flushes immediately, so clicking "Save draft" right after typing
      // (which blurs the editor first) never saves a stale value.
      onBlur: () => {
        this.flush();
        this.onTouched();
      },
    });

    this.refreshActive(this.editor);
  }

  private schedule(html: string): void {
    clearTimeout(this.timer);
    this.pending = html;
    this.timer = setTimeout(() => this.flush(), this.debounceMs());
  }

  private flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;

    const html = this.editor?.getHTML() ?? this.pending;
    if (html === this.lastEmitted) return;

    this.lastEmitted = html;
    this.onChange(html);
  }

  private refreshActive(editor: Editor): void {
    const active = ACTIONS.filter((a) => a.isActive?.(editor)).map((a) => a.id);
    if (editor.isActive("link")) active.push("link");
    this.activeMarks.set(active);

    const inCode = editor.isActive("codeBlock");
    this.inCodeBlock.set(inCode);
    this.codeLanguage.set(
      inCode ? ((editor.getAttributes("codeBlock")["language"] as string | null) ?? "") : "",
    );
  }

  protected apply(action: ToolbarAction): void {
    if (this.editor) action.run(this.editor);
  }

  protected setCodeLanguage(language: string): void {
    this.editor
      ?.chain()
      .focus()
      .updateAttributes("codeBlock", { language: language || null })
      .run();
  }

  /* ---- links ---- */

  protected openLinkDialog(): void {
    const editor = this.editor;
    if (!editor) return;
    const attributes = editor.getAttributes("link") as { href?: string; target?: string };
    this.linkHref.set(attributes.href ?? "");
    this.linkNewTab.set(attributes.target === "_blank");
    this.linkError.set("");
    this.linkDialogOpen.set(true);
  }

  protected onLinkDialogState(state: string): void {
    this.linkDialogOpen.set(state === "open");
  }

  protected applyLink(): void {
    const editor = this.editor;
    if (!editor) return;

    const href = this.linkHref().trim();
    if (!href) {
      this.removeLink();
      return;
    }
    if (!LINK_PATTERN.test(href)) {
      this.linkError.set("Use an address starting with https://, http://, mailto: or /.");
      return;
    }

    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href, target: this.linkNewTab() ? "_blank" : null })
      .run();
    this.linkDialogOpen.set(false);
  }

  protected removeLink(): void {
    this.editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    this.linkDialogOpen.set(false);
  }

  /* ---- images ---- */

  protected insertImage(asset: MediaAsset): void {
    this.imagePickerOpen.set(false);
    if (asset.kind !== "image") return;
    this.editor
      ?.chain()
      .focus()
      .setImage({ src: asset.path, alt: asset.altEn ?? "" })
      .run();
  }
}
