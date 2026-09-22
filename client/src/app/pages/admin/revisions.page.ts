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
import { HlmTableImports } from "@spartan-ng/helm/table";
import { HlmTabsImports } from "@spartan-ng/helm/tabs";

import {
  AdminApiService,
  type RevisionDetail,
  type RevisionRow,
} from "../../admin/admin-api.service";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import { diffJson } from "../../admin/json-diff";

type DetailTab = "changes" | "json";

@Component({
  selector: "app-admin-revisions",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmBadge,
    HlmButton,
    HlmDialogImports,
    HlmSkeleton,
    HlmSpinner,
    HlmTableImports,
    HlmTabsImports,
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <header>
        <h1 class="m-0 font-mono text-2xl tracking-tight">Revisions</h1>
        <p class="mt-1 text-sm text-muted-foreground">
          Every publish is kept. Rolling back creates a new revision rather than
          deleting history, so nothing is ever lost.
        </p>
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-64 w-full" />
      } @else if (!rows().length) {
        <p class="text-sm text-muted-foreground">Nothing published yet.</p>
      } @else {
        <div hlmTableContainer class="rounded-lg border border-border">
          <table hlmTable>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh class="font-mono text-[0.7rem] uppercase tracking-[0.18em]">Version</th>
                <th hlmTh class="font-mono text-[0.7rem] uppercase tracking-[0.18em]">Locale</th>
                <th hlmTh class="font-mono text-[0.7rem] uppercase tracking-[0.18em]">Label</th>
                <th hlmTh class="font-mono text-[0.7rem] uppercase tracking-[0.18em]">Published</th>
                <th hlmTh><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (row of rows(); track row.id) {
                <tr hlmTr>
                  <td hlmTd class="font-mono text-sm">v{{ row.id }}</td>
                  <td hlmTd class="font-mono text-sm uppercase">{{ row.locale }}</td>
                  <td hlmTd class="text-sm text-muted-foreground">{{ row.label || "—" }}</td>
                  <td hlmTd class="text-sm text-muted-foreground">
                    {{ formatDate(row.createdAt) }}
                  </td>
                  <td hlmTd>
                    <div class="flex items-center justify-end gap-2">
                      <button
                        hlmBtn
                        variant="ghost"
                        size="sm"
                        [disabled]="viewing() !== null"
                        [attr.aria-label]="'View v' + row.id"
                        (click)="view(row)"
                      >
                        @if (viewing() === row.id) {
                          <hlm-spinner class="size-4" />
                        } @else {
                          View
                        }
                      </button>
                      @if (row.live) {
                        <span hlmBadge variant="secondary" class="font-mono text-[0.65rem]">
                          live
                        </span>
                      } @else {
                        <button
                          hlmBtn
                          variant="outline"
                          size="sm"
                          [disabled]="busy() === row.id"
                          (click)="rollback(row)"
                        >
                          Roll back
                        </button>
                      }
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
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
              v{{ d.revision.id }} · {{ d.revision.locale.toUpperCase() }}
            </h2>
            <p hlmDialogDescription>
              {{ d.revision.label || "unlabelled" }} — published
              {{ formatDate(d.revision.createdAt) }}
            </p>
          </hlm-dialog-header>

          <div hlmTabs [tab]="tab()" (tabActivated)="onTab($event)" class="min-w-0">
            <div hlmTabsList aria-label="Revision view">
              <button hlmTabsTrigger="changes">Changes vs live</button>
              <button hlmTabsTrigger="json">Full JSON</button>
            </div>

            <div hlmTabsContent="changes" class="min-w-0">
              @if (d.revision.live) {
                <p class="m-0 text-sm text-muted-foreground">
                  This is the live version, so there is nothing to compare it with.
                </p>
              } @else if (!d.live) {
                <p class="m-0 text-sm text-muted-foreground">
                  Nothing is live in this language yet.
                </p>
              } @else if (!changes().length) {
                <p class="m-0 text-sm text-muted-foreground">
                  Identical to what is live (v{{ d.live.id }}). Rolling back would change nothing.
                </p>
              } @else {
                <p class="m-0 mb-3 text-[0.8rem] text-muted-foreground">
                  Rolling back replaces the live version (v{{ d.live.id }}) with v{{ d.revision.id }}.
                  {{ changes().length }} {{ changes().length === 1 ? "field changes" : "fields change" }}:
                </p>
                <ol class="m-0 flex max-h-[60vh] list-none flex-col gap-3 overflow-y-auto p-0 pr-1">
                  @for (entry of changes(); track entry.path) {
                    <li class="rounded-lg border border-border p-3">
                      <div class="mb-2 flex items-start justify-between gap-2">
                        <code class="font-mono text-[0.72rem] break-all text-foreground">
                          {{ entry.path }}
                        </code>
                        <span hlmBadge variant="outline" class="shrink-0 font-mono text-[0.62rem]">
                          {{ entry.kind }}
                        </span>
                      </div>
                      <dl class="m-0 grid gap-1.5 text-[0.78rem] leading-relaxed">
                        @if (entry.before !== undefined) {
                          <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
                            <dt class="font-mono text-[0.66rem] uppercase tracking-wider text-destructive">
                              live
                            </dt>
                            <!-- Inline: pre-wrap would render template indentation. -->
                            <dd class="m-0 whitespace-pre-wrap wrap-break-word text-muted-foreground">{{ entry.before }}</dd>
                          </div>
                        }
                        @if (entry.after !== undefined) {
                          <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2">
                            <dt class="font-mono text-[0.66rem] uppercase tracking-wider text-accent-indigo">
                              v{{ d.revision.id }}
                            </dt>
                            <dd class="m-0 whitespace-pre-wrap wrap-break-word text-foreground">{{ entry.after }}</dd>
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
            @if (!d.revision.live) {
              <button hlmBtn type="button" (click)="rollbackFromDetail(d)">
                Roll back to v{{ d.revision.id }}
              </button>
            }
          </hlm-dialog-footer>
        }
      </hlm-dialog-content>
    </hlm-dialog>
  `,
})
export default class AdminRevisionsPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);

  protected readonly rows = signal<RevisionRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal<number | null>(null);

  protected readonly viewing = signal<number | null>(null);
  protected readonly detail = signal<RevisionDetail | null>(null);
  protected readonly tab = signal<DetailTab>("changes");

  /** Live → revision, i.e. exactly what a rollback would change. */
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
    const result = await this.api.revisions();
    this.loading.set(false);

    if (!result.ok) {
      toast.error("Could not load revisions", { description: result.error });
      return;
    }
    this.rows.set(result.data.revisions);
  }

  protected onTab(tab: string | number): void {
    this.tab.set(tab === "json" ? "json" : "changes");
  }

  protected async view(row: RevisionRow): Promise<void> {
    this.viewing.set(row.id);
    const result = await this.api.revision(row.id);
    this.viewing.set(null);

    if (!result.ok) {
      toast.error(`Could not load v${row.id}`, { description: result.error });
      return;
    }

    this.tab.set("changes");
    this.detail.set(result.data);
  }

  /** Closes the viewer first so the confirmation is not stacked on top of it. */
  protected async rollbackFromDetail(detail: RevisionDetail): Promise<void> {
    this.detail.set(null);
    await this.rollback(detail.revision);
  }

  protected async rollback(row: RevisionRow): Promise<void> {
    const confirmed = await this.confirm.ask({
      title: `Roll ${row.locale.toUpperCase()} back to v${row.id}?`,
      description:
        "This publishes the old content as a new revision. Nothing is deleted — the current version stays in history.",
      confirmLabel: "Roll back",
    });
    if (!confirmed) return;

    this.busy.set(row.id);
    const result = await this.api.rollback(row.id);
    this.busy.set(null);

    if (!result.ok) {
      toast.error("Rollback failed", { description: result.error });
      return;
    }

    toast.success(`Rolled back ${result.data.locale.toUpperCase()}`, {
      description: `Now serving v${result.data.versionId}.`,
    });
    await this.load();
  }
}
