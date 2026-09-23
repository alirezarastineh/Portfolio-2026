import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from "@angular/core";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDialogImports } from "@spartan-ng/helm/dialog";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSpinner } from "@spartan-ng/helm/spinner";
import { HlmTabsImports } from "@spartan-ng/helm/tabs";

import {
  AdminApiService,
  type PublicationRow,
  type RevisionDetail,
} from "../../admin/admin-api.service";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { diffJson } from "../../admin/json-diff";

type DetailTab = "changes" | "json";

/**
 * Every publish and rollback, each holding both languages. Rolling back makes
 * a whole publication live again (as a new one, so nothing is lost); restoring
 * into the draft loads it into the editors instead.
 */
@Component({
  selector: "app-admin-publications",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmBadge, HlmButton, HlmDialogImports, HlmSkeleton, HlmSpinner, HlmTabsImports],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <header>
        <h1 class="m-0 font-mono text-2xl tracking-tight">Publications</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Every publish is kept, with <strong>both languages</strong> together. Rolling back makes
          one live again as a new publication, so nothing is ever lost. "Restore into draft" loads
          it into the editors instead, to change before publishing again.
        </p>
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-64 w-full" />
      } @else if (!rows().length) {
        <p class="text-sm text-muted-foreground">Nothing published yet.</p>
      } @else {
        <ul class="m-0 flex list-none flex-col gap-2 p-0" role="list">
          @for (row of rows(); track row.id) {
            <li class="flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="m-0 truncate font-mono text-sm">
                  #{{ row.id }} ·
                  {{ row.label || (row.kind === "rollback" ? "rollback" : "unlabelled") }}
                </p>
                <p class="m-0 mt-0.5 font-mono text-[0.72rem] text-muted-foreground">
                  {{ formatDate(row.createdAt) }} · schema v{{ row.schemaVersion }}
                  @if (row.restoredFrom) {
                    · from #{{ row.restoredFrom }}
                  }
                </p>
              </div>
              @if (row.live) {
                <span hlmBadge variant="secondary" class="font-mono text-[0.65rem]">live</span>
              }
              @for (version of row.versions; track version.id) {
                <button
                  hlmBtn
                  variant="ghost"
                  size="sm"
                  class="font-mono text-[0.72rem] uppercase"
                  [disabled]="viewing() !== null"
                  [attr.aria-label]="'View ' + version.locale + ' of publication ' + row.id"
                  (click)="view(row, version.id)"
                >
                  @if (viewing() === version.id) {
                    <hlm-spinner class="size-4" />
                  } @else {
                    {{ version.locale }}
                  }
                </button>
              }
              <button
                hlmBtn
                variant="outline"
                size="sm"
                [disabled]="busy() !== null"
                (click)="restoreDraft(row)"
              >
                Restore into draft
              </button>
              @if (!row.live) {
                <button hlmBtn size="sm" [disabled]="busy() !== null" (click)="rollback(row)">
                  Roll back
                </button>
              }
            </li>
          }
        </ul>
      }
    </div>

    <hlm-dialog
      [state]="detail() ? 'open' : 'closed'"
      (stateChanged)="$event === 'closed' && detail.set(null)"
    >
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-3xl">
        @if (detail(); as d) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle class="font-mono">
              #{{ detailPublication()?.id }} · {{ d.revision.locale.toUpperCase() }}
            </h2>
            <p hlmDialogDescription>
              {{ d.revision.label || "unlabelled" }} — published
              {{ formatDate(d.revision.createdAt) }}
            </p>
          </hlm-dialog-header>

          <div
            hlmTabs
            [tab]="tab()"
            (tabActivated)="tab.set($event === 'json' ? 'json' : 'changes')"
            class="min-w-0"
          >
            <div hlmTabsList aria-label="Publication view">
              <button hlmTabsTrigger="changes">Changes vs live</button>
              <button hlmTabsTrigger="json">Full JSON</button>
            </div>

            <div hlmTabsContent="changes" class="min-w-0">
              @if (d.revision.live) {
                <p class="m-0 text-sm text-muted-foreground">
                  This is live, so there is nothing to compare it with.
                </p>
              } @else if (!d.live) {
                <p class="m-0 text-sm text-muted-foreground">
                  Nothing is live in this language yet.
                </p>
              } @else if (!changes().length) {
                <p class="m-0 text-sm text-muted-foreground">
                  The same content as what is live. (Case-study and post bodies are compared on
                  publish, not here.)
                </p>
              } @else {
                <p class="m-0 mb-3 text-[0.8rem] text-muted-foreground">
                  Rolling back would change {{ changes().length }}
                  {{ changes().length === 1 ? "field" : "fields" }} in this language:
                </p>
                <ol class="m-0 flex max-h-[60vh] list-none flex-col gap-3 overflow-y-auto p-0 pr-1">
                  @for (entry of changes(); track entry.path) {
                    <li class="rounded-lg border border-border p-3">
                      <div class="mb-2 flex items-start justify-between gap-2">
                        <code class="font-mono text-[0.72rem] break-all text-foreground">{{
                          entry.path
                        }}</code>
                        <span
                          hlmBadge
                          variant="outline"
                          class="shrink-0 font-mono text-[0.62rem]"
                          >{{ entry.kind }}</span
                        >
                      </div>
                      <dl class="m-0 grid gap-1.5 text-[0.78rem] leading-relaxed">
                        @if (entry.before !== undefined) {
                          <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
                            <dt
                              class="font-mono text-[0.66rem] uppercase tracking-wider text-destructive"
                            >
                              live
                            </dt>
                            <dd
                              class="m-0 whitespace-pre-wrap wrap-break-word text-muted-foreground"
                            >
                              {{ entry.before }}
                            </dd>
                          </div>
                        }
                        @if (entry.after !== undefined) {
                          <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
                            <dt
                              class="font-mono text-[0.66rem] uppercase tracking-wider text-accent-indigo"
                            >
                              #{{ detailPublication()?.id }}
                            </dt>
                            <dd class="m-0 whitespace-pre-wrap wrap-break-word text-foreground">
                              {{ entry.after }}
                            </dd>
                          </div>
                        }
                      </dl>
                    </li>
                  }
                </ol>
              }
            </div>

            <div hlmTabsContent="json" class="min-w-0">
              <pre
                class="m-0 max-h-[60vh] overflow-auto rounded-lg border border-border bg-card/40 p-3 font-mono text-[0.72rem] leading-relaxed"
                >{{ json() }}</pre>
            </div>
          </div>

          <hlm-dialog-footer>
            <button hlmBtn variant="ghost" type="button" (click)="detail.set(null)">Close</button>
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export default class AdminPublicationsPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);

  protected readonly rows = signal<PublicationRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal<number | null>(null);
  protected readonly viewing = signal<number | null>(null);
  protected readonly detail = signal<RevisionDetail | null>(null);
  protected readonly detailPublication = signal<PublicationRow | null>(null);
  protected readonly tab = signal<DetailTab>("changes");

  /** Live → this publication, i.e. exactly what a rollback would change (upcast to v2 by the API). */
  protected readonly changes = computed(() => {
    const d = this.detail();
    if (!d?.live || d.revision.live) return [];
    return diffJson(d.live.payload, d.revision.payload);
  });

  protected readonly json = computed(() => {
    const d = this.detail();
    return d ? JSON.stringify(d.revision.payload, null, 2) : "";
  });

  ngOnInit(): void {
    void this.load();
  }

  protected formatDate(value: string): string {
    return new Date(value).toLocaleString();
  }

  private async load(): Promise<void> {
    const result = await this.api.publications();
    this.loading.set(false);
    if (!result.ok) {
      toast.error("Could not load publications", { description: result.error });
      return;
    }
    this.rows.set(result.data.publications);
  }

  protected async view(row: PublicationRow, versionId: number): Promise<void> {
    this.viewing.set(versionId);
    const result = await this.api.revision(versionId);
    this.viewing.set(null);
    if (!result.ok) {
      toast.error("Could not load it", { description: result.error });
      return;
    }
    this.tab.set("changes");
    this.detailPublication.set(row);
    this.detail.set(result.data);
  }

  protected async rollback(row: PublicationRow): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: `Roll back to publication #${row.id}?`,
      description:
        "Both languages go back to how they were in it, live immediately, as a new publication. Nothing is deleted.",
      confirmLabel: "Roll back",
    });
    if (!confirmed) return;

    this.busy.set(row.id);
    const result = await this.api.rollbackPublication(row.id);
    this.busy.set(null);
    if (!result.ok) {
      toast.error("Rollback failed", { description: describePublicationError(result.error) });
      return;
    }
    toast.success("Rolled back", {
      description: `Publication #${result.data.publicationId} is live.`,
    });
    await this.load();
  }

  protected async restoreDraft(row: PublicationRow): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: `Restore publication #${row.id} into the draft?`,
      description:
        "The editors will show both languages as they were in it, replacing your current draft. Anything added since is hidden (posts: unpublished), not deleted. Nothing goes live until you publish.",
      confirmLabel: "Restore into draft",
    });
    if (!confirmed) return;

    this.busy.set(row.id);
    const result = await this.api.restoreDraft(row.id);
    this.busy.set(null);
    if (!result.ok) {
      toast.error("Restore failed", { description: describePublicationError(result.error) });
      return;
    }
    toast.success("Draft restored", {
      description: "Review it in the editors, then publish from the dashboard.",
    });
  }
}

/** Plain-language versions of the API's publication error codes. */
function describePublicationError(code: string): string {
  switch (code) {
    case "media_missing":
      return "A file this publication shows has since been deleted from the media library.";
    case "invalid_payload":
      return "This publication no longer matches the current content format.";
    case "incomplete_publication":
      return "This older publication holds only one language, so it cannot be restored into the draft.";
    default:
      return code;
  }
}
