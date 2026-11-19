import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnInit,
  signal,
  untracked,
} from "@angular/core";
import { NgIcon, provideIcons } from "@ng-icons/core";
import { lucideEllipsis } from "@ng-icons/lucide";
import { toast } from "@spartan-ng/brain/sonner";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDialogImports } from "@spartan-ng/helm/dialog";
import { HlmDropdownMenuImports } from "@spartan-ng/helm/dropdown-menu";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService, type PublicationRow } from "../../admin/admin-api.service";
import { ChangeListComponent } from "../../admin/components/change-list.component";
import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../admin/components/load-state.component";
import { AdminPageHeaderComponent } from "../../admin/components/page-header.component";
import { changeRows, changesLabel, summarizeReview } from "../../admin/publish-summary";
import { AdminPulseService } from "../../admin/pulse.service";
import { absoluteTime, relativeTime } from "../../admin/relative-time";
import {
  LANGUAGE,
  publicationProblem,
  wordChanges,
  type ChangeGroup,
} from "../../admin/review-words";
import type { Locale } from "../../content/schema";

/** A publication against the live site, both languages: what rolling back to it would change. */
interface Detail {
  id: number;
  groups: ChangeGroup[];
  data: { locale: Locale; language: string; json: string }[];
}

/** Restore's question: what it replaces, counted just before asking. */
function replaced(n: number | null): string {
  if (n === null) {
    return "The draft's changes could not be counted: any that are not live yet are replaced.";
  }
  if (n === 0) {
    return "The draft matches what is live, so nothing waiting is replaced.";
  }
  return `It replaces the draft's ${changesLabel(n)} that ${n === 1 ? "is" : "are"} not live yet.`;
}

/**
 * Every publish and roll back, both languages together (plan 5, U16): a table, newest first. Roll
 * back makes one live again as a new publication; Restore into draft puts one into the editors.
 */
