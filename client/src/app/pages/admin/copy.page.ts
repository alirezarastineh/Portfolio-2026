import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";
import { HlmTabsImports } from "@spartan-ng/helm/tabs";

import { ConfirmService } from "../../admin/components/confirm-dialog.component";
import {
  UiGroupEditorComponent,
  type UiFieldDef,
} from "../../admin/components/ui-group-editor.component";
import { UnsavedChangesService, unsavedChangesGuard } from "../../admin/unsaved-changes.service";
import type { UiGroup } from "../../admin/ui-section.service";

interface GroupDef {
  group: UiGroup;
  title: string;
  description: string;
  fields: UiFieldDef[];
}

/** The copy that belongs to no single section: case-study pages, the 404, the assistant, project cards. */
const GROUPS: GroupDef[] = [
  {
    group: "caseStudy",
    title: "Case-study pages",
    description: "Labels on /work/<project>.",
    fields: [
      { key: "allWork", label: "“All work” link" },
      { key: "readCaseStudy", label: "“Read case study” link" },
      { key: "role", label: "Role label" },
      { key: "period", label: "Period label" },
      { key: "category", label: "Category label" },
      { key: "metrics", label: "Metrics heading" },
      { key: "gallery", label: "Gallery heading" },
      { key: "toc", label: "Table-of-contents heading" },
      { key: "previous", label: "Previous project" },
      { key: "next", label: "Next project" },
      { key: "ctaHeading", label: "Closing heading" },
      { key: "ctaBody", label: "Closing text", multiline: true },
      { key: "ctaButton", label: "Closing button" },
    ],
  },
  {
    group: "projectCard",
    title: "Project cards",
    description: "Labels on the project cards of the home page.",
    fields: [
      { key: "problem", label: "Problem label" },
      { key: "arch", label: "Architecture label" },
      { key: "infra", label: "Infrastructure label" },
      { key: "outcomes", label: "Outcomes label" },
      { key: "caseLabel", label: "Card number (keep {i})" },
      { key: "live", label: "Live link" },
      { key: "repo", label: "Repository link" },
      { key: "caseStudy", label: "Case-study link" },
      { key: "techStackAriaLabel", label: "Stack list, for screen readers" },
    ],
  },
  {
    group: "notFound",
    title: "Page not found",
    description: "The 404 page inside the site.",
    fields: [
      { key: "title", label: "Heading" },
      { key: "body", label: "Text", multiline: true },
      { key: "home", label: "Link home" },
    ],
  },
  {
    group: "ask",
    title: "Assistant",
    description: "The “ask my portfolio” terminal. Tell visitors it is an AI (EU AI Act, Art. 50).",
    fields: [
      { key: "title", label: "Title" },
      { key: "hint", label: "Hint under the prompt" },
      { key: "placeholder", label: "Input placeholder" },
      { key: "disclosure", label: "AI disclosure", multiline: true },
      { key: "offline", label: "When it is resting", multiline: true },
    ],
  },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-copy",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [HlmTabsImports, UiGroupEditorComponent],
  host: { class: "block" },
  template: `
    <div class="mx-auto mb-6 flex max-w-4xl flex-col gap-4">
      <div hlmTabs [tab]="tab()" (tabActivated)="select($any($event))">
        <div hlmTabsList aria-label="Copy group">
          @for (def of groups; track def.group) {
            <button [hlmTabsTrigger]="def.group">{{ def.title }}</button>
          }
        </div>
      </div>
    </div>

    @for (def of groups; track def.group) {
      @if (def.group === active()) {
        <app-ui-group-editor
          [group]="def.group"
          [title]="def.title"
          [description]="def.description"
          [fields]="def.fields"
        />
      }
    }
  `,
})
export default class AdminCopyPage {
  private readonly unsaved = inject(UnsavedChangesService);
  private readonly confirm = inject(ConfirmService);

  protected readonly groups = GROUPS;
  /** The editor shown. */
  protected readonly active = signal<UiGroup>("caseStudy");
  /**
   * The tab strip's own state. Kept apart from `active` so that a refused
   * switch can put the strip back: the editor below is destroyed on a switch,
   * and with it any unsaved edits.
   */
  protected readonly tab = signal<UiGroup>("caseStudy");

  protected async select(group: UiGroup): Promise<void> {
    const current = this.active();
    if (group === current) return;
    this.tab.set(group);
    if (this.unsaved.isDirty(`ui:${current}`)) {
      const leave = await this.confirm.ask({
        title: "Discard unsaved changes?",
        description: "This group has edits that have not been saved. Switching loses them.",
        confirmLabel: "Discard and switch",
        cancelLabel: "Stay",
        destructive: true,
      });
      if (!leave) {
        this.tab.set(current);
        return;
      }
    }
    this.active.set(group);
  }
}
