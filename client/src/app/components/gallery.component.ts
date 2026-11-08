import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  signal,
  viewChild,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideChevronLeft, lucideChevronRight, lucideX } from "@ng-icons/lucide";

import type { GalleryImage, Locale } from "../content/schema";
import { CHROME } from "../i18n/chrome";
import { fmt } from "../i18n/interpolate";
import { PictureComponent } from "./picture.component";

/**
 * A case study's screenshots: two across, a row that scrolls on phones, and a
 * lightbox on click. The lightbox is a native modal `<dialog>`, so the browser
 * traps focus, closes it on Escape and hands focus back afterwards. Each
 * thumbnail is a real link to the image, which is what it does without JavaScript.
 */
@Component({
  selector: "app-gallery",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, PictureComponent],
  viewProviders: [provideIcons({ lucideChevronLeft, lucideChevronRight, lucideX })],
  host: { class: "block" },
  styles: `
    .gallery-row {
      display: grid;
      gap: 1rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    @media (width >= 40rem) {
      .gallery-row {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    /* On phones a row running to the edge of the screen, where the next image is cut: that shows
       there is more. The padding keeps focus rings inside. A lone image takes the whole width. */
    @media (width < 40rem) {
      .gallery-row {
        grid-auto-flow: column;
        grid-auto-columns: minmax(85%, 1fr);
        margin: -0.25rem calc(var(--gutter) * -1) -0.25rem -0.25rem;
        padding: 0.25rem var(--gutter) 0.25rem 0.25rem;
        overflow-x: auto;
        scroll-snap-type: x proximity;
        scroll-padding-inline: 0.25rem;
        scrollbar-width: none;
      }
      .gallery-row > li {
        scroll-snap-align: start;
      }
    }
  `,
  template: `
    <ul class="gallery-row" role="list">
      @for (image of images(); track $index; let i = $index) {
        <li>
          <figure class="m-0 flex flex-col gap-2">
            <a
              class="block aspect-16/10 touch-manipulation overflow-hidden rounded border border-border bg-card transition-colors hover:border-border-strong"
              [href]="image.src"
              [attr.aria-label]="openLabel(i)"
              (click)="open(i, $event)"
            >
              <app-picture [image]="image" [sizes]="thumb.sizes" [imgClass]="thumb.img" />
            </a>
            @if (image.caption) {
              <figcaption class="text-small text-muted-foreground">
                {{ image.caption }}
              </figcaption>
            }
          </figure>
        </li>
      }
    </ul>

    <dialog
      #dialog
      class="m-0 h-dvh max-h-none w-screen max-w-none bg-background p-0 text-foreground"
      [attr.aria-label]="label()"
      (close)="current.set(null)"
      (click)="closeOnBackdrop($event)"
      (keydown)="onKey($event)"
    >
      <div
        class="flex size-full flex-col items-center justify-center gap-4 p-4 sm:p-8"
        data-dismiss
      >
        <figure class="m-0 flex min-h-0 max-w-full flex-col items-center gap-3">
          @if (currentImage(); as image) {
            <app-picture
              [image]="image"
              sizes="100vw"
              imgClass="block max-h-[78vh] w-auto max-w-full rounded object-contain"
            />
            <figcaption class="flex max-w-2xl flex-col gap-1 text-center text-muted-foreground">
              <span class="text-data">{{ (current() ?? 0) + 1 }} / {{ images().length }}</span>
              @if (image.caption) {
                <span class="text-small">{{ image.caption }}</span>
              }
            </figcaption>
          }
        </figure>
        <div class="flex items-center gap-2">
          @if (images().length > 1) {
            <button
              type="button"
              [class]="button"
              [attr.aria-label]="labels().previous"
              (click)="step(-1)"
            >
              <ng-icon name="lucideChevronLeft" size="20" aria-hidden="true" />
            </button>
          }
          <button
            type="button"
            [class]="button"
            [attr.aria-label]="labels().close"
            autofocus
            (click)="close()"
          >
            <ng-icon name="lucideX" size="20" aria-hidden="true" />
          </button>
          @if (images().length > 1) {
            <button
              type="button"
              [class]="button"
              [attr.aria-label]="labels().next"
              (click)="step(1)"
            >
              <ng-icon name="lucideChevronRight" size="20" aria-hidden="true" />
            </button>
          }
        </div>
      </div>
    </dialog>
  `,
})
export class GalleryComponent {
  /**
   * A thumbnail's picture inputs. Bound rather than written as static
   * attributes, which the server would also print on every `<app-picture>`.
   */
  protected readonly thumb = {
    sizes: "(min-width: 1024px) 26rem, (min-width: 640px) 50vw, 85vw",
    img: "block size-full object-cover",
  };

  readonly images = input.required<readonly GalleryImage[]>();
  /** The dialog's accessible name, e.g. "Gallery". */
  readonly label = input.required<string>();
  readonly locale = input.required<Locale>();

  protected readonly current = signal<number | null>(null);
  protected readonly currentImage = computed(() => {
    const i = this.current();
    return i === null ? null : (this.images()[i] ?? null);
  });
  protected readonly labels = computed(() => CHROME[this.locale()].gallery);

  protected readonly button = "control press size-11 border-border-strong text-foreground";

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>("dialog");

  protected openLabel(i: number): string {
    const label = fmt(this.labels().open, { i: i + 1, n: this.images().length });
    const alt = this.images()[i]?.alt;
    return alt ? `${label}: ${alt}` : label;
  }

  protected open(i: number, event: MouseEvent): void {
    // A modified click (new tab, download) keeps the link's own behaviour.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    const dialog = this.dialog().nativeElement;
    if (typeof dialog.showModal !== "function") return;
    event.preventDefault();
    this.current.set(i);
    if (!dialog.open) dialog.showModal();
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected step(delta: number): void {
    const n = this.images().length;
    const i = this.current();
    if (i === null || n === 0) return;
    this.current.set((i + delta + n) % n);
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.key === "ArrowLeft") this.step(-1);
    else if (event.key === "ArrowRight") this.step(1);
    else return;
    event.preventDefault();
  }

  /** A click on the area around the image, not on the image or a button. */
  protected closeOnBackdrop(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (target === event.currentTarget || target?.hasAttribute("data-dismiss")) this.close();
  }
}