@Component({
  selector: "app-admin-publications",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    ChangeListComponent,
    FormSkeletonComponent,
    HlmButton,
    HlmDialogImports,
    HlmDropdownMenuImports,
    HlmTableImports,
    LoadErrorComponent,
    NgIcon,
  ],
  viewProviders: [provideIcons({ lucideEllipsis })],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-12">
      <app-page-header
        title="History"
        description="Each publish, in both languages: roll back to one or restore it into the draft."
      />

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="4" label="Loading publications…" />
      } @else if (loadError(); as reason) {
        <app-load-error
          title="Could not load the publications"
          [reason]="reason"
          (retry)="reload()"
        />
      } @else {
        <div hlmTableContainer>
          <table hlmTable>
            <caption class="sr-only">
              Publications, newest first
            </caption>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh scope="col">Number</th>
                <th hlmTh scope="col">Label</th>
                <th hlmTh scope="col" class="max-sm:hidden">When</th>
                <th hlmTh scope="col" class="max-sm:hidden">What changed</th>
                <th hlmTh scope="col">Live</th>
                <th hlmTh scope="col" class="w-12"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody hlmTBody>
              @for (row of rows(); track row.id) {
                <tr hlmTr class="h-9 pointer-coarse:h-11">
                  <td hlmTd class="text-data">#{{ row.id }}</td>
                  <td
                    hlmTd
                    class="whitespace-normal wrap-anywhere"
                    [class.text-muted-foreground]="!row.label"
                  >
                    {{ row.label || "No label" }}
                  </td>
                  <td hlmTd class="text-data whitespace-nowrap text-muted-foreground max-sm:hidden">
                    <time [attr.datetime]="row.createdAt" [title]="absolute(row.createdAt)">{{
                      relative(row.createdAt)
                    }}</time>
                  </td>
                  <td hlmTd class="max-sm:hidden">{{ whatChanged(row) }}</td>
                  <td hlmTd>{{ liveWords(row) }}</td>
                  <td hlmTd class="text-right">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      class="text-muted-foreground pointer-coarse:size-11"
                      [hlmDropdownMenuTrigger]="rowMenu"
                      [hlmDropdownMenuTriggerData]="{ $implicit: row }"
                      [attr.aria-label]="'More actions for #' + row.id"
                    >
                      <ng-icon name="lucideEllipsis" size="16" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr hlmTr>
                  <td hlmTd colspan="6" class="py-6 text-hint text-muted-foreground">
                    Nothing published yet.
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <ng-template #rowMenu let-row>
          <hlm-dropdown-menu class="w-56">
            <!-- The live one has nothing to compare with and nothing to roll back to. -->
            @if (!row.live) {
              <button hlmDropdownMenuItem type="button" (triggered)="view(row)">
                View changes
              </button>
              <button hlmDropdownMenuItem type="button" (triggered)="rollback(row)">
                Roll back to #{{ row.id }}
              </button>
            }
            <button hlmDropdownMenuItem type="button" (triggered)="restoreDraft(row)">
              Restore into draft
            </button>
          </hlm-dropdown-menu>
        </ng-template>
      }
    </div>

    <hlm-dialog [state]="detail() ? 'open' : 'closed'" (stateChanged)="onDetailState($event)">
      <hlm-dialog-content *hlmDialogPortal="let ctx" class="sm:max-w-3xl">
        @if (detail(); as d) {
          <hlm-dialog-header>
            <h2 hlmDialogTitle>#{{ d.id }} against the live site</h2>
            <p hlmDialogDescription>
              What rolling back to #{{ d.id }} would change, in both languages. Case-study and post
              pages are compared when you publish.
            </p>
          </hlm-dialog-header>
          <div
            class="flex max-h-[60vh] min-w-0 flex-col gap-4 overflow-y-auto overscroll-contain pr-1"
          >
            @if (d.groups.length) {
              <app-change-list [groups]="d.groups" [links]="false" />
            } @else {
              <p class="m-0 text-sm text-muted-foreground">The same content as what is live.</p>
            }
            <details class="text-sm">
              <summary
                class="min-h-6 cursor-pointer touch-manipulation text-muted-foreground hover:text-foreground pointer-coarse:min-h-11"
              >
                Show the data
              </summary>
              @for (side of d.data; track side.locale) {
                <p class="m-0 mt-3 text-sm font-medium" [textContent]="side.language"></p>
                <pre
                  class="m-0 mt-1 rounded-lg border border-border bg-card/40 p-3 font-data text-xs/relaxed whitespace-pre-wrap wrap-anywhere"
                  translate="no"
                  [textContent]="side.json"
                ></pre>
              }
            </details>
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
  private readonly pulse = inject(AdminPulseService);

  protected readonly rows = signal<PublicationRow[]>([]);
  protected readonly loading = signal(true);
  /** The API's reason when the list did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  /** The publication an action is under way for: a second action waits. */
  private readonly busy = signal<number | null>(null);
  protected readonly detail = signal<Detail | null>(null);

  protected readonly relative = relativeTime;
  protected readonly absolute = absoluteTime;

  constructor() {
    // A publish or a roll back from the top bar's review puts a new one on top: read the list again.
    const seen = this.pulse.publishes();
    effect(() => {
      if (this.pulse.publishes() !== seen) {
        untracked(() => void this.load());
      }
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.publications();
    this.loading.set(false);
    this.loadError.set(result.ok ? null : result.error);
    if (result.ok) {
      this.rows.set(result.data.publications);
    }
  }

  /** What the list knows without the revisions: published, or rolled back to which one. */
  protected whatChanged(row: PublicationRow): string {
    if (row.kind === "rollback") {
      return row.restoredFrom ? `Rolled back to #${row.restoredFrom}` : "Rolled back";
    }
    const only = row.versions.length === 1 ? row.versions[0] : undefined;
    return only ? `Published, ${LANGUAGE[only.locale]} only` : "Published";
  }

  protected liveWords(row: PublicationRow): string {
    if (row.live) {
      return "Live";
    }
    const live = row.versions.find((version) => version.live);
    return live ? `${LANGUAGE[live.locale]} live` : "";
  }

  protected onDetailState(state: string): void {
    if (state === "closed") {
      this.detail.set(null);
    }
  }

  /** Both languages' revisions, on demand, against what is live: what a roll back would change. */
  protected async view(row: PublicationRow): Promise<void> {
    if (this.busy() !== null) {
      return;
    }
    this.busy.set(row.id);
    const englishFirst = [...row.versions].sort(
      (a, b) => Number(a.locale !== "en") - Number(b.locale !== "en"),
    );
    const results = await Promise.all(englishFirst.map((version) => this.api.revision(version.id)));
    this.busy.set(null);
    const failed = results.find((result) => !result.ok);
    if (failed && !failed.ok) {
      toast.error("Could not load the changes", { description: publicationProblem(failed.error) });
      return;
    }
    const details = results.flatMap((result) => (result.ok ? [result.data] : []));
    this.detail.set({
      id: row.id,
      groups: wordChanges(
        details.flatMap((d) =>
          d.live
            ? [
                {
                  locale: d.revision.locale,
                  before: d.live.payload,
                  after: d.revision.payload,
                  rows: changeRows(d.live.payload, d.revision.payload),
                },
              ]
            : [],
        ),
      ),
      data: details.map((d) => ({
        locale: d.revision.locale,
        language: LANGUAGE[d.revision.locale],
        json: JSON.stringify(d.revision.payload, null, 2),
      })),
    });
  }

  protected async rollback(row: PublicationRow): Promise<void> {
    if (this.busy() !== null) {
      return;
    }
    const confirmed = await this.confirm.ask({
      title: `Roll back to #${row.id}?`,
      description: `Both languages go back to #${row.id}'s content, live at once, as a new publication. Nothing is deleted.`,
      confirmLabel: "Roll back",
    });
    if (!confirmed) {
      return;
    }

    this.busy.set(row.id);
    const result = await this.api.rollbackPublication(row.id);
    this.busy.set(null);
    if (!result.ok) {
      toast.error("Not rolled back", { description: publicationProblem(result.error) });
      return;
    }
    toast.success(`Rolled back: #${result.data.publicationId} is live.`);
    // Lists of publications read again (this one among them).
    this.pulse.published();
  }

  protected async restoreDraft(row: PublicationRow): Promise<void> {
    if (this.busy() !== null) {
      return;
    }
    // No editor is open here: what Restore replaces is the draft's changes not yet live, counted
    // now, from a review of its own (the pulse may still be reading an older one).
    const review = await this.api.publishReview();
    const counted = review.ok ? summarizeReview(review.data).total : null;
    const confirmed = await this.confirm.ask({
      title: `Restore #${row.id} into the draft?`,
      description: `${replaced(counted)} Anything added since #${row.id} is hidden, not deleted. Nothing goes live until you publish.`,
      confirmLabel: "Restore into draft",
      destructive: counted !== 0,
    });
    if (!confirmed) {
      return;
    }

    this.busy.set(row.id);
    const result = await this.api.restoreDraft(row.id);
    this.busy.set(null);
    if (!result.ok) {
      toast.error("Not restored", { description: publicationProblem(result.error) });
      return;
    }
    toast.success(`Draft restored from #${row.id}`, {
      description: "Review it in the editors, then publish.",
    });
  }
}
