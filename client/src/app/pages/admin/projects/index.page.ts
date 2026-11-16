import {
  CdkDrag,
  type CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
  moveItemInArray,
} from "@angular/cdk/drag-drop";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
} from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { toast } from "@spartan-ng/brain/sonner";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideEllipsis,
  lucideEye,
  lucideEyeOff,
  lucideGripVertical,
  lucidePencil,
  lucidePlus,
  lucideTrash2,
} from "@ng-icons/lucide";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDropdownMenuImports } from "@spartan-ng/helm/dropdown-menu";
import { HlmSwitch } from "@spartan-ng/helm/switch";
import { HlmTableImports } from "@spartan-ng/helm/table";

import { AdminApiService, type ProjectListRow } from "../../../admin/admin-api.service";
import { ConfirmService } from "../../../admin/components/confirm-dialog.component";
import { RecoveryService } from "../../../admin/recovery.service";
import { toastNotSaved } from "../../../admin/save-feedback";
import { createBlankProject } from "../../../admin/create-entities";
import {
  FormSkeletonComponent,
  LoadErrorComponent,
} from "../../../admin/components/load-state.component";
import { AdminPageHeaderComponent } from "../../../admin/components/page-header.component";
import { absoluteTime, relativeTime } from "../../../admin/relative-time";

/**
 * Work (plan 5, U13): the projects in the home page's order, as a table. A name opens its editor;
 * a row moves by drag, by Alt with an arrow on its grip, or by Move up and Move down in its ⋯ (a
 * single pointer's way). Add creates a project and opens its editor.
 */
