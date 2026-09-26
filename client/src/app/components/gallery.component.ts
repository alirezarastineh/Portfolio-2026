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
 * A case study's screenshots: a grid, and a lightbox on click. The lightbox is
 * a native modal `<dialog>`, so the browser traps focus, closes it on Escape
 * and hands focus back afterwards. Each thumbnail is a real link to the image,
 * which is what it does without JavaScript.
 */
@Component({
  selector: "app-gallery",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgIcon, PictureComponent],
  viewProviders: [provideIcons({ lucideChevronLeft, lucideChevronRight, lucideX })],
  host: { class: "block" },
  template: `
    <ul class="m-0 grid list-none gap-4 p-0 sm:grid-cols-2" role="list">
      @for (image of images(); track $index; let i = $index) {
        <li>
          <figure class="m-0 flex flex-col gap-2">
            <a
              class="group block aspect-16/10 overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-accent-indigo/50"
              [href]="image.src"
              [attr.aria-label]="openLabel(i)"
              (click)="open(i, $event)"
            >
              <app-picture
                [image]="image"
                sizes="(min-width: 1024px) 26rem, (min-width: 640px) 50vw, 100vw"
                imgClass="block size-full object-cover transition-transform duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
              />
            </a>
            @if (image.caption) {
              <figcaption class="text-sm leading-relaxed text-muted-foreground">
                {{ image.caption }}
              </figcaption>
            }
          </figure>
        </li>
      }
    </ul>

    <dialog
      #dialog
      class="m-0 h-dvh max-h-none w-screen max-w-none bg-background/90 p-0 text-foreground backdrop:bg-scrim"
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
              imgClass="block max-h-[78vh] w-auto max-w-full rounded-lg object-contain"
            />
            <figcaption class="max-w-2xl text-center font-mono text-sm text-muted-foreground">
              <span>{{ (current() ?? 0) + 1 }} / {{ images().length }}</span>
              @if (image.caption) {
                <span> · {{ image.caption }}</span>
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

  protected readonly button =
    "inline-flex size-11 cursor-pointer items-center justify-center rounded-lg border border-border-strong bg-card/60 text-foreground transition-colors hover:bg-muted";

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
