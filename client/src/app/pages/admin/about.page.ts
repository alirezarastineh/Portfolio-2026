import { ChangeDetectionStrategy, Component } from "@angular/core";
import type { RouteMeta } from "@analogjs/router";

import { unsavedChangesGuard } from "../../admin/unsaved-changes.service";

import {
  UiGroupEditorComponent,
  type UiFieldDef,
} from "../../admin/components/ui-group-editor.component";

const FIELDS: UiFieldDef[] = [
  { key: "heading", label: "Section heading", hint: "Rendered with the scramble effect." },
  { key: "subtitle", label: "Section subtitle" },
  {
    key: "philosophy",
    label: "Philosophy",
    multiline: true,
    rows: 10,
    hint: "The long paragraph typed out by `cat philosophy.txt`.",
  },
  { key: "terminalTitle", label: "Terminal window title" },
  { key: "terminalPrompt", label: "Terminal prompt", hint: "e.g. user@portfolio:~$" },
  { key: "terminalOutputWhoami", label: "Output — whoami", multiline: true, rows: 2 },
  { key: "terminalOutputLs", label: "Output — ls skills/", multiline: true, rows: 2 },
  { key: "terminalOutputContact", label: "Output — cat contact.txt", multiline: true, rows: 3 },
];

export const routeMeta: RouteMeta = { canDeactivate: [unsavedChangesGuard] };

@Component({
  selector: "app-admin-about",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiGroupEditorComponent],
  host: { class: "block" },
  template: `
    <app-ui-group-editor
      group="about"
      title="About"
      description="The about section and every line of the animated terminal."
      [fields]="fields"
    />
  `,
})
export default class AdminAboutPage {
  protected readonly fields = FIELDS;
}
