import { isPlatformBrowser } from "@angular/common";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
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
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideBold,
  lucideItalic,
  lucideLink,
  lucideList,
  lucideListOrdered,
  lucideRemoveFormatting,
  lucideStrikethrough,
} from "@ng-icons/lucide";
import { NG_VALUE_ACCESSOR, type ControlValueAccessor } from "@angular/forms";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

interface ToolbarAction {
  id: string;
  icon: string;
  label: string;
  run: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
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
    id: "clear",
    icon: "lucideRemoveFormatting",
    label: "Clear formatting",
    run: (e) => e.chain().focus().unsetAllMarks().clearNodes().run(),
  },
];

/**
 * Tiptap wrapped for Angular. There is no official adapter, so this drives the
 * headless `Editor` directly.
 *
 * The value is sanitized HTML, not Tiptap JSON: the published payload stays
 * directly renderable and nothing on the public read path needs to know Tiptap
 * exists. The server sanitizes again on write — this component's output is not
 * trusted.
 */
@Component({
  selector: "app-rich-text",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon],
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RichTextComponent), multi: true },
  ],
  viewProviders: [
    provideIcons({
      lucideBold,
      lucideItalic,
      lucideLink,
      lucideList,
      lucideListOrdered,
      lucideRemoveFormatting,
      lucideStrikethrough,
    }),
  ],
  host: { class: "block" },
  template: `
    <div class="overflow-hidden rounded-lg border border-border">
      <div class="flex flex-wrap items-center gap-0.5 border-b border-border bg-card/40 p-1">
        @for (action of actions; track action.id) {
          <button
            type="button"
            class="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
            [class.bg-accent-indigo]="activeMarks().includes(action.id)"
            [class.text-foreground]="activeMarks().includes(action.id)"
            [attr.aria-label]="action.label"
            [attr.aria-pressed]="activeMarks().includes(action.id)"
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
          (click)="toggleLink()"
        >
          <ng-icon name="lucideLink" size="14" aria-hidden="true" />
        </button>
      </div>

      <!-- Tiptap replaces this element's contents; Angular must not manage them. -->
      <div
        #host
        class="admin-prose min-h-32 px-3 py-2 text-sm leading-relaxed focus-within:outline-none"
        [attr.aria-label]="label()"
      ></div>
    </div>
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
  /** Debounce for pushing HTML into the form; flushed early on blur. */
  readonly debounceMs = input(250);

  protected readonly actions = ACTIONS;
  protected readonly activeMarks = signal<string[]>([]);

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

    this.editor = new Editor({
      element: this.host().nativeElement,
      extensions: [StarterKit],
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
  }

  protected apply(action: ToolbarAction): void {
    if (this.editor) action.run(this.editor);
  }

  protected toggleLink(): void {
    const editor = this.editor;
    if (!editor) return;

    // StarterKit may or may not ship Link depending on version; degrade to a
    // no-op rather than throwing if the extension is absent.
    const chain = editor.chain().focus() as unknown as {
      toggleLink?: (attrs: { href: string }) => { run: () => void };
      unsetLink?: () => { run: () => void };
    };

    if (!chain.toggleLink) {
      console.warn("[rich-text] the Link extension is not installed");
      return;
    }

    if (editor.isActive("link")) {
      chain.unsetLink?.().run();
      return;
    }

    const href = globalThis.prompt?.("Link URL (https://…)")?.trim();
    if (!href) return;
    if (!/^(https?:|mailto:)/i.test(href)) {
      globalThis.alert?.("Only http, https and mailto links are allowed.");
      return;
    }

    chain.toggleLink({ href }).run();
  }
}