@Component({
  selector: "app-admin-projects",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AdminPageHeaderComponent,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
    FormSkeletonComponent,
    HlmButton,
    HlmDropdownMenuImports,
    HlmSwitch,
    HlmTableImports,
    LoadErrorComponent,
    NgIcon,
    RouterLink,
  ],
  viewProviders: [
    provideIcons({
      lucideEllipsis,
      lucideEye,
      lucideEyeOff,
      lucideGripVertical,
      lucidePencil,
      lucidePlus,
      lucideTrash2,
    }),
  ],
  host: { class: "block" },
  template: `
    <div class="mx-auto flex max-w-5xl flex-col gap-6 pb-12">
      <app-page-header
        title="Work"
        description="The projects in the home page's order: a featured one spans the row, the rest go two across. The section's heading is in Words."
        preview="/admin/preview/en#projects"
      >
        <button hlmBtn variant="outline" headerActions [disabled]="adding()" (click)="add()">
          <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
          <span class="ml-1.5">Add project</span>
        </button>
      </app-page-header>

      @if (loading()) {
        <app-form-skeleton kind="list" [rows]="3" label="Loading projects…" />
      } @else if (loadError(); as reason) {
        <app-load-error title="Could not load the projects" [reason]="reason" (retry)="reload()" />
      } @else {
        <div hlmTableContainer>
          <table hlmTable>
            <caption class="sr-only">
              Projects in the home page's order
            </caption>
            <thead hlmTHead>
              <tr hlmTr>
                <th hlmTh scope="col" class="w-10"><span class="sr-only">Order</span></th>
                <th hlmTh scope="col">Name</th>
                <th hlmTh scope="col" class="max-sm:hidden">Case study</th>
                <th hlmTh scope="col" class="max-sm:hidden">Featured</th>
                <th hlmTh scope="col">Shown</th>
                <th hlmTh scope="col" class="max-sm:hidden">Updated</th>
                <th hlmTh scope="col" class="w-12"><span class="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody hlmTBody cdkDropList (cdkDropListDropped)="dropped($event)">
              @for (row of rows(); track row.id; let i = $index) {
                <tr hlmTr cdkDrag cdkDragPreviewContainer="parent" class="h-9 pointer-coarse:h-11">
                  <td hlmTd>
                    <button
                      cdkDragHandle
                      type="button"
                      data-grip
                      class="flex size-6 cursor-grab items-center justify-center rounded text-muted-foreground hover:text-foreground active:cursor-grabbing pointer-coarse:size-11"
                      [attr.aria-label]="'Reorder ' + name(row) + '. Use Alt with arrow keys.'"
                      (keydown)="onGripKey($event, i)"
                    >
                      <ng-icon name="lucideGripVertical" size="16" aria-hidden="true" />
                    </button>
                  </td>
                  <td hlmTd class="whitespace-normal">
                    <a
                      class="font-medium wrap-anywhere text-foreground underline-offset-2 hover:underline"
                      [routerLink]="['/admin/projects', row.slug]"
                      >{{ name(row) }}</a
                    >
                    <span class="block font-data text-xs text-muted-foreground" translate="no"
                      >/{{ row.slug }}</span
                    >
                  </td>
                  <td hlmTd class="font-data text-xs max-sm:hidden">{{ caseStudy(row) }}</td>
                  <td hlmTd class="max-sm:hidden">
                    @if (row.featured) {
                      Yes
                    } @else {
                      <span class="sr-only">No</span>
                    }
                  </td>
                  <td hlmTd>
                    <label class="flex items-center gap-2 text-xs text-muted-foreground">
                      <hlm-switch
                        [checked]="row.isVisible"
                        (checkedChange)="toggleVisible(row, $event)"
                      />
                      <span aria-hidden="true">{{ row.isVisible ? "Shown" : "Hidden" }}</span>
                      <span class="sr-only">Show {{ name(row) }} on the site</span>
                    </label>
                  </td>
                  <td hlmTd class="font-data text-xs text-muted-foreground max-sm:hidden">
                    <time [attr.datetime]="row.updatedAt" [title]="absolute(row.updatedAt)">{{
                      relative(row.updatedAt)
                    }}</time>
                  </td>
                  <td hlmTd class="text-right">
                    <button
                      hlmBtn
                      variant="ghost"
                      size="icon-sm"
                      type="button"
                      class="text-muted-foreground pointer-coarse:size-11"
                      [hlmDropdownMenuTrigger]="rowMenu"
                      [hlmDropdownMenuTriggerData]="{ $implicit: row, index: i }"
                      [attr.aria-label]="'More actions for ' + name(row)"
                    >
                      <ng-icon name="lucideEllipsis" size="16" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr hlmTr>
                  <td hlmTd colspan="7" class="py-6 text-hint text-muted-foreground">
                    No projects yet.
                    <button
                      hlmBtn
                      variant="link"
                      size="sm"
                      type="button"
                      class="px-1"
                      (click)="add()"
                    >
                      Add a project
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <ng-template #rowMenu let-row let-i="index">
          <hlm-dropdown-menu class="w-48">
            <button hlmDropdownMenuItem [routerLink]="['/admin/projects', row.slug]">
              <ng-icon name="lucidePencil" size="14" aria-hidden="true" />
              <span>Edit</span>
            </button>
            <button hlmDropdownMenuItem (triggered)="toggleVisible(row, !row.isVisible)">
              <ng-icon
                [name]="row.isVisible ? 'lucideEyeOff' : 'lucideEye'"
                size="14"
                aria-hidden="true"
              />
              <span>{{ row.isVisible ? "Hide from site" : "Show on site" }}</span>
            </button>
            <button hlmDropdownMenuItem [disabled]="i === 0" (triggered)="move(i, -1)">
              Move up
            </button>
            <button
              hlmDropdownMenuItem
              [disabled]="i === rows().length - 1"
              (triggered)="move(i, 1)"
            >
              Move down
            </button>
            <hlm-dropdown-menu-separator />
            <button
              hlmDropdownMenuItem
              class="text-destructive focus:text-destructive"
              (triggered)="remove(row)"
            >
              <ng-icon name="lucideTrash2" size="14" aria-hidden="true" />
              <span>Delete</span>
            </button>
          </hlm-dropdown-menu>
        </ng-template>
      }
    </div>
  `,
})
export default class AdminProjectsPage implements OnInit {
  private readonly api = inject(AdminApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly recovery = inject(RecoveryService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly rows = signal<ProjectListRow[]>([]);
  protected readonly loading = signal(true);
  /** The API's reason when the list did not arrive. */
  protected readonly loadError = signal<string | null>(null);
  protected readonly adding = signal(false);
  protected readonly relative = relativeTime;
  protected readonly absolute = absoluteTime;

  ngOnInit(): void {
    void this.load();
  }

  protected name(row: ProjectListRow): string {
    return row.translations.en?.name || row.slug;
  }

  /** The languages with a case study: "EN, DE", "EN", or "None". */
  protected caseStudy(row: ProjectListRow): string {
    const with_ = (["en", "de"] as const).filter((l) => row.translations[l]?.hasCaseStudy);
    return with_.map((l) => l.toUpperCase()).join(", ") || "None";
  }

  protected reload(): void {
    this.loading.set(true);
    void this.load();
  }

  private async load(): Promise<void> {
    const result = await this.api.listProjects();
    this.loading.set(false);
    this.loadError.set(result.ok ? null : result.error);
    if (result.ok) this.rows.set(result.data.projects);
  }

  protected async toggleVisible(row: ProjectListRow, isVisible: boolean): Promise<void> {
    const previous = this.rows();
    this.rows.update((list) => list.map((r) => (r.id === row.id ? { ...r, isVisible } : r)));

    const result = await this.api.setVisibility("projects", row.id, isVisible);
    if (!result.ok) {
      this.rows.set(previous);
      toastNotSaved(result.error);
    }
  }

  /** Task 3: a new project, straight into its editor. */
  protected async add(): Promise<void> {
    this.adding.set(true);
    const result = await createBlankProject(this.api);
    this.adding.set(false);
    if (!result.ok) {
      toast.error("Could not add project", { description: result.error });
      return;
    }
    void this.router.navigate(["/admin/projects", result.slug]);
  }

  protected async remove(row: ProjectListRow): Promise<void> {
    // Deletion is immediate and has no undo, unlike edits which stay in draft
    // until published — so it always asks first.
    const go = await this.confirm.ask({
      title: `Delete ${this.name(row)}?`,
      description:
        "Its text and case study in both languages are deleted. Its images stay in the media library. This cannot be undone.",
      confirmLabel: "Delete project",
      destructive: true,
    });
    if (!go) return;

    const previous = this.rows();
    this.rows.update((list) => list.filter((r) => r.id !== row.id));

    const result = await this.api.deleteProject(row.id);
    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not delete", { description: result.error });
      return;
    }
    this.recovery.forget("project", row.id);
    // Its row and ⋯ went: the page's Add takes the focus.
    this.afterRender((root) => root.querySelector<HTMLElement>("app-page-header button")?.focus());
  }

  protected onGripKey(event: KeyboardEvent, index: number): void {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    this.move(index, event.key === "ArrowUp" ? -1 : 1);
  }

  protected move(index: number, by: -1 | 1): void {
    this.moveTo(index, index + by);
  }

  protected dropped(event: CdkDragDrop<unknown>): void {
    this.moveTo(event.previousIndex, event.currentIndex);
  }

  private moveTo(from: number, to: number): void {
    const list = [...this.rows()];
    if (from === to || to < 0 || to >= list.length) return;
    moveItemInArray(list, from, to);
    void this.onReorder(list);
    // A moved row is a node moved, which loses the focus: its grip takes it back where it lands.
    this.afterRender((root) =>
      root.querySelectorAll<HTMLElement>("button[data-grip]")[to]?.focus(),
    );
  }

  private async onReorder(next: ProjectListRow[]): Promise<void> {
    const previous = this.rows();
    this.rows.set(next);

    const result = await this.api.reorder(
      "projects",
      next.map((r) => r.id),
    );

    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Could not reorder", { description: result.error });
    }
  }

  private afterRender(run: (root: HTMLElement) => void): void {
    afterNextRender(() => run(this.host.nativeElement), { injector: this.injector });
  }
}
