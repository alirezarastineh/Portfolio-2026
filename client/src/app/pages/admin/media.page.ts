import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
  viewChild,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmAlert, HlmAlertDescription, HlmAlertTitle } from "@spartan-ng/helm/alert";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmInput } from "@spartan-ng/helm/input";
import { HlmDialogImports } from "@spartan-ng/helm/dialog";

import {
  AdminApiService,
  type MediaAsset,
  type MediaReconcile,
} from "../../admin/admin-api.service";
import { MediaPickerComponent } from "../../admin/components/media-picker.component";

@Component({
  selector: "app-admin-media",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    HlmAlert,
    HlmAlertDescription,
    HlmAlertTitle,
    HlmButton,
    HlmDialogImports,
    HlmInput,
    MediaPickerComponent,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <header>
        <h1 class="m-0 font-mono text-2xl tracking-tight">Media</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Images for projects, and PDFs such as your CV. Uploaded photos are straightened, stripped
          of location data and resized automatically. Deleting is blocked while the draft or the
          live site still uses a file; "Unused" lists the files nothing uses.
        </p>
      </header>

      @if (reconcile(); as r) {
        @if (r.missingFiles.length || r.orphanFiles.length) {
          <div hlmAlert variant="destructive">
            <h2 hlmAlertTitle>Media and database are out of step</h2>
            <div hlmAlertDescription>
              @if (r.missingFiles.length) {
                <p class="m-0">
                  {{ r.missingFiles.length }} record(s) point at a file that is not on disk —
                  usually a database restore without a matching media restore.
                </p>
              }
              @if (r.orphanFiles.length) {
                <p class="m-0">{{ r.orphanFiles.length }} file(s) on disk have no record.</p>
              }
            </div>
          </div>
        }
        <p class="m-0 font-mono text-[0.72rem] text-muted-foreground">
          {{ r.totalAssets }} file(s) · {{ formatSize(r.totalBytes) }} in originals
        </p>
      }

      <app-media-picker
        [deletable]="true"
        [allowDocuments]="true"
        (chosen)="select($event)"
        (changed)="loadReconcile()"
      />

      <!-- Clicking a thumbnail opens its alt text (or, for a PDF, its link) in a
           dialog rather than an inline form below the grid, which was easy to
           miss on a long list. -->
      <hlm-dialog
        [state]="active() ? 'open' : 'closed'"
        (stateChanged)="$event === 'closed' && active.set(null)"
      >
        <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-lg">
          @if (active(); as asset) {
            @if (asset.kind === "document") {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>{{ asset.originalName }}</h2>
                <p hlmDialogDescription>
                  PDF · {{ formatSize(asset.byteSize) }} — served at
                  <code class="font-mono text-[0.72rem]">{{ asset.path }}</code>
                </p>
              </hlm-dialog-header>
              <hlm-dialog-footer>
                <a hlmBtn variant="outline" [href]="asset.url" target="_blank" rel="noopener"
                  >Open PDF</a
                >
                <button hlmBtn type="button" (click)="active.set(null)">Close</button>
              </hlm-dialog-footer>
            } @else {
              <hlm-dialog-header>
                <h2 hlmDialogTitle>Alt text</h2>
                <p hlmDialogDescription>
                  {{ asset.originalName }} — describe it for screen readers and for when the image
                  fails to load.
                </p>
              </hlm-dialog-header>

              <img
                [src]="asset.url"
                alt=""
                class="max-h-48 w-full rounded-md border border-border object-contain"
              />

              <div class="grid gap-3">
                <label class="flex flex-col gap-1">
                  <span
                    class="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground"
                    >EN</span
                  >
                  <input hlmInput [(ngModel)]="altEn" aria-label="Alt text (English)" />
                </label>
                <label class="flex flex-col gap-1">
                  <span
                    class="font-mono text-[0.68rem] uppercase tracking-[0.2em] text-muted-foreground"
                    >DE</span
                  >
                  <input hlmInput [(ngModel)]="altDe" aria-label="Alt text (German)" />
                </label>
              </div>

              <hlm-dialog-footer>
                <button hlmBtn variant="ghost" type="button" (click)="active.set(null)">
                  Cancel
                </button>
                <button hlmBtn type="button" (click)="saveAlt(asset)">Save alt text</button>
              </hlm-dialog-footer>
            }
          }
        </hlm-dialog-content>
      </hlm-dialog>
    </div>
  `,
})
export default class AdminMediaPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly picker = viewChild(MediaPickerComponent);

  protected readonly active = signal<MediaAsset | null>(null);
  protected readonly reconcile = signal<MediaReconcile | null>(null);
  protected altEn = "";
  protected altDe = "";

  ngOnInit(): void {
    void this.loadReconcile();
  }

  protected formatSize(bytes: number): string {
    return bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  protected async loadReconcile(): Promise<void> {
    const result = await this.api.mediaReconcile();
    if (result.ok) this.reconcile.set(result.data);
  }

  protected select(asset: MediaAsset): void {
    this.active.set(asset);
    this.altEn = asset.altEn ?? "";
    this.altDe = asset.altDe ?? "";
  }

  protected async saveAlt(asset: MediaAsset): Promise<void> {
    const result = await this.api.updateMediaAlt(asset.id, {
      altEn: this.altEn || null,
      altDe: this.altDe || null,
    });

    if (!result.ok) {
      toast.error("Not saved", { description: result.error });
      return;
    }

    toast.success("Alt text saved");
    this.active.set(null);
    await this.picker()?.load();
    await this.loadReconcile();
  }
}
