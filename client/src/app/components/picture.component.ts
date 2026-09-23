import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";

import type { Image } from "../content/schema";

/**
 * A published image as `<picture>`: AVIF, then WebP, then the original, each
 * with its widths, so the browser downloads the smallest format and size that
 * fits. Intrinsic width/height keep the layout still while it loads, and the
 * tiny blurred placeholder shows until it has.
 *
 * `sizes` describes the rendered width; the default suits a full-width block.
 */
@Component({
  selector: "app-picture",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "contents" },
  template: `
    @if (image(); as img) {
      <picture class="contents">
        @for (source of img.sources; track source.type) {
          <source [attr.type]="source.type" [attr.srcset]="source.srcset" [attr.sizes]="sizes()" />
        }
        <img
          [src]="img.src"
          [attr.srcset]="img.srcset || null"
          [attr.sizes]="img.srcset ? sizes() : null"
          [alt]="alt() ?? img.alt"
          [attr.width]="img.width"
          [attr.height]="img.height"
          [attr.loading]="priority() ? 'eager' : 'lazy'"
          [attr.fetchpriority]="priority() ? 'high' : null"
          decoding="async"
          [class]="imgClass()"
          [style.background-image]="placeholder()"
          [style.background-size]="img.blur ? 'cover' : null"
        />
      </picture>
    }
  `,
})
export class PictureComponent {
  readonly image = input.required<Image | null>();
  /** Overrides the image's own alt text (the CMS's per-locale alt). */
  readonly alt = input<string | null>(null);
  readonly sizes = input("100vw");
  /** The page's largest image: loaded eagerly and first. */
  readonly priority = input(false);
  readonly imgClass = input("");

  protected readonly placeholder = computed(() => {
    const blur = this.image()?.blur;
    return blur ? `url("${blur}")` : null;
  });
}
