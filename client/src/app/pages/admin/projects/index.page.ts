import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { RouterLink } from "@angular/router";
import { toast } from "@spartan-ng/brain/sonner";
import { NgIcon, provideIcons } from "@ng-icons/core";
import {
  lucideEllipsis,
  lucideEye,
  lucideEyeOff,
  lucidePencil,
  lucidePlus,
  lucideTrash2,
} from "@ng-icons/lucide";
import { HlmBadge } from "@spartan-ng/helm/badge";
import { HlmButton } from "@spartan-ng/helm/button";
import { HlmDropdownMenuImports } from "@spartan-ng/helm/dropdown-menu";
import { HlmSeparator } from "@spartan-ng/helm/separator";
import { HlmSkeleton } from "@spartan-ng/helm/skeleton";
import { HlmSwitch } from "@spartan-ng/helm/switch";

import { unsavedChangesGuard } from "../../../admin/unsaved-changes.service";

import { AdminApiService, type ProjectRow } from "../../../admin/admin-api.service";
import { ConfirmService } from "../../../admin/components/confirm-dialog.component";
import {
  SortableListComponent,
  SortableRowDirective,
} from "../../../admin/components/sortable-list.component";
import {
  UiGroupEditorComponent,
  type UiFieldDef,
} from "../../../admin/components/ui-group-editor.component";

const HEADING_FIELDS: UiFieldDef[] = [
  { key: "heading", label: "Section heading" },
  { key: "subtitle", label: "Section subtitle" },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-projects",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    HlmBadge,
    HlmButton,
    HlmDropdownMenuImports,
    HlmSeparator,
    HlmSkeleton,
    HlmSwitch,
    NgIcon,
    RouterLink,
    SortableListComponent,
    SortableRowDirective,
    UiGroupEditorComponent,
  ],
  viewProviders: [
    provideIcons({ lucideEllipsis, lucideEye, lucideEyeOff, lucidePencil, lucidePlus, lucideTrash2 }),
  ],
  host: { class: "block" },
  template: `
    <app-ui-group-editor
      group="projects"
      title="Projects"
      description="Section heading and the case-study cards."
      [fields]="headingFields"
    />

    <div class="mx-auto flex max-w-4xl flex-col gap-6 pb-28">
      <hlm-separator />

      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="m-0 font-mono text-lg tracking-tight">Case studies</h2>
          <p class="mt-1 text-sm text-muted-foreground">
            Order here is the order they stack on the page.
          </p>
        </div>
        <button hlmBtn variant="outline" (click)="add()">
          <ng-icon name="lucidePlus" size="14" aria-hidden="true" />
          <span class="ml-1.5">Add project</span>
        </button>
      </header>

      @if (loading()) {
        <hlm-skeleton class="h-64 w-full" />
      } @else {
        <app-sortable-list
          [items]="rows()"
          [trackBy]="trackRow"
          label="project"
          emptyText="No projects yet."
          (reordered)="onReorder($event)"
        >
          <ng-template appSortableRow let-row>
            <div class="flex flex-wrap items-center gap-3">
              <div class="min-w-0 flex-1">
                <p class="m-0 truncate font-mono text-sm">
                  {{ row.translations.en.name || row.slug }}
                </p>
                <p class="m-0 mt-0.5 truncate font-mono text-[0.72rem] text-muted-foreground">
                  /{{ row.slug }}
                </p>
              </div>

              @if (!row.translations.de.name || row.translations.de.name === row.translations.en.name) {
                <span hlmBadge variant="outline" class="font-mono text-[0.65rem]">DE todo</span>
              }

              <label class="flex items-center gap-2 font-mono text-[0.72rem] text-muted-foreground">
                <hlm-switch
                  [checked]="row.isVisible"
                  (checkedChange)="toggleVisible(row, $event)"
                />
                <span>{{ row.isVisible ? "shown" : "hidden" }}</span>
              </label>

              <a hlmBtn variant="outline" size="sm" [routerLink]="['/admin/projects', row.slug]">
                <ng-icon name="lucidePencil" size="14" aria-hidden="true" />
                <span class="ml-1.5">Edit</span>
              </a>

              <button
                hlmBtn
                variant="ghost"
                size="sm"
                class="text-muted-foreground"
                [hlmDropdownMenuTrigger]="rowMenu"
                [hlmDropdownMenuTriggerData]="{ $implicit: row }"
                [attr.aria-label]="'More actions for ' + row.slug"
              >
                <ng-icon name="lucideEllipsis" size="16" aria-hidden="true" />
              </button>
            </div>
          </ng-template>
        </app-sortable-list>

        <ng-template #rowMenu let-row>
          <hlm-dropdown-menu class="w-48">
            <button hlmDropdownMenuItem [routerLink]="['/admin/projects', row.slug]">
              <ng-icon name="lucidePencil" size="14" aria-hidden="true" />
              <span>Edit</span>
            </button>
            <button hlmDropdownMenuItem (triggered)="toggleVisible(row, !row.isVisible)">
              <ng-icon [name]="row.isVisible ? 'lucideEyeOff' : 'lucideEye'" size="14" aria-hidden="true" />
              <span>{{ row.isVisible ? "Hide from site" : "Show on site" }}</span>
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

  protected readonly headingFields = HEADING_FIELDS;
  protected readonly rows = signal<ProjectRow[]>([]);
  protected readonly loading = signal(true);

  ngOnInit(): void {
    void this.load();
  }

  protected readonly trackRow = (row: ProjectRow): string => row.id;

  private async load(): Promise<void> {
    const result = await this.api.listProjects();
    this.loading.set(false);

    if (!result.ok) {
      toast.error("Could not load projects", { description: result.error });
      return;
    }
    this.rows.set(result.data.projects);
  }

  protected async toggleVisible(row: ProjectRow, isVisible: boolean): Promise<void> {
    const previous = this.rows();
    this.rows.update((list) => list.map((r) => (r.id === row.id ? { ...r, isVisible } : r)));

    const result = await this.api.updateProject(row.id, { ...row, isVisible });
    if (!result.ok) {
      this.rows.set(previous);
      toast.error("Not saved", { description: result.error });
    }
  }

  protected async add(): Promise<void> {
    const slug = `project-${Date.now().toString(36)}`;
    const blank = {
      name: "New project",
      descriptor: "",
      hook: "",
      problem: "",
      aiArchitecture: "",
      fullStackInfra: "",
      outcomes: [] as string[],
    };

    const result = await this.api.createProject({
      slug,
      imageId: null,
      imagePath: "",
      stack: [],
      linkLive: "",
      linkRepo: "",
      linkCaseStudy: "",
      isVisible: true,
      translations: { en: { ...blank }, de: { ...blank } },
    });

    if (!result.ok) {
      toast.error("Could not add project", { description: result.error });
      return;
    }
    await this.load();
  }

  protected async remove(row: ProjectRow): Promise<void> {
    // Deletion is immediate and has no undo, unlike edits which stay in draft
    // until published — so it always asks first.
    const go = await this.confirm.ask({
      title: `Delete ${row.translations.en.name || row.slug}?`,
      description: "Its text in both languages is deleted. Its image stays in the media library. This cannot be undone.",
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
    }
  }

  protected async onReorder(next: ProjectRow[]): Promise<void> {
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
}
